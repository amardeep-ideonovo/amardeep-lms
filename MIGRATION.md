# Migrating this project to a new machine

How to move the full LMS dev environment to another Mac and continue building
from the **exact current state** (code + secrets + database + uploaded media).

> TL;DR: a plain `git clone` is **not** enough. The code is in git, but your
> secrets, your database data, and your uploaded files are deliberately **not**.
> This guide moves the missing pieces too.

## Your actual local stack (important)

This repo ships a `docker-compose.yml`, but **this machine does not use Docker.**
Postgres and Redis run as **native Homebrew services**:

- **Postgres 16** — `brew services` (auto-starts via LaunchAgent), on `localhost:5432`.
- **Redis** — `brew services`, on `localhost:6379` (BullMQ job queue; ephemeral, nothing to migrate).
- `DATABASE_URL` = `postgresql://amardeepsingh@localhost:5432/lms?schema=public`
  — connects as your **macOS username with no password** (local trust auth), db `lms`.

So the faithful migration reproduces that native setup (steps below). The Docker
route still works if you'd rather containerize — see [Alternative: Docker](#alternative-docker).

## What git carries vs. what it doesn't

| In git (arrives via `git clone`) | NOT in git — must be moved by hand |
| --- | --- |
| All source (`apps/*`, `packages/*`) + `package-lock.json` | `./.env` and `apps/api/.env` (real secrets) |
| `docker-compose.yml`, Prisma schema + migrations | **Database data** (native Postgres `lms` DB) |
| `.env.example` templates | **Uploaded media** — `apps/api/src/{files,images}/**` |
| Empty upload dirs (kept via tracked `.gitignore`) | `.mcp.json`, `.claude/settings.local.json` (dev convenience) |

### Two couplings you must respect
- **`SETTINGS_ENC_KEY` ↔ database.** `./.env` holds `SETTINGS_ENC_KEY`, the key
  that decrypts the Stripe secrets stored in the DB `Setting` table.
  Move the DB without the *same* key and those settings become unreadable.
- **Uploaded files ↔ database.** DB rows reference uploaded files by name
  (blog/category/course/lesson images, lesson-note PDFs). Move the DB but not the
  files → broken links.

So `./.env`, the DB dump, and the uploads bundle must all travel together.

## Dependencies

**npm packages reproduce automatically.** Every workspace `package.json` and the
root `package-lock.json` are committed, so a clean install pins the exact same
~1,700 packages. Use `npm ci` (not `npm install`) for a lockfile-faithful install:

```bash
npm ci                 # root install covers all workspaces
npm run db:generate    # Prisma client (no postinstall hook does this for you)
```

**No native compilation required.** Nothing needs node-gyp/a C++ toolchain to
build — password hashing is pure-JS `bcryptjs`, and Prisma + esbuild ship
prebuilt binaries npm fetches for arm64 automatically.

What each workspace pulls in (all installed by `npm ci` — listed for orientation):

| Workspace | Stack / key deps | Runtime needs |
| --- | --- | --- |
| `apps/api` (`@lms/api`) | NestJS 10, Stripe 16, BullMQ + ioredis, passport-jwt, sanitize-html, Sentry | **Postgres + Redis** |
| `apps/web` (`@lms/web`) | Next.js 14.2.5, React 18.2, Puck editor, Mux player | API running |
| `apps/admin` (`@lms/admin`) | Next.js 14.2.5, React 18.2, Puck, TipTap | API running |
| `apps/mobile` (`@lms/mobile`) | Expo SDK 51, RN 0.74.5, React Navigation, expo-av/secure-store/file-system, dev-client | see Mobile note |
| `packages/db` (`@lms/db`) | Prisma 5.22 (+ bcryptjs) | Postgres; run `db:generate` |
| `packages/types`, `packages/puck` | shared internal TS (no external deps) | — |
| `packages/bdd` (`@lms/bdd`) | Cucumber.js 10 (API-level tests) | API running |

### Mobile (Expo) — extra setup only if running on devices/simulators
`apps/mobile` uses **`expo-dev-client`** (a custom dev build, not plain Expo Go)
with native modules. Web preview (`npm run web`) needs nothing extra. For native:
- **iOS:** Xcode + iOS Simulator, `watchman`, and CocoaPods (`brew install cocoapods`).
- **Android:** Android Studio + SDK + an emulator, and JDK 17.
- Build a dev client via EAS (`npx eas build --profile development`) or a local
  prebuild — Expo Go alone won't load the native modules.

### Node version caveat
This repo runs on **Node 24.13.0** (engines: `>=20`). Expo SDK 51 predates Node
24 and officially targets Node 18/20 LTS. The API/web/admin are fine on either;
if Metro/Expo tooling misbehaves, switch that shell to Node 20 LTS
(`nvm install 20 && nvm use 20`).

### Git identity
Commits here fell back to an auto-derived name/email. Set it explicitly on the
new machine so commits are attributed correctly:
```bash
git config --global user.name  "Amardeep Singh"
git config --global user.email "you@example.com"
```

## Recommended approach: selective migration (not Apple Migration Assistant)

For a single project onto a fresh Apple-silicon Mac, do a **clean selective
migration** rather than a whole-machine copy:

- **Never copy `node_modules`.** Platform-specific native binaries (Prisma engine,
  esbuild). Always reinstall fresh with `npm ci`.
- A new machine deserves clean ARM-native toolchain installs.
- It's deliberate — you know exactly what landed.

---

## Phase 1 — Export from the OLD machine

```bash
cd ~/Desktop/LMS          # repo root
mkdir -p ~/lms-migration

# 1) Secrets + local config (not in git)
cp ./.env                        ~/lms-migration/root.env
cp ./apps/api/.env               ~/lms-migration/api.env
cp ./.mcp.json                   ~/lms-migration/ 2>/dev/null || true
cp ./.claude/settings.local.json ~/lms-migration/ 2>/dev/null || true

# 2) Uploaded media (gitignored content)
tar -czf ~/lms-migration/uploads.tgz apps/api/src/files apps/api/src/images

# 3) Database dump — native Postgres (NO Docker). Reads creds from .env; the
#    value is not printed. --no-owner makes the restore role-agnostic.
DB_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' | sed 's/?.*//')
pg_dump "$DB_URL" --no-owner --no-privileges > ~/lms-migration/lms-dump.sql

# sanity: should print non-zero counts
grep -c 'CREATE TABLE' ~/lms-migration/lms-dump.sql
```

Transfer `~/lms-migration/` to the new Mac — it's ~400 KB, so **AirDrop** is easiest.

> ⚠️ This bundle contains live secrets, password hashes, and user data.
> Transfer device-to-device (AirDrop) or via an encrypted drive only — never
> email it or put it in cloud storage. Delete the bundle from both machines
> once the migration is verified.

---

## Phase 2 — Set up the NEW machine

```bash
# --- Toolchain ---
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git gh watchman stripe/stripe-cli/stripe

# --- Data services (native, matching your current setup) ---
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
# postgresql@16 is keg-only; put its client tools (psql/createdb/pg_dump) on PATH:
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc && exec zsh

# --- Node (match the old machine: v24.13.0; package.json engines requires >=20) ---
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec zsh
nvm install 24.13.0 && nvm alias default 24.13.0

# --- Git identity ---
git config --global user.name "Amardeep Singh"
git config --global user.email "you@example.com"

# --- Clone + the working branch ---
gh auth login
git clone https://github.com/amardeep-ideonovo/amardeep-lms.git LMS
cd LMS && git checkout amardeepLMS

# --- Drop the non-git pieces back in ---
cp ~/lms-migration/root.env ./.env
cp ~/lms-migration/api.env  ./apps/api/.env
cp ~/lms-migration/.mcp.json ./ 2>/dev/null || true
cp ~/lms-migration/settings.local.json ./.claude/ 2>/dev/null || true
tar -xzf ~/lms-migration/uploads.tgz          # restores apps/api/src/{files,images}

# --- Restore the database (native Postgres) ---
createdb lms
psql -d lms -f ~/lms-migration/lms-dump.sql

# --- Dependencies + Prisma client ---
npm ci
npm run db:generate
```

> **Username gotcha.** `DATABASE_URL` connects as `amardeepsingh` with no
> password. Homebrew Postgres auto-creates a superuser role equal to your macOS
> username, so this works out-of-the-box **only if the new Mac's username is also
> `amardeepsingh`**. If it differs, either create a matching role
> (`createuser -s amardeepsingh`) or edit `DATABASE_URL` in **both** `.env` files
> to your new username. The dump is role-agnostic (`--no-owner`), so only the
> connecting user matters.
>
> Do **not** run `npm run db:migrate` — you're restoring a populated DB; the dump
> already carries the schema. Only migrate if you take the fresh-DB route below.

---

## Phase 3 — Verify you're at the same state

```bash
npm run dev:api     # :3000  → open http://localhost:3000/health (should be OK)
npm run dev:admin   # :3001     (your levels/members should show)
npm run dev:web     # :3002     (blog/category images render → uploads+DB in sync)
# mobile:  cd apps/mobile && npm start
# Stripe webhooks (local dev):
#   stripe listen --forward-to localhost:3000/billing/webhook
```

Sanity checks:
- Admin lists your existing levels/members → DB restored correctly.
- Blog/category images render in web/admin → uploads + DB are in sync.
- BDD gate passes: `API_URL=http://localhost:3000 npm run -w @lms/bdd test`.

---

## Alternative: Docker

The repo ships `docker-compose.yml` (Postgres 16 + Redis 7) if you prefer
containers over native services. Install Docker Desktop, then instead of the
native Postgres/Redis steps:
```bash
docker compose up -d                                   # Postgres :5432 + Redis :6379
cat ~/lms-migration/lms-dump.sql | docker compose exec -T postgres psql -U postgres -d lms
```
Note the compose Postgres uses `postgres:postgres` creds — update `DATABASE_URL`
in both `.env` files to `postgresql://postgres:postgres@localhost:5432/lms?schema=public`.

## Alternative: fresh database (no data carryover)

To start clean instead of carrying your dev data (skip the DB dump + uploads in
Phase 1):
```bash
createdb lms          # or: docker compose up -d
npm ci && npm run db:generate
npm run db:migrate     # creates schema from migrations
npm -w packages/db run seed
```
You still need `./.env` (for `SETTINGS_ENC_KEY`, the DB URL, and the
Stripe keys the seed reads). Previously uploaded media will be absent.

---

## Tooling summary (new machine)

| Tool | Why |
| --- | --- |
| Node (match `24.13.0`, or any `>=20`) | monorepo runtime; pin via `nvm` |
| `postgresql@16` (Homebrew) | the database (native; `brew services start`) |
| `redis` (Homebrew) | BullMQ job queue (native; `brew services start`) |
| `git`, `gh` | clone + GitHub auth |
| `stripe` CLI | forward Stripe webhooks to the local API during dev |
| `watchman` | React Native / Expo file watching (`apps/mobile`) |
| CocoaPods + Xcode | iOS mobile builds — only if running mobile on iOS |
| Android Studio + JDK 17 | Android mobile builds — only if running mobile on Android |
| Docker Desktop | optional — only if you take the Docker route above |

> System tools only. All npm dependencies are restored by `npm ci` (see the
> [Dependencies](#dependencies) section) — no manual package installs needed.
