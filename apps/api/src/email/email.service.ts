import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmailLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_SENDER, type MailSender } from './mail-sender.interface';

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
  ) {}

  async send(input: SendEmailInput): Promise<EmailLog> {
    const to = input.to.trim().toLowerCase();

    // 1) Idempotency — a prior SENT row for this dedupeKey means "already done".
    if (input.dedupeKey) {
      const prior = await this.prisma.emailLog.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (prior && prior.status === 'SENT') return prior;
    }

    // 2) Suppression — never mail an unsubscribed/cleaned contact or an
    // opted-out user. Recorded as a FAILED row so it's visible, but not sent.
    if (await this.isSuppressed(to)) {
      return this.writeLog(input, to, 'FAILED', { error: 'suppressed' });
    }

    // 3) QUEUED audit row up front (reused across the dedupe-collision case so a
    // retried trigger doesn't leave duplicate rows).
    const log = await this.upsertQueued(input, to);

    // 4) Not configured → record + return, never throw.
    let configured = false;
    try {
      configured = await this.sender.isConfigured();
    } catch (err) {
      this.logger.warn(`isConfigured() threw: ${this.msg(err)}`);
    }
    if (!configured) {
      return this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: 'email sender not configured' },
      });
    }

    // 5) Send; record SENT or FAILED. Any throw becomes a FAILED row.
    try {
      const { providerId } = await this.sender.send({
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return this.prisma.emailLog.update({
        where: { id: log.id },
        data: {
          status: 'SENT',
          providerId,
          sentAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      this.logger.warn(`send failed for ${to}: ${this.msg(err)}`);
      return this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: this.msg(err).slice(0, 500) },
      });
    }
  }

  // A recipient is suppressed when ANY contact on that email is UNSUBSCRIBED or
  // CLEANED, or the linked User has emailOptOut set (the Mailchimp-unsub flag).
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
  private async upsertQueued(
    input: SendEmailInput,
    to: string,
  ): Promise<EmailLog> {
    if (input.dedupeKey) {
      return this.prisma.emailLog.upsert({
        where: { dedupeKey: input.dedupeKey },
        create: this.baseData(input, to, 'QUEUED'),
        update: { status: 'QUEUED', error: null },
      });
    }
    return this.prisma.emailLog.create({
      data: this.baseData(input, to, 'QUEUED'),
    });
  }

  private async writeLog(
    input: SendEmailInput,
    to: string,
    status: 'FAILED' | 'SENT',
    extra: { error?: string | null; providerId?: string },
  ): Promise<EmailLog> {
    const data = { ...this.baseData(input, to, status), ...extra };
    if (input.dedupeKey) {
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
