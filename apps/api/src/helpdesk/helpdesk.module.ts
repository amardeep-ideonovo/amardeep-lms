import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { jwtSecret } from "../common/env.util";
import { HelpdeskController } from "./helpdesk.controller";
import { HelpdeskAdminController } from "./helpdesk-admin.controller";
import { HelpdeskService } from "./helpdesk.service";
import { HelpdeskRetentionService } from "./helpdesk-retention.service";
import { HelpdeskThrottlerGuard } from "./helpdesk.throttler.guard";
import { AppConfigService } from "../site/app-config.service";
import { PushModule } from "../push/push.module";

// PrismaService and NotificationsService are @Global, so no imports are needed.
@Module({
  imports: [
    // JwtService (same secret as auth) mints short-lived attachment-download
    // tokens so an <img> can load a private screenshot via ?token=.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config.get<string>("JWT_SECRET")),
      }),
    }),
    // Member push for the "a human replied" notification.
    PushModule,
  ],
  controllers: [HelpdeskController, HelpdeskAdminController],
  // AppConfigService (brand title for the reply email) is a stateless reader
  // over the global PrismaService; SiteModule doesn't export it, so provide a
  // local instance — same pattern as AuthModule. EmailService comes from the
  // @Global EmailModule. HelpdeskThrottlerGuard is provided here so Nest can
  // resolve its ThrottlerGuard deps (from the global ThrottlerModule) when the
  // controller attaches it per-route — same registration LiveModule uses.
  providers: [
    HelpdeskService,
    HelpdeskRetentionService,
    HelpdeskThrottlerGuard,
    AppConfigService,
  ],
})
export class HelpdeskModule {}
