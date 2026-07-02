import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccessService } from '../lms/access.service';
import { LiveService } from './live.service';
import { LiveAdminController } from './live.admin.controller';
import { LiveController } from './live.controller';
import { LiveThrottlerGuard } from './live.throttler.guard';

// PrismaModule is @Global, so PrismaService is injected without importing it.
// The default throttler is loose; the tight per-member cap on the credentials
// route lives on its @Throttle decorator (mirrors ContactsModule).
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
  ],
  providers: [LiveService, AccessService, LiveThrottlerGuard],
  controllers: [LiveAdminController, LiveController],
})
export class LiveModule {}
