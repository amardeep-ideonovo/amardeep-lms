import { Injectable } from "@nestjs/common";
import { ProxyAwareThrottlerGuard } from "./proxy-aware-throttler.guard";

// App-wide rate limiter (registered as a global APP_GUARD). All of the actual
// behavior — real-client-IP keying via the rightmost X-Forwarded-For entry and
// the skip-non-http guard for WebSocket contexts — lives in
// ProxyAwareThrottlerGuard, which the per-route throttles (auth, forms,
// unsubscribe, …) share so every "per-IP" limit in the API keys the same way.
// Behind the proxy req.ip is the proxy's own address; a default per-IP
// throttle would bucket the ENTIRE academy together and could take the whole
// API down under one shared limit.
@Injectable()
export class GlobalThrottlerGuard extends ProxyAwareThrottlerGuard {}
