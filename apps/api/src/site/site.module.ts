import { Module } from '@nestjs/common';
import { SiteService } from './site.service';
import { FooterService } from './footer.service';
import { AppConfigService } from './app-config.service';
import { SiteController } from './site.controller';
import { PublicSiteController } from './public-site.controller';
import { AdminAppConfigController } from './admin-app-config.controller';
import { PublicAppConfigController } from './public-app-config.controller';

// PrismaService is global; the admin controllers use the global JWT/permissions
// guards. MailchimpService (injected by FooterService) is also @Global.
@Module({
  controllers: [
    SiteController,
    PublicSiteController,
    AdminAppConfigController,
    PublicAppConfigController,
  ],
  providers: [SiteService, FooterService, AppConfigService],
})
export class SiteModule {}
