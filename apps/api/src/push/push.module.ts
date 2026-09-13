import { Module } from "@nestjs/common";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";

// Member push. PrismaService is @Global and the JWT strategy behind
// JwtAuthGuard is registered app-wide (AuthModule), so no imports are needed.
// PushService is exported so BillingModule and HelpdeskModule can dispatch at
// their emit-sites.
@Module({
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
