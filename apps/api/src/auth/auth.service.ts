import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type {
  AdminPermissions,
  AdminPrefs,
  AuthAdmin,
  AuthUser,
  LoginResponse,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import type { JwtPayload } from './jwt-payload.interface';
import type { SignupDto } from './dto/signup.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { UpdateAdminPrefsDto } from './dto/update-admin-prefs.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mailchimp: MailchimpProducer,
  ) {}

  async loginMember(
    email: string,
    password: string,
  ): Promise<LoginResponse<AuthUser>> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      isAdmin: false,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  async loginAdmin(
    email: string,
    password: string,
  ): Promise<LoginResponse<AuthAdmin>> {
    const admin = await this.prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      isAdmin: true,
      role: admin.role,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: (admin.permissions as AdminPermissions) ?? {},
        prefs: (admin.prefs as AdminPrefs) ?? {},
      },
    };
  }

  /**
   * Create a new member account. Mirrors loginMember's response shape so the
   * signup flow can drop straight into the authenticated app without a second
   * round-trip. Optional SIGNUP_INVITE_CODE env var gates the endpoint for
   * closed beta launches.
   */
  async signupMember(dto: SignupDto): Promise<LoginResponse<AuthUser>> {
    // Invite-code gate (closed beta). Skipped when env var is unset.
    const requiredInvite = process.env.SIGNUP_INVITE_CODE?.trim();
    if (requiredInvite && dto.inviteCode?.trim() !== requiredInvite) {
      throw new ForbiddenException('Invalid invite code');
    }

    const email = dto.email.toLowerCase().trim();

    // Email uniqueness — surface as 409 so the UI can show "account exists".
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Derive a username from the email's local part. Strip non-alphanumeric
    // chars (the schema's @unique constraint is on `username`, not `email`,
    // so we need something filesystem-safe). Suffix a number if it collides.
    const baseUsername =
      email.split('@')[0]?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user';
    const username = await this.ensureUniqueUsername(baseUsername);

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim() || null,
      },
    });

    // Optional: auto-grant a level named "Free" if one exists. No-op if the
    // tenant hasn't configured one. Keeps existing-user signups from blowing
    // up when Mailchimp/queue is misconfigured (we log + swallow).
    await this.maybeGrantFreeLevel(user.id, user.email);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      isAdmin: false,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  private async ensureUniqueUsername(base: string): Promise<string> {
    let candidate = base;
    let suffix = 0;
    // Worst case after 1000 iterations we'd see usernames like `john1000` —
    // fine in practice, and bounded so we can't deadlock.
    while (
      suffix < 1000 &&
      (await this.prisma.user.findUnique({ where: { username: candidate } }))
    ) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    return candidate;
  }

  private async maybeGrantFreeLevel(
    userId: string,
    email: string,
  ): Promise<void> {
    const free = await this.prisma.level.findFirst({
      where: { name: { equals: 'Free', mode: 'insensitive' }, type: 'FREE' },
    });
    if (!free) return;
    await this.prisma.userLevel.upsert({
      where: {
        userId_levelId_source: {
          userId,
          levelId: free.id,
          source: 'MANUAL',
        },
      },
      create: {
        userId,
        levelId: free.id,
        source: 'MANUAL',
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE' },
    });
    // Mailchimp tag/audience sync — never block the signup response on a
    // queue/Mailchimp blip; signup must succeed even if marketing infra fails.
    if (free.mailchimpTags.length || free.mailchimpAudienceId) {
      try {
        await this.mailchimp.enqueueTags(
          'add',
          email,
          free.mailchimpTags,
          free.mailchimpAudienceId ?? undefined,
        );
      } catch (err) {
        this.logger.warn(
          `[signup] mailchimp enqueue failed for ${email}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  /** Resolve the principal behind GET /auth/me from the JWT claims. */
  async me(principal: JwtPayload): Promise<AuthUser | AuthAdmin> {
    if (principal.isAdmin) {
      const admin = await this.prisma.admin.findUnique({
        where: { id: principal.sub },
      });
      if (!admin) throw new UnauthorizedException();
      return {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: (admin.permissions as AdminPermissions) ?? {},
        prefs: (admin.prefs as AdminPrefs) ?? {},
      };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  /**
   * Member self-service profile update (PATCH /auth/me): first/last name and a
   * unique username. Email is intentionally NOT updatable here. Username
   * uniqueness is checked case-insensitively (so "Amar"/"amar" can't collide),
   * with the DB @unique constraint as a P2002 backstop.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const data: Prisma.UserUpdateInput = {};
    const firstName = dto.firstName?.trim();
    const lastName = dto.lastName?.trim();
    const username = dto.username?.trim();
    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;

    // Only touch username when it actually changes (case-insensitively).
    if (username && username.toLowerCase() !== user.username.toLowerCase()) {
      const clash = await this.prisma.user.findFirst({
        where: {
          id: { not: userId },
          username: { equals: username, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (clash) throw new ConflictException('That username is taken');
      data.username = username;
    }

    let updated = user;
    if (Object.keys(data).length > 0) {
      try {
        updated = await this.prisma.user.update({
          where: { id: userId },
          data,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException('That username is taken');
        }
        throw err;
      }
    }

    return {
      id: updated.id,
      email: updated.email,
      username: updated.username,
      firstName: updated.firstName,
      lastName: updated.lastName,
    };
  }

  /**
   * Member changes their own password. Requires the current password (verified
   * against the stored hash) and rejects reusing the same password. Throws 400
   * (not 401) on a wrong current password so the web client doesn't mistake it
   * for an expired session and bounce the user to /login.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const currentOk = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    const sameAsOld = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (sameAsOld) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { ok: true };
  }

  /** Admin changes their OWN password (verified against Admin.passwordHash). */
  async changeAdminPassword(
    adminId: string,
    dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    const currentOk = await bcrypt.compare(
      dto.currentPassword,
      admin.passwordHash,
    );
    if (!currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }
    const sameAsOld = await bcrypt.compare(dto.newPassword, admin.passwordHash);
    if (sameAsOld) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { ok: true };
  }

  /**
   * Admin self-service: persist personal UI preferences (PATCH /auth/admin/prefs).
   * Today that's just the sidebar `menuOrder` — a list of stable nav keys. We
   * sanitize it (trim, drop empties, dedupe, cap) and MERGE into any existing
   * prefs so future pref fields aren't clobbered. Keys aren't validated against a
   * section list here: the admin app reconciles the saved order against the live
   * nav (appends new items, ignores stale keys), so stray keys are harmless.
   * Returns the refreshed AuthAdmin so the client can update its cached `me`.
   */
  async updateAdminPrefs(
    adminId: string,
    dto: UpdateAdminPrefsDto,
  ): Promise<AuthAdmin> {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    const current = (admin.prefs as AdminPrefs) ?? {};
    const next: AdminPrefs = { ...current };

    if (dto.menuOrder !== undefined) {
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of dto.menuOrder) {
        const key = typeof raw === 'string' ? raw.trim() : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        cleaned.push(key);
        if (cleaned.length >= 100) break;
      }
      next.menuOrder = cleaned;
    }

    const updated = await this.prisma.admin.update({
      where: { id: adminId },
      data: { prefs: next as unknown as Prisma.InputJsonValue },
    });
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      permissions: (updated.permissions as AdminPermissions) ?? {},
      prefs: (updated.prefs as AdminPrefs) ?? {},
    };
  }
}
