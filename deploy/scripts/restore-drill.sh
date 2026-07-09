#!/usr/bin/env bash
# Restore drill (deploy/BACKUP.md §4): prove the latest DB backup actually
# restores. Restores it into a THROWAWAY Postgres, prints row counts to compare
# against prod, appends the result to deploy/BACKUP-DRILLS.md, then tears down.
#
# Non-destructive: never touches production. Run at least quarterly.
#   /opt/lms/deploy/scripts/restore-drill.sh
# Exit codes: 0 ok · 1 no backup / restore failed · 2 restored DB looks empty.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
NAME="${DRILL_CONTAINER:-lms-restore-drill}"
PORT="${DRILL_PORT:-55432}"
PG_IMAGE="${PG_IMAGE:-postgres:16}"
DRILLS_LOG="$(cd "$(dirname "$0")/.." && pwd)/BACKUP-DRILLS.md"

LATEST=$(ls -1t "$BACKUP_DIR"/lms-db-*.sql.gz 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  echo "[drill] no DB backup found in $BACKUP_DIR" >&2
  exit 1
fi
echo "[drill] restoring $LATEST into a throwaway $PG_IMAGE"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=drill -p "$PORT":5432 "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

docker exec "$NAME" psql -U postgres -c 'CREATE DATABASE lms;' >/dev/null
gunzip -c "$LATEST" | docker exec -i "$NAME" psql -U postgres -d lms >/dev/null

q() { docker exec "$NAME" psql -U postgres -d lms -t -A -c "$1" | tr -d '[:space:]'; }
USERS=$(q 'SELECT count(*) FROM "User";')
ACTIVE=$(q $'SELECT count(*) FROM "UserLevel" WHERE status = \'ACTIVE\';')

echo "[drill] restored OK — Users=$USERS  ActiveUserLevels=$ACTIVE  (compare against prod)"
echo "- $(date +%Y-%m-%d) — OK — Users=$USERS ActiveUserLevels=$ACTIVE (backup: $(basename "$LATEST"))" >> "$DRILLS_LOG"

if [ "${USERS:-0}" -lt 1 ]; then
  echo "[drill] WARNING: restored DB has 0 users — the backup may be empty/corrupt" >&2
  exit 2
fi
