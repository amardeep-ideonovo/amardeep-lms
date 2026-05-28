import { Controller, Get, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CONNECTION } from '../queue/redis.provider';

// Liveness + readiness in one endpoint.
//
// We always return 200 so the platform health check (Render/Fly/etc) doesn't
// restart the process for a transient DB/Redis blip — the platform should
// restart on process death, not on a dependency hiccup. The `status` and
// `checks` fields surface the real state for clients and synthetic smoke
// tests (they can assert `checks.db === 'ok'` etc).
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const env = process.env.ENV_NAME ?? 'production';
    const [db, redis] = await Promise.allSettled([
      this.withTimeout(this.prisma.client.$queryRaw`SELECT 1`, 1000),
      this.withTimeout(this.redis.ping(), 1000),
    ]);
    const dbOk = db.status === 'fulfilled';
    const redisOk = redis.status === 'fulfilled';
    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      env,
      uptime: process.uptime(),
      checks: {
        db: dbOk ? 'ok' : 'fail',
        redis: redisOk ? 'ok' : 'fail',
      },
    };
  }

  // Promise.race wrapper — used so a hung DB/Redis call doesn't block the
  // health response indefinitely. The underlying query continues in the
  // background after the timeout; that's fine because we don't queue
  // health checks.
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
      ),
    ]);
  }
}
