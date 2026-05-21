import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { redisProvider, REDIS_CONNECTION } from './redis.provider';
import { MAILCHIMP_QUEUE } from './queue.constants';

export const MAILCHIMP_QUEUE_TOKEN = 'MAILCHIMP_QUEUE_TOKEN';

@Global()
@Module({
  providers: [
    redisProvider,
    {
      provide: MAILCHIMP_QUEUE_TOKEN,
      inject: [REDIS_CONNECTION],
      useFactory: (connection: Redis) =>
        new Queue(MAILCHIMP_QUEUE, {
          connection,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
    },
  ],
  exports: [REDIS_CONNECTION, MAILCHIMP_QUEUE_TOKEN],
})
export class QueueModule implements OnModuleDestroy {
  constructor() {}
  async onModuleDestroy(): Promise<void> {
    // BullMQ Queue connections are closed by the shared ioredis lifecycle.
  }
}
