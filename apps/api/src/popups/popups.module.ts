import { Module } from '@nestjs/common';
import { PopupsService } from './popups.service';
import { PopupsController } from './popups.controller';

// PrismaModule is global, so PopupsService can inject PrismaService directly.
@Module({
  providers: [PopupsService],
  controllers: [PopupsController],
})
export class PopupsModule {}
