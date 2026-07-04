import { Controller, Get, Header, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UnsubscribeService } from './unsubscribe.service';
import { verifyUnsubscribeToken } from './unsubscribe.util';

// PUBLIC, no auth. The target of every email's unsubscribe link and the URL form
// of the List-Unsubscribe header.
//
// GET MUST NOT MUTATE. Mail clients, link scanners and anti-malware prefetchers
// fire GET on every link in a message — if GET unsubscribed, those bots would
// silently opt users out. So GET renders a CONFIRM page: a styled button that
// POSTs the same token back here. Only the POST mutates.
//
// POST handles both that confirm-button submit AND the RFC 8058 one-click
// List-Unsubscribe-Post that some clients fire automatically. It's idempotent and
// always returns the same success-shaped HTML — a bad/missing token is a no-op
// 200 so we never leak which addresses are real to an automated prefetcher.
//
// Both routes are IP rate-limited (public, unauthenticated) — mirrors the
// @Throttle pattern in auth.controller.ts.
@Controller('unsubscribe')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class UnsubscribeController {
  constructor(private readonly unsubscribe: UnsubscribeService) {}

  // Render-only. Verifies the token to choose which page to show, but performs
  // NO suppression. A valid token → a confirm page whose button POSTs the token.
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  // Never let an unsubscribe page get cached/indexed.
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  async page(@Query('token') token?: string): Promise<string> {
    const email = verifyUnsubscribeToken(token);
    if (!email) return errorPage();
    // token is non-empty here (verify returned an email), so it's safe to echo.
    return confirmPage(email, token as string);
  }

  // The mutating endpoint: serves the confirm-button submit and RFC 8058
  // one-click. Idempotent; always returns the same confirmation HTML. A bad
  // token is a no-op success-shaped 200 so we never leak which addresses are
  // real to an automated prefetcher.
  @Post()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  async oneClick(@Query('token') token?: string): Promise<string> {
    const email = verifyUnsubscribeToken(token);
    if (email) await this.unsubscribe.unsubscribeEmail(email);
    return successPage(email ?? '');
  }
}

// ───────────────────────── self-contained pages ─────────────────────────
// Inline-styled, dependency-free HTML so the page renders identically whether
// reached from Gmail, Apple Mail or a browser. Palette matches the violet glass
// system. The email is escaped before interpolation (defense-in-depth even
// though it came from a signed token).

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

// Confirmation page shown on GET. A single button POSTs the token back to the
// same route to actually unsubscribe — so a passive GET (mail scanner, link
// prefetch) never opts anyone out. The token is interpolated into the form
// action as a query string; it's base64url + hex (no HTML-special chars) but we
// escape it anyway as defense-in-depth. Email is escaped before display.
function confirmPage(email: string, token: string): string {
  return shell(
    'Confirm unsubscribe',
    `<div class="badge" aria-hidden="true">✉</div>
     <h1>Unsubscribe from emails?</h1>
     <p>This will stop marketing emails to <span class="email">${escapeHtml(
       email,
     )}</span>.</p>
     <form method="post" action="/unsubscribe?token=${escapeHtml(token)}" style="margin-top:22px;">
       <button type="submit" style="
         appearance:none;border:0;cursor:pointer;font:inherit;font-weight:600;
         font-size:15px;color:#ffffff;background:#7c5cfc;border-radius:10px;
         padding:13px 22px;width:100%;">
         Unsubscribe
       </button>
     </form>
     <p class="muted">Account and billing notices may still be sent where required. Changed your mind? Just close this page.</p>`,
  );
}

function successPage(email: string): string {
  const who = email
    ? `<span class="email">${escapeHtml(email)}</span> has been removed from our mailing list.`
    : `You've been removed from our mailing list.`;
  return shell(
    "You've been unsubscribed",
    `<div class="badge" aria-hidden="true">✓</div>
     <h1>You've been unsubscribed</h1>
     <p>${who}</p>
     <p>You won't receive any more marketing emails from us. Account and billing notices may still be sent where required.</p>
     <p class="muted">Changed your mind? Just sign up again or update your email preferences in your account.</p>`,
  );
}

function errorPage(): string {
  return shell(
    'Unsubscribe link not valid',
    `<div class="badge" aria-hidden="true">!</div>
     <h1>This link isn't valid</h1>
     <p>The unsubscribe link looks incomplete or has expired. Please use the link from your most recent email.</p>
     <p class="muted">If you keep seeing this, you can update your email preferences from your account settings.</p>`,
  );
}
