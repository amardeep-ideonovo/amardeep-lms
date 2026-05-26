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
   * Enqueue an add/remove of one or more tags on a specific audience (or the
   * global default when omitted). The jobId is deterministic per
   * (type,email,audience,sorted-tags) so rapid duplicate enqueues collapse into
   * one job — idempotent producer. The audience is part of the key so the same
   * tags on different lists don't collide.
   *
   * NOTE: BullMQ forbids ":" in custom job ids, so we join with "|".
   */
  async enqueueTags(
    type: 'add' | 'remove',
    email: string,
    tags: string[],
    audienceId?: string,
  ) {
    const key = [...tags].sort().join(',');
    const jobId = `${type}|${email.toLowerCase()}|${audienceId ?? 'default'}|${key}`;
    await this.queue.add('tag', { type, email, tags, audienceId }, { jobId });
  }
}
