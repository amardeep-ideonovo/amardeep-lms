import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EmailLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplateService } from './email-template.service';
import { MAIL_SENDER, type MailSender } from './mail-sender.interface';
import { makeUnsubscribeToken } from './unsubscribe.util';

// Absolute base for the public unsubscribe link. PUBLIC_API_URL is the
// established prod convention (same one auth/media/lms controllers use); we also
// honor API_BASE_URL per the email spec, then fall back to localhost for dev.
function apiBaseUrl(): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/$/, '') ||
    process.env.API_BASE_URL?.replace(/\/$/, '') ||
    'http://localhost:3000'
  );
}

// What a caller hands to EmailService.sendTemplate(): a recipient, the template
// to render (by stable key OR by id), and the merge vars. Bookkeeping fields
// (contactId/dedupeKey) flow through to the underlying send() / EmailLog row.
export interface SendTemplateInput {
  to: string;
  templateKey?: string;
  templateId?: string;
  vars: Record<string, unknown>;
  contactId?: string;
  dedupeKey?: string;
  // Security/account mail (e.g. password reset) that must reach the recipient
  // even when they've unsubscribed from marketing. Skips ONLY the suppression
  // check — idempotency, audit logging and provider transport are unchanged.
  transactional?: boolean;
}

// What a caller hands to EmailService.send(). Everything past `html` is
// bookkeeping written onto the EmailLog row (so a later phase can correlate
// templates/campaigns and provider webhooks).
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  contactId?: string;
  templateKey?: string;
  campaignId?: string;
  // Idempotency key (unique on EmailLog): a repeat send with the same key that
  // already succeeded is skipped and the prior row returned.
  dedupeKey?: string;
  // Bypass suppression for security/account mail (see SendTemplateInput).
  transactional?: boolean;
  // One-click unsubscribe URL surfaced as a List-Unsubscribe header. Set
  // automatically for templated sends (see sendTemplate); raw send() callers may
  // pass their own. Not persisted — transport-only.
  listUnsubscribe?: string;
}

// Central send path for ALL outbound mail. Owns the pre-send guarantees so no
// caller has to: idempotency (dedupeKey), suppression (unsubscribed/cleaned/
// opted-out recipients), an EmailLog audit row for every attempt, and — most
// importantly — it NEVER throws. A mail failure must never break the business
// flow that triggered it (signup, purchase, …); failures are recorded on the
// log row instead. Provider transport is delegated to the injected MailSender.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_SENDER) private readonly sender: MailSender,
    private readonly templates: EmailTemplateService,
  ) {}

  // Render a stored template (by key or id) then hand the result to send(). The
  // single entry point for templated mail (welcome, future automations) so the
  // MJML/Handlebars render and the suppression/idempotency/ledger guarantees of
  // send() stay in one path. This is a dispatch path used by non-HTTP callers
  // (signup, automations, scheduler), so — like send() — it must never break the
  // triggering flow: a render failure (missing template / bad MJML) is caught and
  // recorded as a FAILED EmailLog rather than thrown. (Admin-facing direct
  // preview/test endpoints render through EmailTemplateService and still surface
  // a clean 404/400.)
  async sendTemplate(input: SendTemplateInput): Promise<EmailLog> {
    if (!input.templateKey && !input.templateId) {
      // A programmer error (no template specified) — still never break the
      // dispatch flow; record it as a FAILED row like any other render failure.
      return this.recordRenderFailure(
        input,
        'sendTemplate requires templateKey or templateId',
      );
    }

    // Per-recipient signed unsubscribe link. Merge it into the render vars so any
    // template ({{unsubscribeUrl}}) can show a footer link, and pass it as a
    // List-Unsubscribe header so clients offer a native unsubscribe. We never
    // overwrite a caller-supplied unsubscribeUrl. makeUnsubscribeToken fails
    // closed (throws) in a misconfigured production with no signing secret — that
    // must NOT break this dispatch flow, so we degrade to no link rather than let
    // it escape.
    let unsubscribeUrl: string | undefined;
    try {
      unsubscribeUrl = `${apiBaseUrl()}/unsubscribe?token=${makeUnsubscribeToken(
        input.to,
      )}`;
    } catch (err) {
      this.logger.warn(
        `unsubscribe link unavailable (signing secret missing?): ${this.msg(err)}`,
      );
    }
    const vars: Record<string, unknown> = {
      ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
      ...input.vars,
    };

    let rendered;
    try {
      rendered = input.templateId
        ? await this.templates.renderById(input.templateId, vars)
        : await this.templates.renderByKey(input.templateKey!, vars);
    } catch (err) {
      // Missing template / bad MJML throws a Nest HTTP exception from the
      // renderer. Swallow it here so signup/automation/scheduler flows survive,
      // and leave a FAILED audit row describing the render failure — rather than
      // letting a 404/400 propagate out into a non-HTTP business flow.
      const which = input.templateId
        ? `id ${input.templateId}`
        : `key "${input.templateKey}"`;
      this.logger.warn(`sendTemplate render failed (${which}): ${this.msg(err)}`);
      return this.recordRenderFailure(
        input,
        `template render failed (${which}): ${this.msg(err)}`,
      );
    }

    return this.send({
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      templateKey: input.templateKey,
      contactId: input.contactId,
      dedupeKey: input.dedupeKey,
      transactional: input.transactional,
      // Prefer a caller-supplied unsubscribe target; else the signed default.
      listUnsubscribe:
        (input.vars?.unsubscribeUrl as string | undefined) || unsubscribeUrl,
    });
  }

  // A render failed before any mail could be built: write a FAILED EmailLog
  // (honoring dedupeKey/contactId/templateKey for the audit trail) WITHOUT
  // attempting delivery — there's no body to put on the wire. Mirrors send()'s
  // never-throw contract: a logging hiccup here degrades to a best-effort
  // in-memory row instead of throwing into the flow.
  private async recordRenderFailure(
    input: SendTemplateInput,
    error: string,
  ): Promise<EmailLog> {
    const to = (input.to ?? '').trim().toLowerCase();
    const sendInput: SendEmailInput = {
      to,
      subject: '',
      html: '',
      templateKey: input.templateKey,
      contactId: input.contactId,
      dedupeKey: input.dedupeKey,
    };
    try {
      return await this.writeLog(sendInput, to, 'FAILED', {
        error: error.slice(0, 500),
      });
    } catch (err) {
      this.logger.warn(`recordRenderFailure could not log: ${this.msg(err)}`);
      return this.failureStub(sendInput, to, error.slice(0, 500));
    }
  }

  // send()'s contract: it NEVER throws. The whole body is wrapped so that even an
  // unexpected fault (a DB outage mid-flight, a bug, …) cannot escape into the
  // business flow that triggered the mail. On an unhandled throw we make a
  // best-effort FAILED audit row and return it; if even that write fails we return
  // a minimal in-memory-shaped failure row. The happy/expected paths live in
  // sendInner(); this wrapper is the last line of defense.
  async send(input: SendEmailInput): Promise<EmailLog> {
    const to = (input.to ?? '').trim().toLowerCase();
    try {
      return await this.sendInner(input, to);
    } catch (err) {
      this.logger.error(`send() escaped its contract for ${to}: ${this.msg(err)}`);
      // Best-effort FAILED row so the failure is still auditable…
      try {
        return await this.writeLog(input, to, 'FAILED', {
          error: this.msg(err).slice(0, 500),
        });
      } catch (logErr) {
        // …and if the DB itself is the problem, never rethrow — synthesize a
        // minimal EmailLog-shaped object so the caller still gets a value back.
        this.logger.error(
          `send() could not even log the failure for ${to}: ${this.msg(logErr)}`,
        );
        return this.failureStub(input, to, this.msg(err).slice(0, 500));
      }
    }
  }

  // The real send pipeline. May throw — send() wraps it so nothing escapes.
  private async sendInner(input: SendEmailInput, to: string): Promise<EmailLog> {
    // 1) Idempotency — a prior SENT row for this dedupeKey means "already done".
    if (input.dedupeKey) {
      const prior = await this.prisma.emailLog.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (prior && prior.status === 'SENT') return prior;
    }

    // 2) Suppression — never mail an unsubscribed/cleaned contact or an
    // opted-out user. Recorded as a FAILED row so it's visible, but not sent.
    // Transactional mail (password reset & co.) skips this: an unsubscribe is
    // a marketing preference and must never lock a member out of their
    // account. Nothing else in the pipeline changes for transactional sends.
    if (!input.transactional && (await this.isSuppressed(to))) {
      return this.writeLog(input, to, 'FAILED', { error: 'suppressed' });
    }

    // 3) QUEUED audit row up front (reused across the dedupe-collision case so a
    // retried trigger doesn't leave duplicate rows).
    const log = await this.upsertQueued(input, to);

    // 3a) Re-check idempotency after the upsert. Under a dedupeKey race the row
    // we got back may be a concurrent writer's already-SENT row (recovered via
    // the P2002 path); in that case treat it as already-handled and don't re-send.
    if (input.dedupeKey && log.status === 'SENT') return log;

    // 4) Not configured → record + return, never throw.
    let configured = false;
    try {
      configured = await this.sender.isConfigured();
    } catch (err) {
      this.logger.warn(`isConfigured() threw: ${this.msg(err)}`);
    }
    if (!configured) {
      return this.markLog(log, {
        status: 'FAILED',
        error: 'email sender not configured',
      });
    }

    // 5) Send; record SENT or FAILED. Any throw becomes a FAILED row.
    try {
      const { providerId } = await this.sender.send({
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        listUnsubscribe: input.listUnsubscribe,
      });
      // The mail is already on the wire. A failure to flip the row to SENT must
      // NOT throw to the caller and must NOT leave a delivered mail stuck QUEUED
      // in the audit log — markLog degrades to a best-effort in-memory row.
      return this.markLog(log, {
        status: 'SENT',
        providerId,
        sentAt: new Date(),
        error: null,
      });
    } catch (err) {
      this.logger.warn(`send failed for ${to}: ${this.msg(err)}`);
      return this.markLog(log, {
        status: 'FAILED',
        error: this.msg(err).slice(0, 500),
      });
    }
  }

  // Apply a terminal status to the QUEUED audit row. Best-effort: an update
  // failure (DB hiccup) is logged, never thrown — we return the row with the
  // intended fields merged in-memory so the caller still sees the real outcome
  // (and a delivered mail never appears stuck QUEUED to the caller).
  private async markLog(
    log: EmailLog,
    data: {
      status: 'SENT' | 'FAILED';
      providerId?: string;
      sentAt?: Date | null;
      error?: string | null;
    },
  ): Promise<EmailLog> {
    try {
      return await this.prisma.emailLog.update({
        where: { id: log.id },
        data,
      });
    } catch (err) {
      this.logger.warn(
        `EmailLog mark-${data.status} failed for ${log.id}: ${this.msg(err)}`,
      );
      return {
        ...log,
        status: data.status,
        providerId: data.providerId ?? log.providerId,
        sentAt: data.sentAt !== undefined ? data.sentAt : log.sentAt,
        error: data.error !== undefined ? data.error : log.error,
      };
    }
  }

  // Last-resort EmailLog-shaped value when we couldn't persist anything at all.
  // Not a DB row (no id collision risk); purely so send() can honor its
  // non-null return type without throwing.
  private failureStub(
    input: SendEmailInput,
    to: string,
    error: string,
  ): EmailLog {
    return {
      id: '',
      to,
      contactId: input.contactId ?? null,
      templateKey: input.templateKey ?? null,
      campaignId: input.campaignId ?? null,
      subject: input.subject ?? '',
      status: 'FAILED',
      providerId: null,
      error,
      dedupeKey: input.dedupeKey ?? null,
      sentAt: null,
      createdAt: new Date(),
    };
  }

  // A recipient is suppressed when ANY contact on that email is UNSUBSCRIBED or
  // CLEANED, or the linked User has emailOptOut set (the member-unsubscribe flag).
  private async isSuppressed(email: string): Promise<boolean> {
    const [badContact, optedOut] = await Promise.all([
      this.prisma.contact.findFirst({
        where: { email, status: { in: ['UNSUBSCRIBED', 'CLEANED'] } },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: { email, emailOptOut: true },
        select: { id: true },
      }),
    ]);
    return !!badContact || !!optedOut;
  }

  // Create the QUEUED row, or reuse the existing one for this dedupeKey (so a
  // re-fired trigger that previously FAILED retries in place rather than piling
  // up rows). Without a dedupeKey, always a fresh row.
  //
  // Even an upsert can throw P2002 on the dedupeKey unique under concurrency
  // (two triggers racing the create branch), and the earlier findUnique→upsert
  // is a TOCTOU. If that happens the row already exists by definition: re-fetch
  // it by dedupeKey and return it (treat as already-handled) instead of crashing.
  private async upsertQueued(
    input: SendEmailInput,
    to: string,
  ): Promise<EmailLog> {
    if (input.dedupeKey) {
      try {
        return await this.prisma.emailLog.upsert({
          where: { dedupeKey: input.dedupeKey },
          create: this.baseData(input, to, 'QUEUED'),
          update: { status: 'QUEUED', error: null },
        });
      } catch (err) {
        const existing = await this.recoverByDedupeKey(input.dedupeKey, err);
        if (existing) return existing;
        throw err;
      }
    }
    return this.prisma.emailLog.create({
      data: this.baseData(input, to, 'QUEUED'),
    });
  }

  // On a P2002 unique-constraint collision for a dedupeKey, the racing writer has
  // already created the row — fetch and return it so the caller can treat the
  // send as already-handled. Returns null (so the caller rethrows) when the error
  // is something other than a dedupeKey P2002 or the row can't be found.
  private async recoverByDedupeKey(
    dedupeKey: string,
    err: unknown,
  ): Promise<EmailLog | null> {
    const isDedupeCollision =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      this.targetsDedupeKey(err);
    if (!isDedupeCollision) return null;
    this.logger.debug(
      `dedupeKey "${dedupeKey}" raced; returning the existing EmailLog`,
    );
    return this.prisma.emailLog.findUnique({ where: { dedupeKey } });
  }

  // P2002's meta.target identifies the violated unique. Be permissive: if the
  // target is missing/opaque we still treat it as the dedupeKey collision (the
  // only unique on EmailLog), so a race recovers rather than crashes.
  private targetsDedupeKey(
    err: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = err.meta?.target;
    if (target == null) return true;
    const flat = Array.isArray(target) ? target.join(',') : String(target);
    return flat.includes('dedupeKey');
  }

  private async writeLog(
    input: SendEmailInput,
    to: string,
    status: 'FAILED' | 'SENT',
    extra: { error?: string | null; providerId?: string },
  ): Promise<EmailLog> {
    const data = { ...this.baseData(input, to, status), ...extra };
    if (input.dedupeKey) {
      // Never clobber an already-SENT audit row. A later FAILED write for the same
      // dedupeKey (e.g. a re-fired trigger whose template was deleted after a real
      // delivery) must not flip a genuine SENT row to FAILED — return it untouched.
      const prior = await this.prisma.emailLog.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (prior && prior.status === 'SENT') return prior;
      return this.prisma.emailLog.upsert({
        where: { dedupeKey: input.dedupeKey },
        create: data,
        update: data,
      });
    }
    return this.prisma.emailLog.create({ data });
  }

  private baseData(
    input: SendEmailInput,
    to: string,
    status: 'QUEUED' | 'SENT' | 'FAILED',
  ) {
    return {
      to,
      subject: input.subject,
      status,
      contactId: input.contactId ?? null,
      templateKey: input.templateKey ?? null,
      campaignId: input.campaignId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
