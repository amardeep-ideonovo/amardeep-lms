import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AdminLiveRevealDTO,
  AdminLiveSessionDTO,
  LiveJoinCredentialsDTO,
  LiveProvider,
  LiveSessionBarDTO,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../lms/access.service';
import { decryptSecret, encryptSecret } from '../common/crypto.util';
import { utcFromLocalInput } from '../common/wallclock.util';
import { providerHostAllowed, providerLabel } from './live.util';
import { CreateLiveSessionDto, UpdateLiveSessionDto } from './dto/live-session.input';

// Always load targets (with class names) so we can resolve the audience label.
const withTargets = {
  targets: { include: { level: { select: { id: true, name: true } } } },
} satisfies Prisma.LiveSessionInclude;

type SessionRow = Prisma.LiveSessionGetPayload<{ include: typeof withTargets }>;

const dedupe = (ids: string[]): string[] => [...new Set(ids)];

@Injectable()
export class LiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  // --------------------------------------------------------------------------
  // Admin CRUD
  // --------------------------------------------------------------------------

  async adminList(): Promise<AdminLiveSessionDTO[]> {
    const rows = await this.prisma.liveSession.findMany({
      orderBy: { startsAt: 'desc' },
      include: withTargets,
    });
    return rows.map((r) => this.toAdminDTO(r));
  }

  async adminGet(id: string): Promise<AdminLiveSessionDTO> {
    return this.toAdminDTO(await this.load(id));
  }

  // Plaintext credentials for the admin to verify / test-join a link. Gated by
  // the `edit` permission on the controller — never returned on list/read.
  async adminReveal(id: string): Promise<AdminLiveRevealDTO> {
    const row = await this.load(id);
    return {
      joinUrl: this.crypto(() => decryptSecret(row.joinUrlEnc)),
      password: row.passwordEnc
        ? this.crypto(() => decryptSecret(row.passwordEnc as string))
        : null,
    };
  }

  async adminCreate(dto: CreateLiveSessionDto): Promise<AdminLiveSessionDTO> {
    this.assertProviderUrl(dto.provider, dto.joinUrl);
    const { startsAt, endsAt } = this.window(
      dto.startsAtLocal,
      dto.timezone ?? null,
      dto.durationMin,
    );
    const isMeet = dto.provider === 'GOOGLE_MEET';
    const created = await this.prisma.liveSession.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        provider: dto.provider,
        audience: dto.audience,
        status: 'DRAFT', // always created as a draft; a separate publish step goes live
        joinUrlEnc: this.crypto(() => encryptSecret(dto.joinUrl)),
        passwordEnc:
          isMeet || !dto.password
            ? null
            : this.crypto(() => encryptSecret(dto.password as string)),
        startsAt,
        endsAt,
        durationMin: dto.durationMin,
        joinLeadMin: dto.joinLeadMin ?? 10,
        timezone: dto.timezone?.trim() || null,
        targets:
          dto.audience === 'LEVELS' && dto.levelIds
            ? { create: dedupe(dto.levelIds).map((levelId) => ({ levelId })) }
            : undefined,
      },
      include: withTargets,
    });
    return this.toAdminDTO(created);
  }

  async adminUpdate(
    id: string,
    dto: UpdateLiveSessionDto,
  ): Promise<AdminLiveSessionDTO> {
    const existing = await this.load(id);
    const provider = dto.provider ?? existing.provider;
    const data: Prisma.LiveSessionUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined)
      data.description = dto.description?.trim() || null;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.audience !== undefined) data.audience = dto.audience;

    // Join URL: validate against the effective provider. If the provider changed
    // but no new URL was supplied, re-check the stored URL still fits.
    if (dto.joinUrl !== undefined) {
      this.assertProviderUrl(provider, dto.joinUrl);
      data.joinUrlEnc = this.crypto(() => encryptSecret(dto.joinUrl as string));
    } else if (dto.provider !== undefined) {
      const stored = this.crypto(() => decryptSecret(existing.joinUrlEnc));
      if (!providerHostAllowed(provider, stored)) {
        throw new BadRequestException(
          `The saved link is not a ${providerLabel(provider)} URL — enter a new one.`,
        );
      }
    }

    // Passcode: Meet never carries one; Zoom clears on "" and keeps on omit.
    if (provider === 'GOOGLE_MEET') {
      data.passwordEnc = null;
    } else if (dto.password !== undefined) {
      data.passwordEnc =
        dto.password === ''
          ? null
          : this.crypto(() => encryptSecret(dto.password as string));
    }

    // Schedule: recompute startsAt/endsAt from whatever changed.
    const durationMin = dto.durationMin ?? existing.durationMin;
    if (dto.startsAtLocal !== undefined) {
      const tz =
        dto.timezone !== undefined
          ? dto.timezone?.trim() || null
          : existing.timezone;
      const w = this.window(dto.startsAtLocal, tz, durationMin);
      data.startsAt = w.startsAt;
      data.endsAt = w.endsAt;
    } else if (dto.durationMin !== undefined) {
      data.endsAt = new Date(existing.startsAt.getTime() + durationMin * 60_000);
    }
    if (dto.durationMin !== undefined) data.durationMin = dto.durationMin;
    if (dto.joinLeadMin !== undefined) data.joinLeadMin = dto.joinLeadMin;
    if (dto.timezone !== undefined) data.timezone = dto.timezone?.trim() || null;

    // Targets: rebuild when audience or the list changed.
    const audience = dto.audience ?? existing.audience;
    if (dto.audience !== undefined || dto.levelIds !== undefined) {
      if (audience === 'LEVELS') {
        const ids = dedupe(dto.levelIds ?? existing.targets.map((t) => t.levelId));
        data.targets = { deleteMany: {}, create: ids.map((levelId) => ({ levelId })) };
      } else {
        data.targets = { deleteMany: {} };
      }
    }

    const updated = await this.prisma.liveSession.update({
      where: { id },
      data,
      include: withTargets,
    });
    return this.toAdminDTO(updated);
  }

  // Draft -> Scheduled (visible + joinable). Rejects a session that can't safely
  // go live so it never appears half-configured on a member dashboard.
  async publish(id: string): Promise<AdminLiveSessionDTO> {
    const s = await this.load(id);
    if (s.audience === 'LEVELS' && s.targets.length === 0) {
      throw new BadRequestException(
        'Select at least one class before publishing.',
      );
    }
    if (s.endsAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This session ends in the past — update the start time before publishing.',
      );
    }
    const url = this.crypto(() => decryptSecret(s.joinUrlEnc));
    if (!providerHostAllowed(s.provider, url)) {
      throw new BadRequestException(
        `The meeting link is not a valid ${providerLabel(s.provider)} URL.`,
      );
    }
    const updated = await this.prisma.liveSession.update({
      where: { id },
      data: { status: 'SCHEDULED' },
      include: withTargets,
    });
    return this.toAdminDTO(updated);
  }

  // A live (SCHEDULED) session is soft-canceled so entitled members who already
  // saw it get a clear "canceled" notice (410); a draft/canceled one is purged.
  async adminDelete(id: string): Promise<{ ok: true }> {
    const s = await this.load(id);
    if (s.status === 'SCHEDULED') {
      await this.prisma.liveSession.update({
        where: { id },
        data: { status: 'CANCELED' },
      });
    } else {
      await this.prisma.liveSession.delete({ where: { id } });
    }
    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async load(id: string): Promise<SessionRow> {
    const row = await this.prisma.liveSession.findUnique({
      where: { id },
      include: withTargets,
    });
    if (!row) throw new NotFoundException('Live session not found');
    return row;
  }

  private assertProviderUrl(provider: LiveProvider, url: string): void {
    if (!providerHostAllowed(provider, url)) {
      throw new BadRequestException(
        `Enter a valid https ${providerLabel(provider)} link.`,
      );
    }
  }

  private window(
    local: string,
    tz: string | null,
    durationMin: number,
  ): { startsAt: Date; endsAt: Date } {
    let startsAt: Date;
    try {
      startsAt = utcFromLocalInput(local, tz);
    } catch {
      throw new BadRequestException('Invalid start date/time.');
    }
    return {
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMin * 60_000),
    };
  }

  // Maps a "SETTINGS_ENC_KEY not set" failure to a 503 (config problem) rather
  // than a raw 500; any other crypto error propagates.
  private crypto<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('SETTINGS_ENC_KEY')) {
        throw new ServiceUnavailableException(
          'Live Sessions need encryption configured (set SETTINGS_ENC_KEY).',
        );
      }
      throw e;
    }
  }

  private toAdminDTO(s: SessionRow): AdminLiveSessionDTO {
    const levelIds = s.targets.map((t) => t.levelId);
    const audienceLabel =
      s.audience === 'ALL_ACTIVE'
        ? 'All members'
        : s.targets.map((t) => t.level.name).join(', ') || 'No audience';
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      provider: s.provider,
      audience: s.audience,
      status: s.status,
      levelIds,
      audienceLabel,
      targetsEmpty: s.audience === 'LEVELS' && levelIds.length === 0,
      hasJoinUrl: !!s.joinUrlEnc,
      hasPassword: !!s.passwordEnc,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      durationMin: s.durationMin,
      joinLeadMin: s.joinLeadMin,
      timezone: s.timezone,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // Member-facing (entitlement-gated)
  // --------------------------------------------------------------------------

  // The dashboard bar: live-now first (ending soonest), then soonest upcoming,
  // capped at 3. One activeLevelIds query; the visibility filter is in-memory.
  async currentForUser(userId: string): Promise<LiveSessionBarDTO[]> {
    const now = new Date();
    const active = await this.access.activeLevelIds(userId);
    const rows = await this.prisma.liveSession.findMany({
      where: { status: 'SCHEDULED', endsAt: { gt: now } },
      include: withTargets,
      orderBy: { startsAt: 'asc' },
    });
    const visible = rows.filter((r) => this.entitled(active, r));
    const live = visible
      .filter((r) => r.startsAt <= now)
      .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
    const upcoming = visible
      .filter((r) => r.startsAt > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return [...live, ...upcoming].slice(0, 3).map((r) => this.toBarDTO(r, now));
  }

  // Join-page shell (no credentials). Order matters: draft/unknown -> 404 for
  // everyone; not-entitled -> 403; canceled -> 410 (only reachable once entitled,
  // so a non-entitled caller never learns a session exists).
  async barForUser(userId: string, id: string): Promise<LiveSessionBarDTO> {
    const s = await this.prisma.liveSession.findUnique({
      where: { id },
      include: withTargets,
    });
    if (!s || s.status === 'DRAFT') {
      throw new NotFoundException('Live session not found');
    }
    if (!this.entitled(await this.access.activeLevelIds(userId), s)) {
      throw new ForbiddenException('You do not have access to this live session');
    }
    if (s.status === 'CANCELED') {
      throw new GoneException('This live session was canceled');
    }
    return this.toBarDTO(s, new Date());
  }

  // The credential release. 404 for anything not SCHEDULED (no existence oracle);
  // 403 if not entitled OR outside the join window; writes one audit row on
  // every successful release (the tripwire for a shared join link).
  async credentialsForUser(
    userId: string,
    id: string,
  ): Promise<LiveJoinCredentialsDTO> {
    const s = await this.prisma.liveSession.findUnique({
      where: { id },
      include: withTargets,
    });
    if (!s || s.status !== 'SCHEDULED') {
      throw new NotFoundException('Live session not found');
    }
    if (!this.entitled(await this.access.activeLevelIds(userId), s)) {
      throw new ForbiddenException('You do not have access to this live session');
    }
    const now = new Date();
    const joinsAt = s.startsAt.getTime() - s.joinLeadMin * 60_000;
    if (now.getTime() < joinsAt || now >= s.endsAt) {
      throw new ForbiddenException({
        code: 'OUTSIDE_WINDOW',
        message: 'This session is not open to join right now.',
      });
    }
    await this.prisma.liveJoinAudit.create({
      data: { liveSessionId: s.id, userId },
    });
    return {
      id: s.id,
      title: s.title,
      provider: s.provider,
      joinUrl: this.crypto(() => decryptSecret(s.joinUrlEnc)),
      password: s.passwordEnc
        ? this.crypto(() => decryptSecret(s.passwordEnc as string))
        : null,
      endsAt: s.endsAt.toISOString(),
      serverNow: now.toISOString(),
    };
  }

  private entitled(active: Set<string>, s: SessionRow): boolean {
    return this.access.canAccessLiveSessionWith(active, {
      audience: s.audience,
      levelIds: s.targets.map((t) => t.levelId),
    });
  }

  private toBarDTO(s: SessionRow, now: Date): LiveSessionBarDTO {
    const joinsAt = new Date(s.startsAt.getTime() - s.joinLeadMin * 60_000);
    const audienceLabel =
      s.audience === 'ALL_ACTIVE'
        ? 'All members'
        : s.targets.map((t) => t.level.name).join(', ') || 'Members';
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      provider: s.provider,
      audienceLabel,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      joinsAt: joinsAt.toISOString(),
      timezone: s.timezone,
      serverNow: now.toISOString(),
      isLive: s.startsAt <= now && now < s.endsAt,
      canJoinNow: joinsAt <= now && now < s.endsAt,
      status: s.status,
    };
  }
}
