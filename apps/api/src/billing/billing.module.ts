import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';

// StripeService is exported so the Levels module can provision Products/Prices.
@Module({
  providers: [BillingService, StripeService],
  controllers: [BillingController],
  exports: [StripeService],
})
export class BillingModule {}
