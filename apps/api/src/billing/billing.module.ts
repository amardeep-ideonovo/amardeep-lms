import { Module } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";
import { StripeService } from "./stripe.service";
import { PayPalService } from "./paypal.service";
import { PushModule } from "../push/push.module";

// Provider services are exported so the Levels module can provision catalog
// objects (Stripe Products/Prices; PayPal products/plans on archive/rename).
// PushModule is imported so BillingService can dispatch member push at the
// subscription-active / payment-failed emit-sites.
@Module({
  imports: [PushModule],
  providers: [BillingService, StripeService, PayPalService],
  controllers: [BillingController],
  exports: [BillingService, StripeService, PayPalService],
})
export class BillingModule {}
