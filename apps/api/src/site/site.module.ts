import { Module } from '@nestjs/common';
import { SiteService } from './site.service';
import { FooterService } from './footer.service';
import { SiteController } from './site.controller';
import { PublicSiteController } from './public-site.controller';

// PrismaService is global; the admin controller uses the global JWT/permissions
// guards. MailchimpService (injected by FooterService) is also @Global.
@Module({
  controllers: [SiteController, PublicSiteController],
  providers: [SiteService, FooterService],
})
export class SiteModule {}
