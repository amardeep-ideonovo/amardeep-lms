import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAILCHIMP_QUEUE_TOKEN } from '../queue/queue.module';
import type { MailchimpJob } from '../queue/queue.constants';

@Injectable()
export class MailchimpProducer {
  constructor(
    @Inject(MAILCHIMP_QUEUE_TOKEN) private readonly queue: Queue<MailchimpJob>,
  ) {}

  /**
   * Enqueue a tag add/remove. The jobId is deterministic per (type,email,tag)
   * so rapid duplicate enqueues collapse into one job — idempotent producer.
   */
  async enqueueTag(type: 'add' | 'remove', email: string, tag: string) {
    const jobId = `${type}:${email.toLowerCase()}:${tag}`;
    await this.queue.add('tag', { type, email, tag }, { jobId });
  }
}
