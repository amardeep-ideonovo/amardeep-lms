import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificateTemplatesController } from './certificate-templates.controller';

// Class-completion certificates: admin-designed templates (artwork + visual
// field layout) + member claim/download flows. PrismaModule is global.
@Module({
  imports: [NotificationsModule],
  providers: [CertificateTemplatesService],
  controllers: [CertificateTemplatesController],
})
export class CertificatesModule {}
