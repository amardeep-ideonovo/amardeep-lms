import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { Prisma, type Campaign } from '@prisma/client';
import type {
  CampaignDTO,
  CampaignInput,
  ContactFilter,
} from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../site/app-config.service';
import { EmailService } from './email.service';

// Hard ceiling on recipients resolved+sent in a single campaign run. Protects
// the scheduler tick from a runaway broadcast; if a campaign's audience exceeds
// this we send the first N (deterministic order) and log that it was capped.
const MAX_RECIPIENTS_PER_RUN = 5000;

// Owns campaigns (scheduled broadcasts): CRUD, schedule/pause/resume, and the
// scheduler's per-tick dispatch (runDueCampaigns). A campaign sends a stored
// template to every SUBSCRIBED contact in its audience — optionally narrowed by
// a saved Segment filter. Cadence drives the next run: ONCE finishes (SENT),
// WEEKLY/MONTHLY/CRON re-arm nextRunAt and stay SCHEDULED. Every send flows
// through EmailService (suppression / idempotency / ledger), keyed by a
// per-run dedupeKey so a re-tick of the same run can't double-send.
@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly appConfig: AppConfigService,
  ) {}

  // ───────────────────────── CRUD ─────────────────────────

  async list(): Promise<CampaignDTO[]> {
    const rows = await this.prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => this.toDTO(c));
  }

  async get(id: string): Promise<CampaignDTO> {
    const row = await this.prisma.campaign.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Campaign not found');
    return this.toDTO(row);
  }

  async create(input: CampaignInput): Promise<CampaignDTO> {
    if (!input.templateId) {
      throw new BadRequestException('A template is required');
    }
    if (!input.audienceId) {
      throw new BadRequestException('An audience is required');
    }
    const data = this.normalizeInput(input);
    const row = await this.prisma.campaign.create({
      data: {
        name: (input.name ?? '').trim() || 'Untitled campaign',
        templateId: input.templateId,
        audienceId: input.audienceId,
        segmentId: input.segmentId ?? null,
        cadence: data.cadence,
        runAt: data.runAt,
        cron: data.cron,
        // New campaigns always start as DRAFT; scheduling is an explicit action.
        status: 'DRAFT',
      },
    });
    return this.toDTO(row);
  }

  async update(id: string, input: CampaignInput): Promise<CampaignDTO> {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Campaign not found');
    const data = this.normalizeInput(input);

    const patch: Prisma.CampaignUpdateInput = {};
    if (input.name !== undefined) {
      patch.name = input.name.trim() || 'Untitled campaign';
    }
    if (input.templateId !== undefined) patch.templateId = input.templateId;
    if (input.audienceId !== undefined) patch.audienceId = input.audienceId;
    if (input.segmentId !== undefined) patch.segmentId = input.segmentId ?? null;
    if (input.cadence !== undefined) patch.cadence = data.cadence;
    if (input.runAt !== undefined) patch.runAt = data.runAt;
    if (input.cron !== undefined) patch.cron = data.cron;

    // Editing a SCHEDULED campaign's timing should re-arm its next dispatch so
    // the change takes effect, rather than firing on the stale nextRunAt.
    if (
      existing.status === 'SCHEDULED' &&
      (input.cadence !== undefined ||
        input.runAt !== undefined ||
        input.cron !== undefined)
    ) {
      const cadence = data.cadence ?? existing.cadence;
      const runAt = input.runAt !== undefined ? data.runAt : existing.runAt;
      const cron = input.cron !== undefined ? data.cron : existing.cron;
      patch.nextRunAt = this.computeFirstRun(cadence, runAt, cron);
    }

    const row = await this.prisma.campaign.update({ where: { id }, data: patch });
    return this.toDTO(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.campaign.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Campaign not found');
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────── schedule / pause ─────────────────────

  // Arm a campaign: status → SCHEDULED and compute the first dispatch time.
  // For ONCE and the first run of a recurring cadence that's `runAt`; for CRON
  // it's the next cron occurrence from now.
  async schedule(id: string): Promise<CampaignDTO> {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Campaign not found');
    const nextRunAt = this.computeFirstRun(
      existing.cadence,
      existing.runAt,
      existing.cron,
    );
    const row = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'SCHEDULED', nextRunAt },
    });
    return this.toDTO(row);
  }

  // Pause a scheduled campaign — it stops being picked up by the scheduler.
  // nextRunAt is retained so resume() can decide whether it's stale.
  async pause(id: string): Promise<CampaignDTO> {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Campaign not found');
    const row = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    return this.toDTO(row);
  }

  // Resume a paused campaign back to SCHEDULED. If its nextRunAt is missing or
  // already in the past (it sat paused through its slot), recompute from now so
  // a ONCE campaign doesn't fire instantly on an ancient runAt.
  async resume(id: string): Promise<CampaignDTO> {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Campaign not found');
    const now = new Date();
    let nextRunAt = existing.nextRunAt;
    if (!nextRunAt || nextRunAt <= now) {
      nextRunAt = this.computeFirstRun(
        existing.cadence,
        existing.runAt,
        existing.cron,
      );
    }
    const row = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'SCHEDULED', nextRunAt },
    });
    return this.toDTO(row);
  }

  // ───────────────────── scheduler dispatch ─────────────────────

  // Called every minute by SchedulerService. Sends each SCHEDULED campaign whose
  // nextRunAt has arrived, then advances (or finishes) it per cadence. Campaigns
  // are processed sequentially; one campaign's failure can't strand the others
  // (each is wrapped). Returns the count dispatched (handy for tests/logs).
  async runDueCampaigns(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.campaign.findMany({
      where: { status: 'SCHEDULED', nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
    });
    let dispatched = 0;
    for (const campaign of due) {
      try {
        await this.runCampaign(campaign, now);
        dispatched += 1;
      } catch (err) {
        this.logger.error(
          `campaign "${campaign.name}" (${campaign.id}) run failed: ${this.msg(
            err,
          )}`,
        );
      }
    }
    return dispatched;
  }

  // Send one campaign to its resolved recipients, then re-arm/finish it. A
  // per-run stamp (the dispatch timestamp) makes the dedupeKey unique to THIS
  // run, so a recurring campaign re-sends next period but a re-tick of the same
  // run is idempotent.
  private async runCampaign(campaign: Campaign, now: Date): Promise<void> {
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'SENDING' },
    });

    const runStamp = (campaign.nextRunAt ?? now).getTime().toString();
    const brand = (await this.appConfig.read()).title;
    const recipients = await this.resolveRecipients(campaign);
    if (recipients.length >= MAX_RECIPIENTS_PER_RUN) {
      this.logger.warn(
        `campaign "${campaign.name}" (${campaign.id}) capped at ${MAX_RECIPIENTS_PER_RUN} recipients`,
      );
    }

    let sent = 0;
    for (const r of recipients) {
      const firstName = (r.firstName ?? '').trim() || 'there';
      await this.email.sendTemplate({
        to: r.email,
        templateId: campaign.templateId,
        vars: { firstName, email: r.email, brand },
        contactId: r.id,
        dedupeKey: `campaign:${campaign.id}:${runStamp}:${r.id}`,
      });
      sent += 1;
    }

    // Advance the schedule. ONCE finishes; recurring re-arms and stays SCHEDULED.
    const next = this.advance(campaign, now);
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: next.status,
        nextRunAt: next.nextRunAt,
        lastRunAt: now,
        sentCount: { increment: sent },
      },
    });
    this.logger.log(
      `campaign "${campaign.name}" (${campaign.id}) sent ${sent} → ${next.status}`,
    );
  }

  // Resolve the recipient set: SUBSCRIBED contacts in the audience, further
  // narrowed by the campaign's segment filter when set. Capped + deterministically
  // ordered (createdAt, id) so a capped run is stable. Public-ish helper kept
  // small and side-effect-free for testability.
  private async resolveRecipients(
    campaign: Campaign,
  ): Promise<{ id: string; email: string; firstName: string | null }[]> {
    const where: Prisma.ContactWhereInput = {
      audienceId: campaign.audienceId,
      status: 'SUBSCRIBED',
    };

    if (campaign.segmentId) {
      const segment = await this.prisma.segment.findUnique({
        where: { id: campaign.segmentId },
        select: { audienceId: true, filter: true },
      });
      // A deleted segment (or one pointing elsewhere) is ignored — we fall back
      // to the whole audience rather than silently sending to nobody.
      if (segment && segment.audienceId === campaign.audienceId) {
        this.applyFilter(where, (segment.filter ?? {}) as ContactFilter);
      }
    }

    const rows = await this.prisma.contact.findMany({
      where,
      select: { id: true, email: true, firstName: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_RECIPIENTS_PER_RUN,
    });
    return rows;
  }

  // Layer a ContactFilter onto a base where-clause (mirrors the contacts-admin
  // segment resolver). `status` from the filter overrides the SUBSCRIBED base —
  // but a campaign should never mail unsubscribed/cleaned contacts, so we keep
  // the base SUBSCRIBED and only honor an explicit SUBSCRIBED/PENDING narrowing.
  private applyFilter(
    where: Prisma.ContactWhereInput,
    filter: ContactFilter,
  ): void {
    if (filter.status === 'SUBSCRIBED' || filter.status === 'PENDING') {
      where.status = filter.status;
    }
    if (filter.anyTags?.length) where.tags = { hasSome: filter.anyTags };
    if (filter.allTags?.length) {
      where.AND = [{ tags: { hasEvery: filter.allTags } }];
    }
    const search = filter.search?.trim();
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }
  }

  // ───────────────────── cadence math ─────────────────────

  // First dispatch time when a campaign is (re)scheduled. ONCE & the first run
  // of WEEKLY/MONTHLY are the configured runAt (fallback: now, so a no-date
  // campaign fires on the next tick). CRON is the next occurrence from now.
  private computeFirstRun(
    cadence: Campaign['cadence'],
    runAt: Date | null,
    cron: string | null,
  ): Date {
    if (cadence === 'CRON') {
      return this.nextCron(cron, new Date());
    }
    return runAt ?? new Date();
  }

  // Compute the post-send schedule for a campaign that just ran at `now`.
  private advance(
    campaign: Campaign,
    now: Date,
  ): { status: Campaign['status']; nextRunAt: Date | null } {
    switch (campaign.cadence) {
      case 'ONCE':
        return { status: 'SENT', nextRunAt: null };
      case 'WEEKLY':
        return { status: 'SCHEDULED', nextRunAt: this.addDays(now, 7) };
      case 'MONTHLY':
        return { status: 'SCHEDULED', nextRunAt: this.addMonths(now, 1) };
      case 'CRON':
        return { status: 'SCHEDULED', nextRunAt: this.nextCron(campaign.cron, now) };
      default:
        return { status: 'SENT', nextRunAt: null };
    }
  }

  // Next cron occurrence strictly after `from`. A missing/invalid expression
  // can't crash a run — we fall back to +1 day so the campaign re-arms instead
  // of getting stuck SENDING.
  private nextCron(cron: string | null, from: Date): Date {
    const expr = cron?.trim();
    if (!expr) return this.addDays(from, 1);
    try {
      return CronExpressionParser.parse(expr, { currentDate: from })
        .next()
        .toDate();
    } catch (err) {
      this.logger.warn(`invalid cron "${expr}": ${this.msg(err)} — +1d fallback`);
      return this.addDays(from, 1);
    }
  }

  private addDays(d: Date, days: number): Date {
    return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
  }

  // Calendar month add (clamps end-of-month, e.g. Jan 31 + 1mo → Feb 28/29).
  private addMonths(d: Date, months: number): Date {
    const out = new Date(d.getTime());
    const day = out.getDate();
    out.setDate(1);
    out.setMonth(out.getMonth() + months);
    const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(day, last));
    return out;
  }

  // Validate/normalize cadence-related inputs into stored shapes. CRON requires
  // a cron string; ONCE/WEEKLY/MONTHLY use runAt. Only the keys present in the
  // input are returned-shaped, but callers gate writes on `=== undefined`.
  private normalizeInput(input: CampaignInput): {
    cadence: Campaign['cadence'];
    runAt: Date | null;
    cron: string | null;
  } {
    const cadence = (input.cadence ?? 'ONCE') as Campaign['cadence'];
    const runAt = input.runAt ? new Date(input.runAt) : null;
    const cron = input.cron?.trim() || null;
    return {
      cadence,
      runAt: runAt && !isNaN(runAt.getTime()) ? runAt : null,
      cron,
    };
  }

  private toDTO(c: Campaign): CampaignDTO {
    return {
      id: c.id,
      name: c.name,
      templateId: c.templateId,
      audienceId: c.audienceId,
      segmentId: c.segmentId,
      cadence: c.cadence,
      runAt: c.runAt ? c.runAt.toISOString() : null,
      cron: c.cron,
      status: c.status,
      nextRunAt: c.nextRunAt ? c.nextRunAt.toISOString() : null,
      lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
      sentCount: c.sentCount,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
