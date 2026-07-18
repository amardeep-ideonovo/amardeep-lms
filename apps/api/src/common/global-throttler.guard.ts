import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// App-wide rate limiter (registered as a global APP_GUARD). It keys on the REAL
// client IP — the RIGHTMOST X-Forwarded-For entry, appended by the trusted Caddy
// proxy — NOT req.ip. Behind the proxy req.ip is the proxy's own address, so a
// default per-IP throttle would bucket the ENTIRE fleet together and could take
// the whole API down under one shared limit. The rightmost XFF is proxy-set, so
// it's both correct (the actual peer) and not client-spoofable.
@Injectable()
export class GlobalThrottlerGuard extends ThrottlerGuard {
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
