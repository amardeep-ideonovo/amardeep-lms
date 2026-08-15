# LMS

Membership LMS replacing a WordPress + WooCommerce Subscriptions site. Full
architecture and rationale in [PLAN.md](PLAN.md).

## Monorepo (npm workspaces)

```
apps/api        NestJS API — single source of truth, serves all clients
apps/admin      Next.js admin (web only): levels, members, LMS, Stripe keys
apps/web        Next.js member site: login, dashboard, lessons, account
apps/mobile     Expo RN: login, dashboard, lessons (billing handled on web)
packages/db     Prisma schema + client  ← data model lives here
packages/types  Shared TS types / API client
```

## Status

**Live in production.** The platform runs as a fleet of per-client Docker
instances (API + admin + member web + Postgres + Redis, behind Caddy for
HTTPS) on a VPS, provisioned and upgraded by the licensing control plane
(separate repo). This repo builds the runtime images every instance pulls.

## Getting started

1. `cp .env.example .env` and fill in values.
2. `docker compose up -d` (Postgres on :5432, Redis on :6379).
3. `npm install`
4. `npm run db:generate && npm run db:migrate`
5. `npm run dev:api` (:3000), `npm run dev:admin` (:3001), `npm run dev:web` (:3002).
   Mobile: `cd apps/mobile && npm start`.

## Deployment (production)

Self-hosted on a VPS fleet — server bring-up in
[`deploy/SERVER-SETUP.md`](deploy/SERVER-SETUP.md), day-2 operations in
[`deploy/VPS-GUIDEBOOK.md`](deploy/VPS-GUIDEBOOK.md).

- Push to `main` → [`images.yml`](.github/workflows/images.yml) builds the
  three runtime images (api, web, admin) and pushes them to GHCR as
  `latest` + `sha-<sha>`.
- Client instances **pull** those tags (runtime env means one shared image
  serves every client). Rolling the fleet to a new tag is an operator action
  from the control plane — never automatic on push.
- Mobile (Expo) ships via TestFlight/Play, not web deploy.

## Branching & CI gate

- Work happens on short-lived `claude/*` feature branches → PR →
  **squash-merge to `main`**. No long-lived integration branch.
- The `protect-main` repo ruleset requires these checks green on every PR
  before merge:
  - `bdd` — the BDD suite (`packages/bdd`, Cucumber.js, API-level) via
    [`bdd.yml`](.github/workflows/bdd.yml).
  - `Lint`, `TypeCheck (mobile|puck|bdd|db)`, `Test (mobile)`,
    `Next build (admin)` and `Next build (web)` via
    [`build.yml`](.github/workflows/build.yml). (ESLint inside `Lint` is
    warning-first — the job fails only on lint errors or Prettier drift.)
- Run BDDs locally against a running API:
  ```bash
  npm run dev:api                     # API on :3000 (DB seeded)
  API_URL=http://localhost:3000 npm run -w @lms/bdd test
  ```
