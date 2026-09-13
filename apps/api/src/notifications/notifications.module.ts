import { Global, Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { MemberNotificationsController } from "./member-notifications.controller";
import { MemberNotificationsService } from "./member-notifications.service";

// Global so BillingService, PushService (and any future emitter) can inject the
// services to record events with no per-module import.
@Global()
@Module({
  controllers: [NotificationsController, MemberNotificationsController],
  providers: [NotificationsService, MemberNotificationsService],
  exports: [NotificationsService, MemberNotificationsService],
})
export class NotificationsModule {}
