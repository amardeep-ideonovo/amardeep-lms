import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { BillingModule } from '../billing/billing.module';

// BillingModule is imported for its exported StripeService — MembersService
// keeps the Stripe Customer email in sync on an admin email change.
@Module({
  imports: [BillingModule],
  providers: [MembersService],
  controllers: [MembersController],
})
export class MembersModule {}
