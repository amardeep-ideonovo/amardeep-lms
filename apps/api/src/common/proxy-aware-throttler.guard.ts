import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

// Base throttler for EVERY per-IP limit in this API. The stock ThrottlerGuard
// keys on req.ip — but the fleet always fronts the API with Caddy (the api
// container is loopback-bound; see deploy/Caddyfile), so req.ip is the proxy's
// address for every visitor and a "per-IP" limit silently becomes ONE bucket
// per academy. On the tight auth limits that inverted the protection into a
// denial-of-service: 5 unauthenticated requests a minute to /auth/login
// 429-locked login/signup/reset for the whole academy (2026-08-25 GTM audit).
//
// So the tracker keys on the RIGHTMOST X-Forwarded-For entry — the one the
// trusted proxy APPENDS, i.e. the actual peer — regardless of the express
// `trust proxy` setting (TRUST_PROXY env, now set by the fleet composes, keeps
// req.ip correct for everything else: logs, audit rows, future consumers).
//
// Spoofability: rightmost-XFF is exactly as trustworthy as the deployment
// shape. Behind Caddy a client-sent XFF only ever prepends — Caddy appends the
// real peer, so the rightmost entry cannot be forged. On a DIRECTLY exposed
// API a client could fabricate the whole header and rotate buckets; the fleet
// never exposes the API directly (loopback bind), and a direct deployment
// that removes the proxy must strip incoming XFF at its new edge instead.
//
// DO NOT attach this guard (or any ThrottlerGuard) per-route on top of the
// global APP_GUARD: both evaluate the same "default" throttler against the
// same route context and tracker, so the SAME storage key is incremented
// twice per request and the route's @Throttle limit silently halves (observed
// live 2026-08-25: 429 on the 3rd of a 5-limit). @Throttle decorators alone
// configure per-route limits — the global guard reads and enforces them. The
// only legitimate per-route throttler is one with a DIFFERENT key-space,
// like LiveThrottlerGuard (member-keyed).
@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  // Only throttle HTTP. Registered subclasses can be attached to WebSocket
  // gateway handlers (e.g. as a global APP_GUARD): the base ThrottlerGuard
  // resolves the response via context.switchToHttp() and unconditionally calls
  // res.header(...) — on a ws context getResponse() returns the @MessageBody
  // payload (no .header method), so the guard throws "res.header is not a
  // function" and the message handler never runs, silently breaking realtime
  // collaboration. There is no per-IP HTTP surface to limit on a socket
  // message, so skip every non-http execution context.
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== "http";
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const xff = headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length) {
      const parts = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    const xReal = headers["x-real-ip"];
    if (typeof xReal === "string" && xReal.trim()) return xReal.trim();
    return (req.ip as string) ?? "anon";
  }
}
