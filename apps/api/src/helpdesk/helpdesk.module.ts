import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { jwtSecret } from "../common/env.util";
import { HelpdeskController } from "./helpdesk.controller";
import { HelpdeskAdminController } from "./helpdesk-admin.controller";
import { HelpdeskService } from "./helpdesk.service";
import { HelpdeskRetentionService } from "./helpdesk-retention.service";

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
  ],
  controllers: [HelpdeskController, HelpdeskAdminController],
  providers: [HelpdeskService, HelpdeskRetentionService],
})
export class HelpdeskModule {}
