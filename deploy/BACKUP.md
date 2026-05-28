# Backup & restore runbook

> Production data is in **two** places: the Postgres database (members,
> levels, content, submissions) and the uploads volume (lesson notes, blog
> images, course thumbnails). Both must be backed up; restoring only one
> leaves the system inconsistent.

---

## 1. What gets backed up

| Data | Source | Frequency | Retention |
|---|---|---|---|
| Postgres DB | `postgres` container in `deploy/docker-compose.yml` | Daily 02:00 server time | 30 days |
| Uploads | `uploads` Docker volume (`/data/images`, `/data/files`) | Daily 02:30 server time | 30 days |
| Settings encryption key | Plain env var `SETTINGS_ENC_KEY` in `deploy/.env` | One-time, kept offline | Forever |

> The Settings encryption key is **not** a regular backup target. If you
> lose it, all admin-set Stripe/Mailchimp keys in the Settings table become
> unreadable (you can re-enter them). Store it in your password manager.

---

## 2. Daily DB backup (cron)

Add to root's crontab (`crontab -e`):

```
0 2 * * * /opt/lms/deploy/scripts/backup-db.sh >> /var/log/lms-backup.log 2>&1
30 2 * * * /opt/lms/deploy/scripts/backup-uploads.sh >> /var/log/lms-backup.log 2>&1
```

Backup script (`deploy/scripts/backup-db.sh` — create if missing):

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/opt/backups
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y-%m-%d_%H-%M)
docker compose -f /opt/lms/deploy/docker-compose.yml exec -T postgres \
  pg_dump -U postgres lms | gzip > "$BACKUP_DIR/lms-db-$TS.sql.gz"

# Keep only the last 30 days
find "$BACKUP_DIR" -name 'lms-db-*.sql.gz' -mtime +30 -delete
```

Uploads backup (`deploy/scripts/backup-uploads.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/opt/backups
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y-%m-%d_%H-%M)
# Use a throwaway container to tar the volume's contents
docker run --rm -v lms_uploads:/source:ro -v "$BACKUP_DIR":/backup alpine \
  tar -czf "/backup/lms-uploads-$TS.tar.gz" -C /source .

find "$BACKUP_DIR" -name 'lms-uploads-*.tar.gz' -mtime +30 -delete
```

`chmod +x` both scripts after creating them.

---

## 3. Off-server copy (recommended)

Local-only backups die with the server. Mirror `/opt/backups` to off-server
storage at least weekly. Cheapest options:

- **rclone → Cloudflare R2/S3** — free egress + cheap storage (~$0.015/GB)
- **rsync → second cheap VPS** in a different region
- **Manual download → external drive** (only acceptable if backups are
  small and you're disciplined)

Whatever you pick, document it next to the cron lines above so a future
operator knows where the off-server copy lives.

---

## 4. Verifying a backup is good

A backup you've never restored is a wish, not a backup. **Do a real
restore drill at least once per quarter.**

Drill procedure (~20 min):

1. Spin up a scratch Postgres container:
   ```bash
   docker run -d --name lms-restore-test \
     -e POSTGRES_PASSWORD=test \
     -p 55432:5432 \
     postgres:16
   ```

2. Restore the latest backup into it:
   ```bash
   gunzip -c /opt/backups/lms-db-$(date +%Y-%m-%d)*.sql.gz | \
     docker exec -i lms-restore-test psql -U postgres -d postgres
   ```

3. Confirm row counts look right:
   ```bash
   docker exec -it lms-restore-test psql -U postgres -d lms \
     -c 'SELECT count(*) FROM "User";'
   docker exec -it lms-restore-test psql -U postgres -d lms \
     -c 'SELECT count(*) FROM "UserLevel" WHERE status = '\''ACTIVE'\'';'
   ```
   Compare against production. If they differ by more than 1 day's churn,
   investigate.

4. Tear down:
   ```bash
   docker rm -f lms-restore-test
   ```

Record the drill date + outcome in a `deploy/BACKUP-DRILLS.md` log file.

---

## 5. Real restore (production is down)

> Use this for catastrophic data loss only. For partial recovery (e.g. one
> table wiped), restore into a scratch DB first and `pg_dump`/copy the
> rows you need into production.

1. **Stop the API** so it can't write to the half-restored DB:
   ```bash
   docker compose -f /opt/lms/deploy/docker-compose.yml stop api
   ```

2. **Drop and recreate the DB** (this destroys current data — be sure):
   ```bash
   docker compose -f /opt/lms/deploy/docker-compose.yml exec postgres \
     psql -U postgres -c 'DROP DATABASE IF EXISTS lms;'
   docker compose -f /opt/lms/deploy/docker-compose.yml exec postgres \
     psql -U postgres -c 'CREATE DATABASE lms;'
   ```

3. **Restore from the chosen backup**:
   ```bash
   gunzip -c /opt/backups/lms-db-YYYY-MM-DD_HH-MM.sql.gz | \
     docker compose -f /opt/lms/deploy/docker-compose.yml exec -T postgres \
     psql -U postgres -d lms
   ```

4. **Restore uploads** (if needed):
   ```bash
   # Wipe the existing volume contents
   docker run --rm -v lms_uploads:/target alpine sh -c 'rm -rf /target/*'
   # Extract the tarball into the volume
   docker run --rm -v lms_uploads:/target -v /opt/backups:/backup:ro alpine \
     tar -xzf /backup/lms-uploads-YYYY-MM-DD_HH-MM.tar.gz -C /target
   ```

5. **Restart the API** and verify `/health`:
   ```bash
   docker compose -f /opt/lms/deploy/docker-compose.yml start api
   curl -s https://api.<your-domain>/health | jq .
   ```

6. **Sanity-check** the data via the admin UI — member count, recent
   subscriptions, recent submissions. If anything looks short, you may
   need a newer backup.

---

## 6. Migrations and backup order

Before any migration-bearing release:

```bash
# Take a fresh backup IMMEDIATELY before deploy
sudo /opt/lms/deploy/scripts/backup-db.sh
```

The API container runs `prisma migrate deploy` automatically on startup
(see `deploy/README.md` §5). If a migration breaks something irreversibly,
the pre-deploy backup is your only path back.

> **Convention**: never ship a destructive migration (DROP COLUMN, DROP
> TABLE) in the same release as code that depends on the new shape. Two
> releases: (1) deploy code that works without the column, (2) drop the
> column. This makes rollback safe.

---

## 7. Backup integrity over time

Things that silently break backups:

- **Disk fills up** — `df -h /opt/backups` should show ≥ 30 days of
  headroom. Set up an alert at 80% usage.
- **Postgres major-version mismatch** — if you upgrade the postgres image
  (e.g. 16 → 17), `pg_dump`s from the old version may not restore cleanly
  into the new. Do a restore drill on the new version before upgrading
  prod.
- **Volume rename** — if `docker compose down -v` is ever run, the
  `lms_uploads` volume is destroyed; an uploads tarball lets you restore
  but the volume name is hardcoded in the restore script. If you rename,
  update §5 step 4.
- **Encryption key drift** — the `SETTINGS_ENC_KEY` in `deploy/.env` is
  NOT in the DB backup. If you restore on a new server with a fresh key,
  encrypted settings (Stripe keys, Mailchimp keys) won't decode. Either
  copy the key from the old server or re-enter the secrets via admin UI
  after restore.

---

## 8. Quick checklist for a new operator

If you're handing this off to someone new, give them:

- [ ] Read access to `/opt/backups`
- [ ] SSH key on the server
- [ ] A copy of `SETTINGS_ENC_KEY` (in a password manager, never email)
- [ ] Bookmark to this doc
- [ ] Calendar invite for the quarterly restore drill
