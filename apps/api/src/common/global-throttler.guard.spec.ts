import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { GlobalThrottlerGuard } from './global-throttler.guard';

// Regression guard for the WebSocket crash: registered as a global APP_GUARD,
// this throttler is also attached to WebSocket gateway (@SubscribeMessage)
// handlers. The base ThrottlerGuard resolves the response via switchToHttp() and
// calls res.header(...), which throws on a ws context (getResponse() returns the
// @MessageBody payload, not an HTTP response). shouldSkip() must bail out of
// every non-http execution context so the realtime gateway keeps working; it
// must NOT skip http (or the whole rate limiter would be a no-op).

function ctx(type: string): ExecutionContext {
  return { getType: () => type } as unknown as ExecutionContext;
}

// shouldSkip only reads context.getType(), so a prototype instance (no ctor,
// which would need options/storage/reflector) is enough to exercise it.
function shouldSkip(context: ExecutionContext): Promise<boolean> {
  const g = Object.create(GlobalThrottlerGuard.prototype) as {
    shouldSkip(c: ExecutionContext): Promise<boolean>;
  };
  return g.shouldSkip(context);
}

test('shouldSkip: skips websocket contexts (no res.header crash)', async () => {
  assert.equal(await shouldSkip(ctx('ws')), true);
});

test('shouldSkip: skips rpc/microservice contexts', async () => {
  assert.equal(await shouldSkip(ctx('rpc')), true);
});

test('shouldSkip: still throttles http requests', async () => {
  assert.equal(await shouldSkip(ctx('http')), false);
});
