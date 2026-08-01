import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// App-wide rate limiter (registered as a global APP_GUARD). It keys on the REAL
// client IP — the RIGHTMOST X-Forwarded-For entry, appended by the trusted Caddy
// proxy — NOT req.ip. Behind the proxy req.ip is the proxy's own address, so a
// default per-IP throttle would bucket the ENTIRE fleet together and could take
// the whole API down under one shared limit. The rightmost XFF is proxy-set, so
// it's both correct (the actual peer) and not client-spoofable.
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
  // Only throttle HTTP. As a DI-registered global APP_GUARD, Nest also attaches
  // this guard to WebSocket gateway handlers (ProjectsGateway's
  // @SubscribeMessage channel:join/leave/typing) and any future RPC handlers.
  // The base ThrottlerGuard resolves the response via context.switchToHttp()
  // and unconditionally calls res.header(...) — on a ws context getResponse()
  // returns the @MessageBody payload (no .header method), so the guard throws
  // "res.header is not a function" and the message handler never runs, silently
  // breaking realtime collaboration. There is no per-IP HTTP surface to limit on
  // a socket message here, so skip every non-http execution context.
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== 'http';
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, unknown>;
    const xff = headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) {
      const parts = xff
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    const xReal = headers['x-real-ip'];
    if (typeof xReal === 'string' && xReal.trim()) return xReal.trim();
    return (req.ip as string) ?? 'anon';
  }
}
