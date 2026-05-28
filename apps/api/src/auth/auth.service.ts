import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type {
  AuthAdmin,
  AuthUser,
  LoginResponse,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { MailchimpProducer } from '../mailchimp/mailchimp.producer';
import type { JwtPayload } from './jwt-payload.interface';
import type { SignupDto } from './dto/signup.dto';

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
      user: { id: user.id, email: user.email, username: user.username },
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
      user: { id: admin.id, email: admin.email, role: admin.role },
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
      user: { id: user.id, email: user.email, username: user.username },
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
      return { id: admin.id, email: admin.email, role: admin.role };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: principal.sub },
    });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, username: user.username };
  }
}
