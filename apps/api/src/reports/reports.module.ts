import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// Read-only admin Reports tab: generates Excel (.xlsx) exports from existing data.
// PrismaService comes from the global PrismaModule; SubscriptionsService is reused
// (exported by SubscriptionsModule) for the Stripe-live subscriptions sheet.
@Module({
  imports: [SubscriptionsModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
