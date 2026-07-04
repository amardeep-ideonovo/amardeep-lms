import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { redisProvider, REDIS_CONNECTION } from './redis.provider';

@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CONNECTION],
})
export class QueueModule implements OnModuleDestroy {
  constructor() {}
  async onModuleDestroy(): Promise<void> {
    // The shared ioredis connection is closed by its own lifecycle.
  }
}
