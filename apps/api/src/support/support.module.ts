import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportSyncController } from './support-sync.controller';
import { SupportService } from './support.service';
import { SupportSyncService } from './support-sync.service';

// ScheduleModule.forRoot() is already registered (EmailModule) and its explorer
// scans every provider app-wide, so the SupportSyncService @Cron is picked up
// automatically — do NOT call forRoot() again. PrismaService / NotificationsService
// / EmailService are all Global, so no extra imports are needed.
@Module({
  controllers: [SupportController, SupportSyncController],
  providers: [SupportService, SupportSyncService],
})
export class SupportModule {}
