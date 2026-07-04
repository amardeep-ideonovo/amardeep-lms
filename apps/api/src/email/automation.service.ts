import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, type Automation, type AutomationTrigger } from '@prisma/client';
import type { AutomationDTO, AutomationInput } from '@lms/types';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

// Context handed to fire(): who to mail, the optional Contact link, and the
// merge vars the target template expects.
export interface AutomationFireContext {
  email: string;
  contactId?: string;
  vars: Record<string, unknown>;
}

// Owns automations (event-triggered emails) — the inverse of campaigns: instead
// of a schedule, a domain event (signup, subscription, certificate, …) calls
// fire(trigger, ctx) and every ACTIVE automation on that trigger sends its
// template. CRUD here; the wiring lives at the event sites (auth.service for
// SIGNUP, certificates.service for CERTIFICATE_ISSUED). fire() is best-effort
// and NEVER throws — a misfiring automation must not break the business flow
// that triggered it. Idempotency is per (automation, recipient) via dedupeKey.
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ───────────────────────── fire ─────────────────────────

  // Dispatch every ACTIVE automation registered for `trigger`. Best-effort: a
  // bad template / send failure on one automation is logged and skipped, never
  // propagated (EmailService.send already swallows transport errors; this guard
  // covers the render path too). dedupeKey makes a re-fired event idempotent per
  // recipient — e.g. a retried signup won't double-send the welcome.
  async fire(
    trigger: AutomationTrigger,
    ctx: AutomationFireContext,
  ): Promise<void> {
    let automations: Automation[];
    try {
      automations = await this.prisma.automation.findMany({
        where: { trigger, active: true },
      });
    } catch (err) {
      this.logger.warn(`automation lookup for ${trigger} failed: ${this.msg(err)}`);
      return;
    }

    const recipientKey = ctx.contactId || ctx.email;
    for (const automation of automations) {
      // Same idempotency key whether we send now or defer — so a retried event
      // can't both enqueue a deferred row AND fire an immediate send (the
      // ScheduledEmail.dedupeKey is @unique, and the eventual EmailLog inherits
      // it). Keep this in lockstep with drainScheduledEmails() below.
      const dedupeKey = `automation:${automation.id}:${recipientKey}`;
      try {
        if (automation.delayMinutes > 0) {
          // Deferred: park a ScheduledEmail row that the minute cron drains once
          // sendAt arrives. The @unique dedupeKey makes a re-fired event a no-op
          // (the duplicate insert is swallowed below).
          await this.enqueueDeferred(automation, ctx, dedupeKey);
        } else {
          await this.email.sendTemplate({
            to: ctx.email,
            templateId: automation.templateId,
            vars: ctx.vars,
            contactId: ctx.contactId,
            dedupeKey,
          });
        }
      } catch (err) {
        // Render/missing-template errors land here; transport failures are
        // already recorded as FAILED EmailLog rows inside EmailService.
        this.logger.warn(
          `automation "${automation.name}" (${automation.id}) failed for ${ctx.email}: ${this.msg(
            err,
          )}`,
        );
      }
    }
  }

  // Park a delayed automation send as a ScheduledEmail row. sendAt = now +
  // delayMinutes; the dedupeKey (@unique) carries the same idempotency the
  // immediate path uses, so a re-fired event that already enqueued one is a
  // no-op (P2002 is treated as "already scheduled" and swallowed).
  private async enqueueDeferred(
    automation: Automation,
    ctx: AutomationFireContext,
    dedupeKey: string,
  ): Promise<void> {
    const sendAt = new Date(Date.now() + automation.delayMinutes * 60_000);
    try {
      await this.prisma.scheduledEmail.create({
        data: {
          automationId: automation.id,
          to: ctx.email,
          templateId: automation.templateId,
          vars: (ctx.vars ?? {}) as unknown as Prisma.InputJsonValue,
          sendAt,
          dedupeKey,
          contactId: ctx.contactId,
        },
      });
    } catch (err) {
      // A repeat of the same event already scheduled this send — fine, leave it.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  // ─────────────────── deferred drain (minute cron) ───────────────────

  // Re-entrancy guard mirroring SchedulerService.running: if a drain is still
  // running when the next tick fires, skip rather than double-process.
  private draining = false;

  // Drain due ScheduledEmail rows once a minute. Coexists with the campaign
  // scheduler's @Cron (ScheduleModule is registered in EmailModule). Each row is
  // CLAIMED with a guarded updateMany (status PENDING -> SENT) so an overlapping
  // tick or a second instance can't double-send: only the worker whose update
  // matched (count===1) proceeds to send. We mark SENT *before* the actual send
  // because EmailService.sendTemplate is itself idempotent on dedupeKey (a
  // SENT EmailLog short-circuits), so a crash mid-send at worst drops one
  // best-effort deferred mail rather than re-sending it; a genuine send throw
  // flips the row to FAILED with the error recorded.
  @Cron(CronExpression.EVERY_MINUTE)
  async drainScheduledEmails(): Promise<void> {
    if (this.draining) {
      this.logger.debug('scheduled-email drain skipped — previous run still in progress');
      return;
    }
    this.draining = true;
    try {
      const now = new Date();
      const due = await this.prisma.scheduledEmail.findMany({
        where: { status: 'PENDING', sendAt: { lte: now } },
        orderBy: { sendAt: 'asc' },
        take: 200,
      });
      let sent = 0;
      for (const row of due) {
        // Atomic claim: only the worker that flips PENDING->SENT proceeds.
        const claim = await this.prisma.scheduledEmail.updateMany({
          where: { id: row.id, status: 'PENDING' },
          data: { status: 'SENT', sentAt: new Date() },
        });
        if (claim.count !== 1) continue; // lost the race — another worker has it

        try {
          const log = await this.email.sendTemplate({
            to: row.to,
            templateId: row.templateId ?? undefined,
            templateKey: row.templateKey ?? undefined,
            vars: (row.vars ?? {}) as unknown as Record<string, unknown>,
            contactId: row.contactId ?? undefined,
            dedupeKey: row.dedupeKey ?? undefined,
          });
          // sendTemplate never throws: a non-SENT result (suppressed / sender not
          // configured / render failure) means the deferred mail did NOT go out.
          // Reflect that on the row instead of leaving the optimistic SENT claim.
          if (log.status === 'SENT') {
            sent++;
          } else {
            await this.prisma.scheduledEmail
              .update({
                where: { id: row.id },
                data: {
                  status: 'FAILED',
                  error: (log.error ?? log.status).slice(0, 500),
                },
              })
              .catch(() => undefined);
          }
        } catch (err) {
          await this.prisma.scheduledEmail
            .update({
              where: { id: row.id },
              data: { status: 'FAILED', error: this.msg(err).slice(0, 500) },
            })
            .catch(() => undefined);
          this.logger.warn(
            `scheduled email ${row.id} (automation ${row.automationId}) failed for ${row.to}: ${this.msg(
              err,
            )}`,
          );
        }
      }
      if (sent > 0) {
        this.logger.log(`scheduled-email drain dispatched ${sent} deferred mail(s)`);
      }
    } catch (err) {
      this.logger.error(`scheduled-email drain failed: ${this.msg(err)}`);
    } finally {
      this.draining = false;
    }
  }

  // ───────────────────────── CRUD ─────────────────────────

  async list(): Promise<AutomationDTO[]> {
    const rows = await this.prisma.automation.findMany({
      orderBy: [{ trigger: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((a) => this.toDTO(a));
  }

  async create(input: AutomationInput): Promise<AutomationDTO> {
    if (!input.trigger) {
      throw new BadRequestException('A trigger is required');
    }
    if (!input.templateId) {
      throw new BadRequestException('A template is required');
    }
    const row = await this.prisma.automation.create({
      data: {
        name: (input.name ?? '').trim() || 'Untitled automation',
        trigger: input.trigger as AutomationTrigger,
        templateId: input.templateId,
        active: input.active ?? true,
        delayMinutes:
          typeof input.delayMinutes === 'number' && input.delayMinutes > 0
            ? Math.floor(input.delayMinutes)
            : 0,
      },
    });
    return this.toDTO(row);
  }

  async update(id: string, input: AutomationInput): Promise<AutomationDTO> {
    const existing = await this.prisma.automation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Automation not found');

    const patch: Prisma.AutomationUpdateInput = {};
    if (input.name !== undefined) {
      patch.name = input.name.trim() || 'Untitled automation';
    }
    if (input.trigger !== undefined) {
      patch.trigger = input.trigger as AutomationTrigger;
    }
    if (input.templateId !== undefined) patch.templateId = input.templateId;
    if (input.active !== undefined) patch.active = input.active;
    if (input.delayMinutes !== undefined) {
      patch.delayMinutes =
        typeof input.delayMinutes === 'number' && input.delayMinutes > 0
          ? Math.floor(input.delayMinutes)
          : 0;
    }

    const row = await this.prisma.automation.update({ where: { id }, data: patch });
    return this.toDTO(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.automation.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Automation not found');
    await this.prisma.automation.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────── system automations ─────────────────────

  // Seed the built-in automations on boot. Today: a SIGNUP "Welcome" automation
  // pointing at the `welcome` system template, so the signup welcome mail (moved
  // out of auth.service into this engine) keeps working out of the box AND is now
  // admin-configurable. Only created when NO automation exists for SIGNUP yet, so
  // an admin who deleted/replaced it isn't overridden on the next deploy. Must be
  // called AFTER ensureSystemTemplates() (the welcome template must exist first).
  async ensureSystemAutomations(): Promise<void> {
    try {
      const existing = await this.prisma.automation.findFirst({
        where: { trigger: 'SIGNUP' },
        select: { id: true },
      });
      if (existing) return;

      const welcome = await this.prisma.emailTemplate.findUnique({
        where: { key: 'welcome' },
        select: { id: true },
      });
      if (!welcome) {
        this.logger.warn(
          'ensureSystemAutomations: welcome template missing — skipping SIGNUP seed',
        );
        return;
      }

      await this.prisma.automation.create({
        data: {
          name: 'Welcome',
          trigger: 'SIGNUP',
          templateId: welcome.id,
          active: true,
        },
      });
      this.logger.log('Seeded system automation "Welcome" (SIGNUP)');
    } catch (err) {
      // Never let a bootstrap-time DB hiccup take down app startup.
      this.logger.warn(`ensureSystemAutomations failed: ${this.msg(err)}`);
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  private toDTO(a: Automation): AutomationDTO {
    return {
      id: a.id,
      name: a.name,
      trigger: a.trigger,
      templateId: a.templateId,
      active: a.active,
      delayMinutes: a.delayMinutes,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
