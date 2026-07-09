import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PopupsService } from './popups.service';
import { PopupsController } from './popups.controller';

// PrismaModule is global, so PopupsService can inject PrismaService directly.
// ThrottlerModule backs the per-IP rate limit on the public analytics event route.
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
  ],
  providers: [PopupsService],
  controllers: [PopupsController],
})
export class PopupsModule {}
