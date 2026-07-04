import { Module } from '@nestjs/common';
import { LmsService } from './lms.service';
import { LmsController } from './lms.controller';
import { AccessService } from './access.service';
import { CertificatesModule } from '../certificates/certificates.module';

@Module({
  imports: [CertificatesModule], // lesson views surface certificate state
  providers: [LmsService, AccessService],
  controllers: [LmsController],
  exports: [AccessService],
})
export class LmsModule {}
