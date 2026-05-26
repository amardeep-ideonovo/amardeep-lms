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
   * Enqueue a tag add/remove on a specific audience (or the global default when
   * omitted). The jobId is deterministic per (type,email,audience,tag) so rapid
   * duplicate enqueues collapse into one job — idempotent producer. The audience
   * is part of the key so the same tag on different lists doesn't collide.
   *
   * NOTE: BullMQ forbids ":" in custom job ids, so we join with "|".
   */
  async enqueueTag(
    type: 'add' | 'remove',
    email: string,
    tag: string,
    audienceId?: string,
  ) {
    const jobId = `${type}|${email.toLowerCase()}|${audienceId ?? 'default'}|${tag}`;
    await this.queue.add('tag', { type, email, tag, audienceId }, { jobId });
  }
}
