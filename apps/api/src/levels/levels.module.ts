import { Module } from '@nestjs/common';
import { LevelsService } from './levels.service';
import { LevelsController } from './levels.controller';
import { BillingModule } from '../billing/billing.module';
import { LmsModule } from '../lms/lms.module';

@Module({
  imports: [BillingModule, LmsModule], // LmsModule provides AccessService
  providers: [LevelsService],
  controllers: [LevelsController],
})
export class LevelsModule {}
