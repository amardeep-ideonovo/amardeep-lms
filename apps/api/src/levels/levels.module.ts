import { Module } from '@nestjs/common';
import { LevelsService } from './levels.service';
import { LevelsController } from './levels.controller';
import { BillingModule } from '../billing/billing.module';
import { LmsModule } from '../lms/lms.module';
import { CertificatesModule } from '../certificates/certificates.module';

@Module({
  // LmsModule provides AccessService; CertificatesModule powers the class-page
  // certificate status + level-delete file cleanup.
  imports: [BillingModule, LmsModule, CertificatesModule],
  providers: [LevelsService],
  controllers: [LevelsController],
})
export class LevelsModule {}
