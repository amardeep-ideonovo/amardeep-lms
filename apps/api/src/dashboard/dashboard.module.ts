import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { LmsModule } from '../lms/lms.module';

@Module({
  imports: [LmsModule], // for AccessService
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
