import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { BillingModule } from '../billing/billing.module';

// BillingModule is imported for its exported StripeService (coupon creation).
@Module({
  imports: [BillingModule],
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService], // reused by SearchModule for coupon search
})
export class CouponsModule {}
