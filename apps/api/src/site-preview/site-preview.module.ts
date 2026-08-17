import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SitePreviewController } from "./site-preview.controller";
import { SitePreviewService } from "./site-preview.service";

// @Global so AccessService (LmsModule) can inject SitePreviewService for the
// entitlement bypass without any of the member modules editing their imports.
// AuthModule brings JwtModule (session signing) + the passport "jwt" strategy
// that PermissionsGuard relies on.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [SitePreviewController],
  providers: [SitePreviewService],
  exports: [SitePreviewService],
})
export class SitePreviewModule {}
