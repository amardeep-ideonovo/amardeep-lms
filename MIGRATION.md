# Migrating this project to a new machine

How to move the full LMS dev environment to another Mac and continue building
from the **exact current state** (code + secrets + database + uploaded media).

> TL;DR: a plain `git clone` is **not** enough. The code is in git, but your
> secrets, your database data, and your uploaded files are deliberately **not**.
> This guide moves the missing pieces too.

## What git carries vs. what it doesn't

| In git (arrives via `git clone`) | NOT in git — must be moved by hand |
| --- | --- |
| All source (`apps/*`, `packages/*`) | `./.env` and `apps/api/.env` (real secrets) |
| `docker-compose.yml`, Prisma schema + migrations | **Database data** (lives in the Docker volume `lms_pg`) |
| `.env.example` templates | **Uploaded media** — `apps/api/src/{files,images}/**` |
| Empty upload dirs (kept via tracked `.gitignore`) | `.mcp.json`, `.claude/settings.local.json` (dev convenience) |

### Two couplings you must respect
- **`SETTINGS_ENC_KEY` ↔ database.** `./.env` holds `SETTINGS_ENC_KEY`, the key
  that decrypts the Stripe/Mailchimp secrets stored in the DB `Setting` table.
  Move the DB without the *same* key and those settings become unreadable.
- **Uploaded files ↔ database.** DB rows reference uploaded files by name
  (blog/category/course/lesson images, lesson-note PDFs under
  `apps/api/src/{files,images}`). Move the DB but not the files → broken links.

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
prebuilt binaries npm fetches for arm64 automatically. The API/web/admin install
cleanly with just Node + npm.

What each workspace pulls in (all installed by `npm ci` — listed for orientation):

| Workspace | Stack / key deps | Runtime needs |
| --- | --- | --- |
| `apps/api` (`@lms/api`) | NestJS 10, Stripe 16, Mailchimp, BullMQ + ioredis, passport-jwt, sanitize-html, Sentry | **Postgres + Redis** |
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

- **Never copy `node_modules`.** It contains platform-specific native binaries
  (Prisma engine, esbuild, bcrypt, React Native). Always reinstall fresh.
- A new machine deserves clean ARM-native toolchain installs.
- It's deliberate — you know exactly what landed.

(Whole-machine Migration Assistant also works if you want all your *other* apps
too — but still delete `node_modules` and `npm install` fresh in this repo.)

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

# 3) Database dump (Postgres runs in Docker; start it if stopped)
docker compose up -d postgres
sleep 5
docker compose exec -T postgres pg_dump -U postgres -d lms > ~/lms-migration/lms-dump.sql
```

Transfer `~/lms-migration/` to the new Mac — it's ~1 MB, so **AirDrop** is
easiest.

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
brew install --cask docker            # then launch Docker Desktop once
# Mobile on iOS/Android only (NOT needed for API/web/admin or mobile web preview):
# brew install cocoapods              # + install Xcode (iOS) / Android Studio + JDK 17 (Android)

# --- Node (match the old machine: v24.13.0; package.json engines requires >=20) ---
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart the shell, then:
nvm install 24.13.0 && nvm alias default 24.13.0

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

# --- Infra + restore DB ---
docker compose up -d                          # Postgres :5432 + Redis :6379
sleep 5
cat ~/lms-migration/lms-dump.sql | docker compose exec -T postgres psql -U postgres -d lms

# --- Dependencies + Prisma client (npm ci = exact, lockfile-faithful install) ---
npm ci
npm run db:generate
```

> Do **not** run `npm run db:migrate` (`prisma migrate dev`) when restoring a
> dump — the dump already carries the schema, and `migrate dev` may try to reset
> a DB it sees as out of sync. Only migrate if you take the fresh-DB route below.
>
> If the restore prints ownership/role warnings, re-dump on the old machine with
> `pg_dump --no-owner --no-privileges`.

---

## Phase 3 — Verify you're at the same state

```bash
npm run dev:api     # :3000  → open http://localhost:3000/health (should be OK)
npm run dev:admin   # :3001
npm run dev:web     # :3002
# mobile:  cd apps/mobile && npm start
# Stripe webhooks (local dev):
#   stripe listen --forward-to localhost:3000/billing/webhook
```

Sanity checks:
- Admin lists your existing levels/members → DB restored correctly.
- Blog/category images render in web/admin → uploads + DB are in sync.
- BDD gate passes: `API_URL=http://localhost:3000 npm run -w @lms/bdd test`.

---

## Alternative: fresh database (no data carryover)

If you'd rather start clean instead of carrying your dev data (skip the DB dump
and the uploads bundle in Phase 1):

```bash
docker compose up -d
npm install
npm run db:generate
npm run db:migrate      # creates schema from migrations
npm -w packages/db run seed
```

You still need `./.env` (for `SETTINGS_ENC_KEY`, DB URL, and the Stripe/Mailchimp
keys the seed reads). Any previously uploaded media will be absent.

---

## Tooling summary (new machine)

| Tool | Why |
| --- | --- |
| Node (match `24.13.0`, or any `>=20`) | monorepo runtime; pin via `nvm` |
| Docker Desktop | runs Postgres 16 + Redis 7 (`docker-compose.yml`) |
| `git`, `gh` | clone + GitHub auth |
| `stripe` CLI | forward Stripe webhooks to the local API during dev |
| `watchman` | React Native / Expo file watching (`apps/mobile`) |
| CocoaPods + Xcode | iOS mobile builds — only if running mobile on iOS |
| Android Studio + JDK 17 | Android mobile builds — only if running mobile on Android |

> System tools only. All npm dependencies are restored by `npm ci` (see the
> [Dependencies](#dependencies) section) — no manual package installs needed.
