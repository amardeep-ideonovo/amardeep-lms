import { Module } from '@nestjs/common';
import { LmsService } from './lms.service';
import { LmsController } from './lms.controller';
import { AccessService } from './access.service';
import { MuxService } from './mux.service';

@Module({
  providers: [LmsService, AccessService, MuxService],
  controllers: [LmsController],
  exports: [AccessService],
})
export class LmsModule {}
