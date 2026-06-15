import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Prisma, type EmailEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnsubscribeService } from './unsubscribe.service';

// PUBLIC, no auth. Provider feedback ingestion (delivery/open/click/bounce/
// complaint). Deliberately lenient: it accepts our normalized shape
// `{ type, providerId?, email?, meta? }` AND common provider payloads (a single
// Postmark event, or a batch array). Every request returns 200 so we never
// reveal to a sender whether an address or message id is known, and a malformed
// item is skipped rather than failing the batch. Bounces and complaints drive
// suppression through UnsubscribeService.
//
// NOTE: this endpoint is intentionally unauthenticated (providers can't send a
// bearer token). In production it should be protected at the edge — a
// provider-specific signature/secret or an allow-listed path — but the handler
// itself stays defensive and idempotent regardless.

// One normalized event after we've flattened whatever the provider sent.
interface NormalizedEvent {
  type: EmailEventType;
  providerId?: string;
  email?: string;
  meta?: Record<string, unknown>;
}

@Controller('email')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unsubscribe: UnsubscribeService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(@Body() body: unknown): Promise<{ ok: true; processed: number }> {
    // Accept a single object or an array (some providers batch).
    const items = Array.isArray(body) ? body : [body];
    let processed = 0;
    for (const raw of items) {
      try {
        const event = normalize(raw);
        if (!event) continue; // unmappable / missing type → skip this item
        await this.ingest(event);
        processed++;
      } catch (err) {
        // Never let one bad item fail the response — log and move on.
        this.logger.warn(
          `email webhook item skipped: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { ok: true, processed };
  }

  // Persist one event and apply its side effects: correlate to an EmailLog (by
  // providerId), record the EmailEvent, flip the log's status for bounce/
  // complaint, and suppress the address. All best-effort and idempotent-friendly.
  private async ingest(event: NormalizedEvent): Promise<void> {
    // Correlate to the originating send when we have its provider message id.
    let emailLogId: string | null = null;
    let logEmail: string | null = null;
    if (event.providerId) {
      const log = await this.prisma.emailLog.findFirst({
        where: { providerId: event.providerId },
        select: { id: true, to: true },
        orderBy: { createdAt: 'desc' },
      });
      if (log) {
        emailLogId = log.id;
        logEmail = log.to;
      }
    }

    // Fall back to the log's recipient when the payload didn't carry an email.
    const email = (event.email || logEmail || '').trim().toLowerCase() || null;

    await this.prisma.emailEvent.create({
      data: {
        emailLogId,
        providerId: event.providerId ?? null,
        type: event.type,
        email,
        // Prisma's nullable Json column rejects a bare `null` — use JsonNull.
        meta: event.meta
          ? (event.meta as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    if (event.type === 'BOUNCE' || event.type === 'COMPLAINT') {
      // Mark the originating send so the logs view shows the outcome.
      if (emailLogId) {
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: { status: event.type === 'BOUNCE' ? 'BOUNCED' : 'COMPLAINED' },
        });
      }
      // Suppress every contact on this address (Contact → CLEANED, opt out the
      // user, consent row). Needs an email to act on.
      if (email) {
        await this.unsubscribe.suppressFromEvent(
          email,
          event.type === 'BOUNCE' ? 'bounce' : 'complaint',
        );
      }
    }
  }
}

// ───────────────────────── normalization ─────────────────────────
// Turn one raw provider payload into a NormalizedEvent, or null if it can't be
// mapped (unknown type / not an object). Handles three shapes:
//   1) our own  { type, providerId?, email?, meta? }
//   2) Postmark { RecordType, MessageID?, Email?/Recipient?, ... }
//   3) generic  { event/eventType/status, message_id/messageId/id, email/recipient }

function normalize(raw: unknown): NormalizedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const type = mapType(o);
  if (!type) return null;

  const providerId = firstString(
    o.providerId,
    o.MessageID,
    o.message_id,
    o.messageId,
    o.id,
    o.sid,
  );
  const email = firstString(
    o.email,
    o.Email,
    o.Recipient,
    o.recipient,
    o.to,
    o.To,
  );

  // meta: prefer an explicit meta object, else keep the raw payload (handy for
  // debugging bounce reasons) but only when it's a plain object.
  let meta: Record<string, unknown> | undefined;
  if (o.meta && typeof o.meta === 'object') {
    meta = o.meta as Record<string, unknown>;
  } else {
    meta = o as Record<string, unknown>;
  }

  return {
    type,
    ...(providerId ? { providerId } : {}),
    ...(email ? { email } : {}),
    ...(meta ? { meta } : {}),
  };
}

// Map any provider's "what happened" field onto our EmailEventType. Checks the
// normalized `type`, Postmark's `RecordType`, and a few generic aliases.
function mapType(o: Record<string, unknown>): EmailEventType | null {
  const raw = firstString(
    o.type,
    o.RecordType,
    o.event,
    o.eventType,
    o.Event,
    o.status,
  );
  if (!raw) return null;
  const v = raw.toLowerCase();

  // Bounce family (Postmark also emits HardBounce/Transient via RecordType=Bounce).
  if (v.includes('bounce') || v === 'hardbounce' || v === 'softbounce') {
    return 'BOUNCE';
  }
  // Complaint / spam.
  if (
    v.includes('complaint') ||
    v.includes('spam') ||
    v === 'spamcomplaint'
  ) {
    return 'COMPLAINT';
  }
  if (v.includes('deliver')) return 'DELIVERED';
  if (v.includes('open')) return 'OPEN';
  if (v.includes('click')) return 'CLICK';
  return null;
}

// First argument that is a non-empty string (after trim), else undefined.
function firstString(...vals: unknown[]): string | undefined {
  for (const val of vals) {
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}
