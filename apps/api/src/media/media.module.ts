import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalDiskStorage, MediaStorage } from './media.storage';

// Storage backend is bound here. Swap `useClass` to an S3/R2 implementation
// (reading creds from encrypted Settings) when a cloud provider is chosen.
@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    { provide: MediaStorage, useClass: LocalDiskStorage },
  ],
  exports: [MediaStorage], // reused by AuthModule for admin avatar storage
})
export class MediaModule {}
