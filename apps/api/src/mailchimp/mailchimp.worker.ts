import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { REDIS_CONNECTION } from '../queue/redis.provider';
import { MAILCHIMP_QUEUE } from '../queue/queue.constants';
import type { MailchimpJob } from '../queue/queue.constants';
import { MailchimpService } from './mailchimp.service';

// BullMQ worker for the `mailchimp` queue. Each job is an idempotent tag
// add/remove (see MailchimpService.syncTag). Failures retry per the producer's
// backoff policy.
@Injectable()
export class MailchimpWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailchimpWorker.name);
  private worker?: Worker<MailchimpJob>;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly mailchimp: MailchimpService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MailchimpJob>(
      MAILCHIMP_QUEUE,
      async (job: Job<MailchimpJob>) => {
        const { type, email, tag, audienceId } = job.data;
        await this.mailchimp.syncTag(type, email, tag, audienceId);
      },
      { connection: this.connection, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `mailchimp job ${job?.id} failed: ${err?.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
