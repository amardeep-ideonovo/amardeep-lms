import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SiteService } from './site.service';
import { FooterService } from './footer.service';
import { AppConfigService } from './app-config.service';
import { SiteController } from './site.controller';
import { PublicSiteController } from './public-site.controller';
import { AdminAppConfigController } from './admin-app-config.controller';
import { PublicAppConfigController } from './public-app-config.controller';

// PrismaService is global; the admin controllers use the global JWT/permissions
// guards. ContactsService (injected by FooterService) is also @Global.
// ThrottlerModule backs the per-IP rate limit on the public newsletter subscribe.
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
  ],
  controllers: [
    SiteController,
    PublicSiteController,
    AdminAppConfigController,
    PublicAppConfigController,
  ],
  providers: [SiteService, FooterService, AppConfigService],
})
export class SiteModule {}
