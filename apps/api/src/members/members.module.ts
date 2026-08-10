import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { BillingModule } from '../billing/billing.module';
import { AccountModule } from '../account/account.module';

// BillingModule is imported for its exported StripeService — MembersService
// keeps the Stripe Customer email in sync on an admin email change. AccountModule
// provides the shared purge used by the admin "delete member" action.
@Module({
  imports: [BillingModule, AccountModule],
  providers: [MembersService],
  controllers: [MembersController],
})
export class MembersModule {}
