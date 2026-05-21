import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';

export const REDIS_CONNECTION = 'REDIS_CONNECTION';

// A shared ioredis connection. BullMQ requires maxRetriesPerRequest = null on
// connections used by workers/blocking commands.
export const redisProvider: Provider = {
  provide: REDIS_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    return new IORedis(url, { maxRetriesPerRequest: null });
  },
};
