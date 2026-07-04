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

// Page size for resolving + sending a run. We no longer cap the audience: a run
// sends to EVERY eligible recipient, walked in deterministic (createdAt, id)
// order in batches of this size (keyset pagination) so we never silently drop
// the tail of a large list.
const RECIPIENT_BATCH_SIZE = 5000;

// A campaign found in SENDING whose updatedAt is older than this is presumed
// orphaned (process died / redeploy mid-run) and is self-healed back to
// SCHEDULED by the recovery sweep at the top of each tick. Generous enough that
// it never trips a genuinely in-flight run on a slow batch.
const STUCK_SENDING_MS = 15 * 60 * 1000;

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
        timezone: data.timezone,
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
    if (input.timezone !== undefined) patch.timezone = data.timezone;

    // Editing a SCHEDULED campaign's timing should re-arm its next dispatch so
    // the change takes effect, rather than firing on the stale nextRunAt. A
    // timezone change shifts a cron/recurring schedule, so it counts as timing.
    if (
      existing.status === 'SCHEDULED' &&
      (input.cadence !== undefined ||
        input.runAt !== undefined ||
        input.cron !== undefined ||
        input.timezone !== undefined)
    ) {
      const cadence = data.cadence ?? existing.cadence;
      const runAt = input.runAt !== undefined ? data.runAt : existing.runAt;
      const cron = input.cron !== undefined ? data.cron : existing.cron;
      const tz = input.timezone !== undefined ? data.timezone : existing.timezone;
      patch.nextRunAt = this.computeFirstRun(cadence, runAt, cron, tz);
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
      existing.timezone,
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
        existing.timezone,
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

    // Self-heal: any campaign left in SENDING by a crashed/redeployed run (its
    // updatedAt has gone stale) is reset to SCHEDULED so the next tick retries.
    // Scoped to SENDING + old updatedAt so it can never disturb a live run, and
    // idempotent (a no-op once nothing is stuck).
    await this.recoverStuckSending(now);

    const due = await this.prisma.campaign.findMany({
      where: { status: 'SCHEDULED', nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
    });
    let dispatched = 0;
    for (const campaign of due) {
      // Atomic claim: flip SCHEDULED → SENDING in a single conditional update.
      // Only the instance whose updateMany actually matched (count === 1) owns
      // this run; a concurrent tick / second instance sees count === 0 and skips,
      // which prevents the double-send that the prior read-then-write allowed.
      const claim = await this.prisma.campaign.updateMany({
        where: { id: campaign.id, status: 'SCHEDULED' },
        data: { status: 'SENDING' },
      });
      if (claim.count !== 1) continue;

      try {
        await this.runCampaign(campaign, now);
        dispatched += 1;
      } catch (err) {
        // We own the claim, so a throw here would otherwise strand the campaign
        // in SENDING forever (the due query only selects SCHEDULED). Re-arm it.
        this.logger.error(
          `campaign "${campaign.name}" (${campaign.id}) run failed: ${this.msg(
            err,
          )}`,
        );
        await this.resetAfterFailure(campaign, now, this.msg(err));
      }
    }
    return dispatched;
  }

  // Reset campaigns orphaned in SENDING (older than STUCK_SENDING_MS) back to
  // SCHEDULED. nextRunAt is left as-is: it's still the intended slot, already in
  // the past, so the next tick re-claims and retries this run.
  private async recoverStuckSending(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - STUCK_SENDING_MS);
    const healed = await this.prisma.campaign.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: cutoff } },
      data: { status: 'SCHEDULED' },
    });
    if (healed.count > 0) {
      this.logger.warn(
        `recovered ${healed.count} campaign(s) stuck in SENDING → SCHEDULED`,
      );
    }
  }

  // Re-arm a campaign that threw mid-run (after we'd claimed it into SENDING).
  // CampaignStatus has no FAILED state, so the safe resting place is:
  //  - recurring (WEEKLY/MONTHLY/CRON): back to SCHEDULED with a sane nextRunAt
  //    so the next tick retries — we advance from the prior slot if its time has
  //    passed, else keep it, so the cadence anchor is preserved.
  //  - ONCE: PAUSED, so it doesn't auto-retry the same broken run every minute;
  //    the admin sees a paused campaign and the error is in the logs.
  // Best-effort: a throw here is swallowed so one bad campaign can't crash the
  // tick or block the others.
  private async resetAfterFailure(
    campaign: Campaign,
    now: Date,
    error: string,
  ): Promise<void> {
    try {
      if (campaign.cadence === 'ONCE') {
        await this.prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'PAUSED' },
        });
        this.logger.error(
          `campaign "${campaign.name}" (${campaign.id}) ONCE run failed → PAUSED: ${error}`,
        );
        return;
      }
      const slot = campaign.nextRunAt ?? now;
      const nextRunAt = slot <= now ? this.advanceSlot(campaign, slot, now) : slot;
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'SCHEDULED', nextRunAt },
      });
    } catch (err) {
      this.logger.error(
        `campaign "${campaign.name}" (${campaign.id}) failure-reset errored: ${this.msg(
          err,
        )}`,
      );
    }
  }

  // Send one campaign to its resolved recipients, then re-arm/finish it. The
  // caller has already atomically claimed this campaign into SENDING. A per-run
  // stamp (the intended-slot timestamp) makes the dedupeKey unique to THIS run,
  // so a recurring campaign re-sends next period but a re-tick of the same run
  // is idempotent.
  private async runCampaign(campaign: Campaign, now: Date): Promise<void> {
    // Pre-validate the run's hard dependencies BEFORE doing any sending: a
    // deleted template or audience would otherwise burn the whole run with zero
    // sends and leave the cadence advancing as if it had succeeded. If either is
    // gone we PAUSE the campaign (CampaignStatus has no FAILED) so the admin sees
    // it stopped, and log why. We do NOT throw — that would let the tick's catch
    // re-arm and silently retry a permanently-broken campaign every minute.
    const invalid = await this.validateRunnable(campaign);
    if (invalid) {
      await this.prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'PAUSED' },
      });
      this.logger.error(
        `campaign "${campaign.name}" (${campaign.id}) not runnable → PAUSED: ${invalid}`,
      );
      return;
    }

    const runStamp = (campaign.nextRunAt ?? now).getTime().toString();
    const brand = (await this.appConfig.read()).title;

    // Walk the entire audience in deterministic batches (keyset on createdAt,id)
    // — no per-run cap, so a list larger than a single page still gets every
    // recipient. sentCount counts DELIVERIES only: sendTemplate returns the
    // EmailLog, and a suppressed/failed recipient comes back non-'SENT' and must
    // not inflate the count.
    let sent = 0;
    let attempted = 0;
    for await (const r of this.iterateRecipients(campaign)) {
      attempted += 1;
      const firstName = (r.firstName ?? '').trim() || 'there';
      const log = await this.email.sendTemplate({
        to: r.email,
        templateId: campaign.templateId,
        vars: { firstName, email: r.email, brand },
        contactId: r.id,
        dedupeKey: `campaign:${campaign.id}:${runStamp}:${r.id}`,
      });
      if (log.status === 'SENT') sent += 1;
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
      `campaign "${campaign.name}" (${campaign.id}) delivered ${sent}/${attempted} → ${next.status}`,
    );
  }

  // Pre-flight a claimed run's dependencies. Returns a human-readable reason when
  // the run can't proceed (so the caller can log it), or null when ok. Checks the
  // template and the audience still exist — a vanished template/audience must not
  // burn a run with zero sends while the cadence advances as if delivered. (An
  // audience that simply has no SUBSCRIBED contacts is a valid 0-recipient run,
  // NOT an error, so it's intentionally not treated as invalid here.)
  private async validateRunnable(campaign: Campaign): Promise<string | null> {
    const template = await this.prisma.emailTemplate.findUnique({
      where: { id: campaign.templateId },
      select: { id: true },
    });
    if (!template) {
      return `template ${campaign.templateId} no longer exists`;
    }
    const audience = await this.prisma.audience.findUnique({
      where: { id: campaign.audienceId },
      select: { id: true },
    });
    if (!audience) {
      return `audience ${campaign.audienceId} no longer exists`;
    }
    return null;
  }

  // Build the recipient where-clause: SUBSCRIBED contacts in the audience,
  // further narrowed by the campaign's segment filter when set. Kept separate
  // from iteration so it's small and testable.
  private async buildRecipientWhere(
    campaign: Campaign,
  ): Promise<Prisma.ContactWhereInput> {
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
    return where;
  }

  // Stream the FULL recipient set in deterministic (createdAt, id) order using
  // keyset pagination — every eligible contact is yielded, in stable batches of
  // RECIPIENT_BATCH_SIZE, with no silent tail-truncation. Keyset (not offset)
  // pagination keeps the walk correct even though contacts can be unsubscribed
  // mid-run. The (createdAt, id) order matches the @@index([audienceId,status])
  // ordering well enough to stay cheap.
  private async *iterateRecipients(
    campaign: Campaign,
  ): AsyncGenerator<{ id: string; email: string; firstName: string | null }> {
    const where = await this.buildRecipientWhere(campaign);
    let cursor: { createdAt: Date; id: string } | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pageWhere: Prisma.ContactWhereInput = cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              },
            ],
          }
        : where;

      const rows = await this.prisma.contact.findMany({
        where: pageWhere,
        select: { id: true, email: true, firstName: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: RECIPIENT_BATCH_SIZE,
      });
      if (rows.length === 0) break;

      for (const r of rows) {
        yield { id: r.id, email: r.email, firstName: r.firstName };
      }

      if (rows.length < RECIPIENT_BATCH_SIZE) break;
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }

  // Layer a ContactFilter onto a base where-clause (mirrors the contacts-admin
  // segment resolver). A campaign sends ONLY to SUBSCRIBED (confirmed) contacts,
  // so we honor an explicit SUBSCRIBED narrowing but never widen to PENDING or
  // any other non-deliverable status — the SUBSCRIBED base stands otherwise.
  private applyFilter(
    where: Prisma.ContactWhereInput,
    filter: ContactFilter,
  ): void {
    if (filter.status === 'SUBSCRIBED') {
      where.status = filter.status;
    }
    if (filter.anyTags?.length) where.tags = { hasSome: filter.anyTags };
    if (filter.allTags?.length) {
      // Push onto an AND array so an allTags constraint composes with anything
      // else already there (and with the keyset cursor's AND) instead of
      // clobbering a prior where.AND.
      const and = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      and.push({ tags: { hasEvery: filter.allTags } });
      where.AND = and;
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
  // campaign fires on the next tick). CRON is the next occurrence from now,
  // resolved in the campaign's timezone.
  private computeFirstRun(
    cadence: Campaign['cadence'],
    runAt: Date | null,
    cron: string | null,
    tz: string | null,
  ): Date {
    if (cadence === 'CRON') {
      return this.nextCron(cron, new Date(), tz);
    }
    return runAt ?? new Date();
  }

  // Compute the post-send schedule for a campaign that just ran. Recurring
  // cadences re-arm from their INTENDED slot (the prior nextRunAt), not from
  // `now` — see advanceSlot — so missed ticks during downtime don't drift the
  // cadence anchor. All recurring math resolves against the campaign's explicit
  // timezone (null => UTC), the SAME base for cron and weekly/monthly.
  private advance(
    campaign: Campaign,
    now: Date,
  ): { status: Campaign['status']; nextRunAt: Date | null } {
    if (campaign.cadence === 'ONCE') {
      return { status: 'SENT', nextRunAt: null };
    }
    const slot = campaign.nextRunAt ?? now;
    return { status: 'SCHEDULED', nextRunAt: this.advanceSlot(campaign, slot, now) };
  }

  // Advance a recurring cadence forward from its intended `slot`, looping until
  // the result is strictly after `now`. Anchoring on the slot (rather than
  // `now`) preserves the cadence's phase across downtime: a "monthly on the 1st"
  // that misses a tick still lands on the 1st, not on whatever day recovery ran.
  private advanceSlot(campaign: Campaign, slot: Date, now: Date): Date {
    const tz = campaign.timezone ?? null;
    let next = slot;
    // Bounded loop guard: even a daily cadence can't exceed a few thousand steps
    // across any realistic downtime; the cap just prevents a pathological spin.
    for (let i = 0; i < 10000; i++) {
      switch (campaign.cadence) {
        case 'WEEKLY':
          next = this.addDays(next, 7);
          break;
        case 'MONTHLY':
          next = this.addMonths(next, 1, tz);
          break;
        case 'CRON':
          next = this.nextCron(campaign.cron, next, tz);
          break;
        default:
          return next;
      }
      if (next > now) return next;
    }
    return next;
  }

  // Next cron occurrence strictly after `from`, evaluated in the campaign's
  // timezone (null => UTC, which is cron-parser's default base). A missing/
  // invalid expression can't crash a run — we fall back to +1 day so the
  // campaign re-arms instead of getting stuck SENDING.
  private nextCron(cron: string | null, from: Date, tz: string | null): Date {
    const expr = cron?.trim();
    if (!expr) return this.addDays(from, 1);
    try {
      return CronExpressionParser.parse(expr, {
        currentDate: from,
        tz: tz || 'UTC',
      })
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

  // Calendar month add anchored to the campaign's timezone (clamps end-of-month,
  // e.g. Jan 31 + 1mo → Feb 28/29). We read the date's Y/M/D/H/M/S as seen in
  // `tz` (via Intl), bump the month with JS-Date clamping semantics, then map the
  // wall-clock back to an instant in `tz`. tz === null means UTC, so we use the
  // UTC field accessors for a stable, host-independent base. This keeps monthly
  // and cron campaigns resolving against the SAME explicit zone rather than the
  // server's implicit local time.
  private addMonths(d: Date, months: number, tz: string | null): Date {
    const wall = this.wallClockIn(d, tz);
    // Month add with end-of-month clamp, computed on plain wall-clock fields.
    let year = wall.year;
    let monthIndex = wall.month - 1 + months;
    year += Math.floor(monthIndex / 12);
    monthIndex = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const day = Math.min(wall.day, lastDay);
    return this.instantFromWallClock(
      { year, month: monthIndex + 1, day, hour: wall.hour, minute: wall.minute, second: wall.second },
      tz,
    );
  }

  // Decompose an instant into wall-clock Y/M/D/H/M/S as seen in `tz` (UTC when
  // null). Uses Intl so it's correct across DST without a date library.
  private wallClockIn(
    d: Date,
    tz: string | null,
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    if (!tz || tz === 'UTC') {
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
      };
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string): number =>
      Number(parts.find((p) => p.type === t)?.value ?? '0');
    // Intl can emit hour '24' at midnight for hour12:false; normalize to 0.
    const hour = get('hour') % 24;
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour,
      minute: get('minute'),
      second: get('second'),
    };
  }

  // Inverse of wallClockIn: given wall-clock fields that should be interpreted in
  // `tz`, return the corresponding UTC instant. We compute the tz's offset at the
  // candidate instant and subtract it. For UTC (or null) this is a plain
  // Date.UTC. Good enough for monthly scheduling (DST edge minutes don't matter
  // at this granularity).
  private instantFromWallClock(
    wall: {
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
    },
    tz: string | null,
  ): Date {
    const asUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    if (!tz || tz === 'UTC') return new Date(asUtc);
    // Offset (ms) that `tz` is ahead of UTC at this instant; subtract to get the
    // UTC instant whose wall-clock-in-tz matches the requested fields.
    const offsetMs = this.tzOffsetMs(new Date(asUtc), tz);
    return new Date(asUtc - offsetMs);
  }

  // Milliseconds `tz` is ahead of UTC at instant `d` (negative west of UTC).
  private tzOffsetMs(d: Date, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string): number =>
      Number(parts.find((p) => p.type === t)?.value ?? '0');
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - d.getTime();
  }

  // Validate/normalize cadence-related inputs into stored shapes. CRON requires
  // a cron string; ONCE/WEEKLY/MONTHLY use runAt. Only the keys present in the
  // input are returned-shaped, but callers gate writes on `=== undefined`.
  private normalizeInput(input: CampaignInput): {
    cadence: Campaign['cadence'];
    runAt: Date | null;
    cron: string | null;
    timezone: string | null;
  } {
    const cadence = (input.cadence ?? 'ONCE') as Campaign['cadence'];
    const runAt = input.runAt ? new Date(input.runAt) : null;
    const cron = input.cron?.trim() || null;
    // IANA tz string; blank/whitespace normalizes to null (=> UTC at runtime).
    const timezone = input.timezone?.trim() || null;
    return {
      cadence,
      runAt: runAt && !isNaN(runAt.getTime()) ? runAt : null,
      cron,
      timezone,
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
      timezone: c.timezone ?? undefined,
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
