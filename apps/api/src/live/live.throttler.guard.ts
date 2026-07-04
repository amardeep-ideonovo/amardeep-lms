import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Throttle credential releases PER MEMBER, not per IP — otherwise a shared
// office/NAT egress IP would rate-limit everyone together, and a single
// authenticated member could hammer the endpoint from many IPs. The principal id
// (req.user.sub, set by JwtAuthGuard which runs first) is the right key.
@Injectable()
export class LiveThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { sub?: string } | undefined;
    return user?.sub ?? (req.ip as string) ?? 'anon';
  }
}
