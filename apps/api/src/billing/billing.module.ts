import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { PayPalService } from './paypal.service';

// Provider services are exported so the Levels module can provision catalog
// objects (Stripe Products/Prices; PayPal products/plans on archive/rename).
@Module({
  providers: [BillingService, StripeService, PayPalService],
  controllers: [BillingController],
  exports: [StripeService, PayPalService],
})
export class BillingModule {}
