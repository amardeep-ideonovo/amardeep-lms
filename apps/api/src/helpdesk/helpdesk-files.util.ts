import * as fs from "fs/promises";
import * as path from "path";
import { resolveStorageDir } from "../storage/storage-dirs";

// Helpdesk screenshot attachments live under HELPDESK_FILES_DIR — a pinned
// per-instance volume dir, deliberately SEPARATE from the public media mount so
// a ticket screenshot is never world-readable. `fileKey` is the stored
// basename; basename() defends against a traversal-shaped key.
export function helpdeskFilePath(fileKey: string): string {
  return path.join(
    resolveStorageDir("HELPDESK_FILES_DIR"),
    path.basename(fileKey),
  );
}

// Write a re-encoded attachment buffer to the pinned dir (mkdir -p first).
export async function saveHelpdeskFile(
  fileKey: string,
  buffer: Buffer,
): Promise<void> {
  const dir = resolveStorageDir("HELPDESK_FILES_DIR");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(helpdeskFilePath(fileKey), buffer);
}

// Best-effort unlink of attachment files. Never throws: a leaked file must
// never block account erasure or the retention sweep. A row delete does not
// remove bytes on disk, so both call this after deleting the rows.
export async function removeHelpdeskFiles(fileKeys: string[]): Promise<void> {
  await Promise.all(
    fileKeys.map(async (key) => {
      if (!key) return;
      try {
        await fs.unlink(helpdeskFilePath(key));
      } catch {
        // already gone / never written — fine.
      }
    }),
  );
}
