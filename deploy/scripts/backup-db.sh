#!/usr/bin/env bash
# Daily Postgres backup for the single-instance (flagship) deploy.
# Referenced by deploy/BACKUP.md §2. Cron:
#   0 2 * * * /opt/lms/deploy/scripts/backup-db.sh >> /var/log/lms-backup.log 2>&1
#
# Defaults match BACKUP.md; override via env if your layout differs:
#   BACKUP_DIR   (/opt/backups)   LMS_COMPOSE (/opt/lms/deploy/docker-compose.yml)
#   DB_NAME (lms) DB_USER (postgres) RETAIN_DAYS (30)
#   RCLONE_REMOTE — if set (e.g. "r2:lms-backups"), the dump is mirrored
#                   off-server with rclone (BACKUP.md §3).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
COMPOSE="${LMS_COMPOSE:-/opt/lms/deploy/docker-compose.yml}"
DB_NAME="${DB_NAME:-lms}"
DB_USER="${DB_USER:-postgres}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y-%m-%d_%H-%M)
OUT="$BACKUP_DIR/lms-db-$TS.sql.gz"

docker compose -f "$COMPOSE" exec -T postgres \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$OUT"

# Integrity guard: a broken dump (container down, wrong creds) can still leave a
# tiny gzip. Fail loudly + drop the empty file so cron/monitoring notices rather
# than silently "succeeding".
if [ "$(wc -c < "$OUT")" -lt 100 ]; then
  echo "[backup-db] ERROR: dump $OUT is suspiciously small — removing + aborting" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" -name 'lms-db-*.sql.gz' -mtime +"$RETAIN_DAYS" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE/" && echo "[backup-db] mirrored to $RCLONE_REMOTE"
fi

echo "[backup-db] OK $OUT ($(date))"
