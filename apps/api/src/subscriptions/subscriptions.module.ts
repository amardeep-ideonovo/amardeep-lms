import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { BillingModule } from '../billing/billing.module';

// BillingModule is imported for its exported StripeService (live subscription +
// invoice listing).
@Module({
  imports: [BillingModule],
  providers: [SubscriptionsService],
  controllers: [SubscriptionsController],
  // Exported so ReportsModule can reuse list() for the subscriptions report sheet.
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
