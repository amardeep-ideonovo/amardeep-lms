import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppConfigService } from '../site/app-config.service';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificateTemplatesController } from './certificate-templates.controller';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';

// Class-completion certificates: admin-designed templates (artwork + visual
// field layout) + member claim/download flows. PrismaModule is global.
// CertificatesService is exported for LmsModule (lesson views/completion) and
// LevelsModule (class-page status) to enrich their member DTOs. AppConfigService
// (brand title for the CERTIFICATE_ISSUED automation) is a stateless reader over
// the global PrismaService; SiteModule doesn't export it, so provide it locally.
// AutomationService is injected from the @Global EmailModule.
@Module({
  imports: [NotificationsModule],
  providers: [CertificateTemplatesService, CertificatesService, AppConfigService],
  controllers: [CertificateTemplatesController, CertificatesController],
  exports: [CertificatesService],
})
export class CertificatesModule {}
