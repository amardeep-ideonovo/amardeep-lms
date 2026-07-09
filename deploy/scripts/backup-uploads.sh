#!/usr/bin/env bash
# Daily uploads-volume backup for the single-instance (flagship) deploy.
# The uploads volume holds lesson notes, blog images and course thumbnails —
# NOT in the DB dump, so restoring only the DB leaves the system inconsistent.
# Referenced by deploy/BACKUP.md §2. Cron:
#   30 2 * * * /opt/lms/deploy/scripts/backup-uploads.sh >> /var/log/lms-backup.log 2>&1
#
# Override via env: BACKUP_DIR (/opt/backups) UPLOADS_VOLUME (lms_uploads)
#   RETAIN_DAYS (30)  RCLONE_REMOTE (off-server mirror, BACKUP.md §3)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
VOLUME="${UPLOADS_VOLUME:-lms_uploads}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y-%m-%d_%H-%M)
OUT="$BACKUP_DIR/lms-uploads-$TS.tar.gz"

# Throwaway container tars the volume's contents (read-only mount).
docker run --rm -v "$VOLUME":/source:ro -v "$BACKUP_DIR":/backup alpine \
  tar -czf "/backup/lms-uploads-$TS.tar.gz" -C /source .

if [ "$(wc -c < "$OUT")" -lt 100 ]; then
  echo "[backup-uploads] ERROR: archive $OUT is suspiciously small — removing + aborting" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" -name 'lms-uploads-*.tar.gz' -mtime +"$RETAIN_DAYS" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE/" && echo "[backup-uploads] mirrored to $RCLONE_REMOTE"
fi

echo "[backup-uploads] OK $OUT ($(date))"
