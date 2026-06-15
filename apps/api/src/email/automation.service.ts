import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
      try {
        await this.email.sendTemplate({
          to: ctx.email,
          templateId: automation.templateId,
          vars: ctx.vars,
          contactId: ctx.contactId,
          dedupeKey: `automation:${automation.id}:${recipientKey}`,
        });
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
