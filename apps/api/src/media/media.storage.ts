import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { MEDIA_ROOT } from './media.config';

// Storage seam: the media service depends on this abstract class, so a cloud
// (S3/R2) implementation can be swapped in later by changing the module's
// `useClass` — no changes to the service, controller, or UI.
export abstract class MediaStorage {
  abstract put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

// Current backend: a local folder served statically at /media (see main.ts).
@Injectable()
export class LocalDiskStorage extends MediaStorage {
  async put(key: string, buffer: Buffer): Promise<void> {
    await fs.promises.writeFile(path.join(MEDIA_ROOT, key), buffer);
  }
  async delete(key: string): Promise<void> {
    await fs.promises.unlink(path.join(MEDIA_ROOT, key)).catch(() => undefined);
  }
}
