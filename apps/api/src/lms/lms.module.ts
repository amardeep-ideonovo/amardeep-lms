import { Module } from '@nestjs/common';
import { LmsService } from './lms.service';
import { LmsController } from './lms.controller';
import { AccessService } from './access.service';

@Module({
  providers: [LmsService, AccessService],
  controllers: [LmsController],
  exports: [AccessService],
})
export class LmsModule {}
