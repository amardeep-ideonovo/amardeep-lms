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
Foundation scaffolded: monorepo, Prisma schema (the data model), env template.
The four apps are stubs — each needs its framework scaffold (commands in each
`package.json` description). Build order is the phasing list in PLAN.md.

## Getting started
1. `cp .env.example .env` and fill in values.
2. `docker compose up -d` (Postgres on :5432, Redis on :6379).
3. `npm install`
4. `npm run db:generate && npm run db:migrate`
5. `npm run dev:api` (:3000), `npm run dev:admin` (:3001), `npm run dev:web` (:3002).
   Mobile: `cd apps/mobile && npm start`.

All four apps are scaffolded and compile/build clean. Next: the WordPress
migration tooling.

## Deployment (pre-prod → prod)
Auto-deploys from `main`; no custom middleware needed.

- **Frontends (admin, member web) → Vercel.** Two Vercel projects, each with
  **Root Directory** = `apps/admin` / `apps/web`. Vercel auto-builds on push to
  `main` and gives a preview deploy per PR. Set `NEXT_PUBLIC_API_URL` per project.
- **API + Postgres + Redis → Render** via [`render.yaml`](render.yaml) (Blueprint).
  Render provisions the DB + Redis, builds [`apps/api/Dockerfile`](apps/api/Dockerfile),
  runs `prisma migrate deploy`, and redeploys on push to `main`. Health check: `/health`.
  Secrets (`SETTINGS_ENC_KEY`, Stripe/Mailchimp keys, `WEB_APP_URL`, `CORS_ORIGIN`)
  are set in the Render dashboard, never committed.
- The shared Plesk host (static/PHP only) is **not** used for the app — DNS can
  point your domain/subdomains at Vercel + Render.
- Mobile (Expo) ships via TestFlight/Play, not web deploy.

## Branching & BDD gate
- Work lands on **`amardeepLMS`** first, then merges to **`main`** via PR.
- The BDD suite (`packages/bdd`, Cucumber.js, API-level) runs on every PR to
  `main` via `.github/workflows/bdd.yml` and must pass before merge
  (enforced by branch protection on `main`).
- Run BDDs locally against a running API:
  ```bash
  npm run dev:api                     # API on :3000 (DB seeded)
  API_URL=http://localhost:3000 npm run -w @lms/bdd test
  ```
