import { Global, Module } from '@nestjs/common';
import { MailchimpService } from './mailchimp.service';
import { MailchimpProducer } from './mailchimp.producer';
import { MailchimpWorker } from './mailchimp.worker';

// Global so Members & Billing modules can enqueue tag-sync jobs.
@Global()
@Module({
  providers: [MailchimpService, MailchimpProducer, MailchimpWorker],
  exports: [MailchimpService, MailchimpProducer],
})
export class MailchimpModule {}
