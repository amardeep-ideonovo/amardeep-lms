import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

// Per-MEMBER throttle for the helpdesk write surface (mirrors LiveThrottlerGuard).
// Keys on the principal id — set on req.user.sub by JwtAuthGuard, which MUST be
// listed before this guard in @UseGuards — instead of the IP: a shared office /
// NAT egress would otherwise rate-limit a whole academy together, and one member
// could rotate IPs to escape a per-IP bucket. The member key-space is distinct
// from the global per-IP GlobalThrottlerGuard, so the two never double-increment
// the same storage key (see the warning in ProxyAwareThrottlerGuard against
// attaching a same-key-space throttler on top of the global one).
@Injectable()
export class HelpdeskThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { sub?: string } | undefined;
    return user?.sub ?? (req.ip as string) ?? "anon";
  }
}
