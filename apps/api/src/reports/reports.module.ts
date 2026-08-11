import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { MembersModule } from '../members/members.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// Read-only admin Reports tab: generates Excel (.xlsx) exports from existing data.
// PrismaService comes from the global PrismaModule; SubscriptionsService and
// MembersService are reused (exported by their modules) so the exports match the
// live subscriptions list and the filtered members list respectively.
@Module({
  imports: [SubscriptionsModule, MembersModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
