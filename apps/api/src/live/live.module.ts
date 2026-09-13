import { Module } from "@nestjs/common";
import { AccessService } from "../lms/access.service";
import { LiveService } from "./live.service";
import { LiveReminderService } from "./live-reminder.service";
import { LiveAdminController } from "./live.admin.controller";
import { LiveController } from "./live.controller";
import { LiveThrottlerGuard } from "./live.throttler.guard";
import { PushModule } from "../push/push.module";

// PrismaModule is @Global, so PrismaService is injected without importing it.
// ThrottlerModule is configured (globally) once in AppModule; the tight
// per-member cap on the credentials route lives on its @Throttle decorator
// (mirrors ContactsModule), on top of the app-wide default. PushModule powers
// the LiveReminderService cron (starting-soon / live-now member pushes).
@Module({
  imports: [PushModule],
  providers: [
    LiveService,
    LiveReminderService,
    AccessService,
    LiveThrottlerGuard,
  ],
  controllers: [LiveAdminController, LiveController],
})
export class LiveModule {}
