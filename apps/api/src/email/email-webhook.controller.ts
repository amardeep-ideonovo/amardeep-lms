import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma, type EmailEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { isProduction } from '../common/env.util';
import { UnsubscribeService } from './unsubscribe.service';

// PUBLIC, no auth GUARD. Provider feedback ingestion (delivery/open/click/bounce/
// complaint). Deliberately lenient about PAYLOAD shape: it accepts our normalized
// shape `{ type, providerId?, email?, meta? }` AND common provider payloads (a
// single Postmark event, or a batch array). A valid-but-unmappable item returns
// 200 so we never reveal to a sender whether an address or message id is known,
// and a malformed item is skipped rather than failing the batch.
//
// AUTH: the route can't carry our JWT (providers won't), so it's guarded by a
// shared secret instead (SettingsService.getEmailWebhookSecret — set by an admin
// or via EMAIL_WEBHOOK_SECRET). TWO auth modes share that one secret:
//   • SVIX (Resend): when svix-id/svix-timestamp/svix-signature headers are
//     present we verify an HMAC-SHA256 over `${id}.${ts}.${rawBody}` keyed by the
//     base64-decoded "whsec_…" secret (see verifySvix). Used by Resend.
//   • SHARED SECRET (everyone else): the secret may arrive as `Authorization:
//     Bearer <secret>`, `X-Webhook-Secret: <secret>`, or `?key=<secret>`
//     (providers vary). Compared in constant time.
// If a secret is configured the request MUST authenticate one of those ways or
// it's 401. If NONE is configured we fail CLOSED in production (401) and fail
// open with a warning locally so dev keeps working. Only an AUTH failure is 401 —
// unmappable items still return 200.

// One normalized event after we've flattened whatever the provider sent.
interface NormalizedEvent {
  type: EmailEventType;
  providerId?: string;
  email?: string;
  meta?: Record<string, unknown>;
  // True when the bounce is transient/soft — recorded, but must NOT suppress the
  // address (a soft bounce is a temporary failure, not a dead mailbox).
  soft?: boolean;
}

@Controller('email')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly unsubscribe: UnsubscribeService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  // Public route → rate-limit by IP (mirrors auth.controller's @Throttle pattern).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('authorization') authHeader?: string,
    @Headers('x-webhook-secret') secretHeader?: string,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
    @Query('key') keyQuery?: string,
  ): Promise<{ ok: true; processed: number }> {
    // Authenticate BEFORE any processing so an unauthenticated caller can't
    // suppress addresses or probe which message ids exist.
    await this.authorize(
      { authHeader, secretHeader, keyQuery, svixId, svixTimestamp, svixSignature },
      // Svix signs the byte-exact body; main.ts stashes it on req.rawBody. The
      // parsed body is passed too so verifySvix can fall back to re-serializing
      // it if rawBody is somehow missing (logged), degrading rather than failing.
      req.rawBody,
      body,
    );

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

  // Auth gate. Throws UnauthorizedException (401) when a secret is configured and
  // the request doesn't authenticate. When NO secret is configured: rejects in
  // production (fail closed) and allows-with-warning outside production (so
  // local/dev keeps working without setup).
  //
  // Two modes share the one configured secret: when Svix headers are present
  // (Resend) we verify the Svix signature over the raw body; otherwise we fall
  // back to the shared-secret carriers (Bearer / X-Webhook-Secret / ?key).
  private async authorize(
    h: {
      authHeader?: string;
      secretHeader?: string;
      keyQuery?: string;
      svixId?: string;
      svixTimestamp?: string;
      svixSignature?: string;
    },
    rawBody: Buffer | undefined,
    parsedBody: unknown,
  ): Promise<void> {
    const configured = await this.settings.getEmailWebhookSecret();

    // Resend signs every webhook via Svix and sends svix-* headers. Detect that
    // path by the headers (not the secret format) so an admin who stored the
    // "whsec_…" under any carrier still verifies correctly.
    const isSvix = !!(h.svixId && h.svixTimestamp && h.svixSignature);

    if (!configured) {
      if (isProduction()) {
        this.logger.error(
          'email webhook rejected: no webhook secret configured (set one in ' +
            'admin email settings or EMAIL_WEBHOOK_SECRET).',
        );
        throw new UnauthorizedException();
      }
      this.logger.warn(
        'email webhook accepted WITHOUT a shared secret — set one before ' +
          'production (admin email settings / EMAIL_WEBHOOK_SECRET).',
      );
      return;
    }

    if (isSvix) {
      // Svix (Resend): HMAC over the raw body. A failure here is a hard 401 — we
      // do NOT fall through to the shared-secret path, since a forged Svix header
      // set shouldn't get a second guess.
      this.verifySvix(
        configured,
        h.svixId as string,
        h.svixTimestamp as string,
        h.svixSignature as string,
        rawBody,
        parsedBody,
      );
      return;
    }

    // Shared-secret path: pull the presented secret from any accepted carrier.
    const bearer = h.authHeader?.replace(/^Bearer\s+/i, '').trim();
    const presented =
      (bearer && bearer.length ? bearer : undefined) ??
      (h.secretHeader?.trim() || undefined) ??
      (h.keyQuery?.trim() || undefined);

    if (!presented || !safeEqual(presented, configured)) {
      throw new UnauthorizedException();
    }
  }

  // Verify a Svix (Resend) signature. Throws UnauthorizedException (401) on any
  // failure. Algorithm (per Svix / Resend docs):
  //   signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  //   key           = base64-decode(secret without the "whsec_" prefix)
  //   expected      = base64( HMAC_SHA256(key, signedContent) )
  // The svix-signature header is a space-separated list of "v1,<sig>" tokens (a
  // secret can sign with several keys during rotation) — PASS if ANY token's
  // signature matches `expected` in constant time. Also reject a timestamp skew
  // beyond 5 minutes to blunt replay.
  private verifySvix(
    secret: string,
    svixId: string,
    svixTimestamp: string,
    svixSignature: string,
    rawBody: Buffer | undefined,
    parsedBody: unknown,
  ): void {
    // Replay window: |now - timestamp| must be ≤ 5 min. The header carries unix
    // seconds; a non-numeric/blank value is a reject.
    const ts = Number(svixTimestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      this.logger.warn('email webhook (svix) rejected: timestamp skew/invalid');
      throw new UnauthorizedException();
    }

    // The signed content is computed over the byte-exact body. main.ts captures
    // it on req.rawBody; if it's missing we degrade to re-serializing the parsed
    // body (works for canonically-serialized senders, but log the caveat).
    let raw: string;
    if (rawBody && rawBody.length) {
      raw = rawBody.toString('utf8');
    } else {
      this.logger.warn(
        'email webhook (svix): rawBody unavailable — falling back to ' +
          'JSON.stringify(body); signature may fail if bytes differ.',
      );
      raw = JSON.stringify(parsedBody ?? {});
    }
    const signedContent = `${svixId}.${svixTimestamp}.${raw}`;

    // Key is the base64 payload after the "whsec_" label (Svix secret format).
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key)
      .update(signedContent)
      .digest('base64');

    // Header tokens look like "v1,<sigA> v2,<sigB>"; strip the scheme prefix and
    // compare each signature constant-time. Any match passes.
    const ok = svixSignature
      .split(' ')
      .map((tok) => tok.trim())
      .filter(Boolean)
      .some((tok) => {
        const comma = tok.indexOf(',');
        const sig = comma >= 0 ? tok.slice(comma + 1) : tok;
        return safeEqual(sig, expected);
      });

    if (!ok) {
      this.logger.warn('email webhook (svix) rejected: bad signature');
      throw new UnauthorizedException();
    }
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

    // Replay dedupe: providers retry, and a misbehaving sender can resend. When
    // we have a providerId, skip if an identical (providerId, type) event already
    // landed — keeps the audit trail clean and avoids re-running side effects.
    if (event.providerId) {
      const dup = await this.prisma.emailEvent.findFirst({
        where: { providerId: event.providerId, type: event.type },
        select: { id: true },
      });
      if (dup) return; // already ingested this exact event
    }

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
      // Mark the originating send so the logs view shows the outcome (even a
      // soft bounce is worth showing as BOUNCED on the log).
      if (emailLogId) {
        await this.prisma.emailLog.update({
          where: { id: emailLogId },
          data: { status: event.type === 'BOUNCE' ? 'BOUNCED' : 'COMPLAINED' },
        });
      }
      // ONLY hard bounces / confirmed complaints suppress the address. A
      // transient/soft bounce (mailbox full, greylisted, temporary DNS) is a
      // retryable failure — recording it is enough; permanently CLEANING the
      // contact would wrongly kill a live address.
      if (event.type === 'BOUNCE' && event.soft) {
        this.logger.debug(
          `soft/transient bounce for ${email ?? 'unknown'} — recorded, not suppressing`,
        );
        return;
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

// Constant-time string compare that never throws on length mismatch (which is
// itself information). Compares byte buffers of equal length only when lengths
// match; otherwise runs a fixed dummy compare and returns false.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still do a compare to keep timing uniform, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// ───────────────────────── normalization ─────────────────────────
// Turn one raw provider payload into a NormalizedEvent, or null if it can't be
// mapped (unknown type / not an object). Handles four shapes:
//   1) our own  { type, providerId?, email?, meta? }
//   2) Postmark { RecordType, MessageID?, Email?/Recipient?, ... }
//   3) Resend   { type: "email.*", data: { email_id, to:[…], bounce?:{type} } }
//   4) generic  { event/eventType/status, message_id/messageId/id, email/recipient }

function normalize(raw: unknown): NormalizedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  // Resend (Svix) nests everything under `data`; flatten it onto a shape the
  // existing generic machinery understands before any further inspection.
  const o = flattenResend(raw as Record<string, unknown>);

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

  // Soft/transient classification — only meaningful for bounces. Look at the
  // explicit type/RecordType, Postmark's `Type` field (e.g. "SoftBounce",
  // "Transient"), and any meta/type markers a provider or our own caller set.
  const soft = type === 'BOUNCE' && isSoftBounce(o, meta);

  return {
    type,
    ...(providerId ? { providerId } : {}),
    ...(email ? { email } : {}),
    ...(meta ? { meta } : {}),
    ...(soft ? { soft: true } : {}),
  };
}

// Resend (delivered via Svix) nests its event under `data` and uses dotted event
// types ("email.bounced", "email.delivered", …). Detect that shape — by the
// "email." type prefix OR a `data.email_id` — and lift the fields the generic
// normalizer reads onto the top level: a scalar `message_id`, a scalar `email`
// (first recipient of data.to[]), and `bounceType` from data.bounce.type so the
// existing isSoftBounce() hard/soft logic fires unchanged. Non-Resend payloads
// pass straight through untouched. Original keys are preserved in the returned
// object so it still doubles as `meta` for debugging.
function flattenResend(
  o: Record<string, unknown>,
): Record<string, unknown> {
  const type = o.type;
  const data =
    o.data && typeof o.data === 'object'
      ? (o.data as Record<string, unknown>)
      : undefined;
  const isResend =
    (typeof type === 'string' && type.startsWith('email.')) ||
    (!!data && typeof data.email_id === 'string');
  if (!isResend || !data) return o;

  const to = data.to;
  const email = Array.isArray(to)
    ? (to.find((t) => typeof t === 'string' && t.trim()) as string | undefined)
    : typeof to === 'string'
      ? to
      : undefined;
  const bounce =
    data.bounce && typeof data.bounce === 'object'
      ? (data.bounce as Record<string, unknown>)
      : undefined;

  // Spread the original first so our lifted scalars win on key collisions.
  return {
    ...o,
    ...(typeof data.email_id === 'string'
      ? { message_id: data.email_id }
      : {}),
    ...(email ? { email } : {}),
    // Feed the hard/soft signal to isSoftBounce via a key it already scans.
    ...(bounce && typeof bounce.type === 'string'
      ? { bounceType: bounce.type }
      : {}),
  };
}

// Decide whether a bounce is transient/soft (don't suppress) vs hard/permanent
// (suppress). Scans the common fields providers use to encode bounce severity:
//   - Postmark: top-level `Type` ("SoftBounce", "Transient", "HardBounce", …)
//   - generic: a `soft`/`transient` boolean, or those words in type/status/meta
// Defaults to HARD (suppress) only when nothing marks it soft, EXCEPT we treat an
// explicit "hard"/"permanent" marker as authoritative. Unknown → hard, matching
// the prior behaviour of suppressing on any bounce.
function isSoftBounce(
  o: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
): boolean {
  const markers = [
    o.type,
    o.Type,
    o.RecordType,
    o.event,
    o.eventType,
    o.status,
    o.bounceType,
    o.BounceType,
    meta?.type,
    meta?.Type,
    meta?.bounceType,
  ];
  for (const m of markers) {
    if (typeof m !== 'string') continue;
    const v = m.toLowerCase();
    if (v.includes('soft') || v.includes('transient')) return true;
  }
  // Explicit boolean flags some providers/our callers set.
  if (o.soft === true || o.transient === true) return true;
  if (meta && (meta.soft === true || meta.transient === true)) return true;
  return false;
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

  // Explicitly-ignored events (return null → 200, no side effects). Resend emits
  // `email.sent` (queued, pre-delivery) and `email.delivery_delayed` (transient
  // retry) — neither maps to a tracked outcome, and "delivery_delayed" must be
  // caught BEFORE the `deliver` substring check below or it'd look DELIVERED.
  if (v === 'email.sent' || v.includes('delay')) return null;

  // Bounce family (Postmark also emits HardBounce/Transient via RecordType=Bounce;
  // Resend uses "email.bounced").
  if (v.includes('bounce') || v === 'hardbounce' || v === 'softbounce') {
    return 'BOUNCE';
  }
  // Complaint / spam (Resend uses "email.complained" → match the "complain" stem).
  if (
    v.includes('complaint') ||
    v.includes('complain') ||
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
