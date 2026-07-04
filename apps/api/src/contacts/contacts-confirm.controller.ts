import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { ContactsService } from './contacts.service';

// Public confirm-link rate limit. Double-opt-in confirms are low-volume and
// security-sensitive (a forged-token sprayer shouldn't be able to hammer this),
// so cap per IP. Overridable via env, defaults to 20/min/IP — generous for a
// real subscriber clicking once, tight against abuse. `trust proxy` (main.ts)
// makes req.ip the real client behind a CDN/LB.
const CONFIRM_LIMIT = Number(process.env.THROTTLE_CONFIRM_LIMIT) || 20;
const CONFIRM_TTL_MS = 60_000;

// PUBLIC, no auth. The target of the double-opt-in confirmation email link.
// GET renders a self-contained confirmation page (works straight from a mail
// client); POST is here for parity / one-click prefetchers. Both verify the
// signed token and, when the contact is PENDING, flip it to SUBSCRIBED.
//
// Throttled module-side: ContactsModule imports ThrottlerModule and these
// routes carry @UseGuards(ThrottlerGuard)+@Throttle (mirrors AuthController).
@Controller('contacts/confirm')
export class ContactsConfirmController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: CONFIRM_LIMIT, ttl: CONFIRM_TTL_MS } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  // Never let a confirm page get cached/indexed.
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  async page(
    @Req() req: Request,
    @Query('token') token?: string,
  ): Promise<string> {
    const { result, email } = await this.contacts.confirm(token, req.ip);
    return renderPage(result, email);
  }

  // One-click / parity. Idempotent; same HTML as GET. A bad/forged token yields
  // a neutral page so we never leak which addresses are real to a prefetcher.
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: CONFIRM_LIMIT, ttl: CONFIRM_TTL_MS } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async oneClick(
    @Req() req: Request,
    @Query('token') token?: string,
  ): Promise<string> {
    const { result, email } = await this.contacts.confirm(token, req.ip);
    return renderPage(result, email);
  }
}

// ───────────────────────── self-contained pages ─────────────────────────
// Inline-styled, dependency-free HTML mirroring unsubscribe.controller.ts so the
// page renders identically from any mail client or browser. The email comes from
// a signed token but is still escaped before interpolation (defense-in-depth).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f3fc; color: #251f3d;
  }
  .card {
    width: 100%; max-width: 440px; background: #ffffff; border-radius: 16px;
    padding: 36px 32px; text-align: center;
    box-shadow: 0 12px 40px rgba(124, 92, 252, 0.16);
    border: 1px solid rgba(124, 92, 252, 0.12);
  }
  .badge {
    width: 56px; height: 56px; border-radius: 50%; margin: 0 auto 20px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(124, 92, 252, 0.12); color: #7c5cfc; font-size: 28px;
  }
  h1 { font-size: 21px; margin: 0 0 10px; color: #251f3d; }
  p { font-size: 15px; line-height: 1.6; color: #5a5470; margin: 0 0 8px; }
  .email { font-weight: 600; color: #251f3d; word-break: break-all; }
  .muted { font-size: 13px; color: #8b84a4; margin-top: 18px; }
</style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

// Map a confirm result to the right page. 'confirmed' and 'already' are both
// success-shaped (idempotent); 'suppressed' explains we won't re-open an
// opt-out; 'invalid' is a neutral error page (never confirms whether the address
// was real). All return a string body — the controller sets the content type.
function renderPage(
  result: 'confirmed' | 'already' | 'suppressed' | 'invalid',
  email?: string,
): string {
  const who = email
    ? `<span class="email">${escapeHtml(email)}</span>`
    : 'your email address';
  switch (result) {
    case 'confirmed':
      return shell(
        'Subscription confirmed',
        `<div class="badge" aria-hidden="true">✓</div>
         <h1>You're all set</h1>
         <p>${who} is now confirmed. You'll start receiving our emails.</p>
         <p class="muted">Changed your mind later? Every email has an unsubscribe link.</p>`,
      );
    case 'already':
      return shell(
        'Already confirmed',
        `<div class="badge" aria-hidden="true">✓</div>
         <h1>Already confirmed</h1>
         <p>${who} is already on our mailing list — nothing else to do.</p>
         <p class="muted">Every email we send includes an unsubscribe link if you ever want out.</p>`,
      );
    case 'suppressed':
      return shell(
        'Subscription not reactivated',
        `<div class="badge" aria-hidden="true">!</div>
         <h1>This address opted out</h1>
         <p>${who} previously unsubscribed, so this confirmation link won't re-subscribe it.</p>
         <p class="muted">If you'd like to subscribe again, please sign up afresh.</p>`,
      );
    case 'invalid':
    default:
      return shell(
        'Confirmation link not valid',
        `<div class="badge" aria-hidden="true">!</div>
         <h1>This link isn't valid</h1>
         <p>The confirmation link looks incomplete or has expired. Please use the link from your most recent confirmation email.</p>
         <p class="muted">If you keep seeing this, try signing up again.</p>`,
      );
  }
}
