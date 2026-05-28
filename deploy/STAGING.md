# Staging environment + production testing strategy

> **Status:** PLAN — for review, not yet executed.
>
> **Scope (revised):** Hosting setup (staging server, DNS, Render/Vercel/VPS,
> Stripe dashboard, Mailchimp dashboard, Sentry account) is handled by the
> user. This plan covers ONLY the in-repo code/config changes I'll push to
> GitHub to make the codebase production-ready. After the code lands, the
> user wires up the actual environments using the hosting checklist in §13.

---

## 1. Goal

Stand up a `staging.example.com` environment that mirrors production's
topology so we can:

1. Catch backend regressions before they touch the prod DB (today there is no
   staging — first place a billing change lands is the same DB real members
   use).
2. Run an automatable smoke subset (`@smoke` BDD tag) against any deployed
   environment via `API_URL=...` (the BDD world already supports this — see
   `packages/bdd/features/support/world.ts:7`).
3. Walk a 14-item manual checklist on staging before promoting to prod,
   including Stripe checkout in test mode and Mailchimp tag sync against a
   dedicated staging audience.
4. Have a fallback safety net (observability + rollback) for the rare
   regression that escapes both.

**Out of scope for this doc:**
- Public signup endpoint (tracked separately — see §10).
- Canary / blue-green deploys (explicitly not worth building at current scale).
- Detox / Playwright (BDD + manual checklist is sufficient).
- Settings-table audit log (one admin today; revisit at >1).

---

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Prod + staging hosting | User-managed on their own server; my code stays host-agnostic |
| What I deliver | In-repo PRs only; no Render/Vercel/DNS/dashboard changes |
| What user does after merge | Pulls latest, deploys to their server, wires env vars per §13 |
| Signup scope | Public signup endpoint, NO email verification yet |
| Output format | Plan first → review → build → push to GitHub |
| Manual QA effort | ~15 min checklist walked on staging before each prod promote |
| Observability tool | Sentry SDK in code (env-gated by `SENTRY_DSN`); account/DSN user-side |

---

## 3. Target topology

```
                                Production                             Staging
                          ────────────────────                  ────────────────────
Vercel (admin)      admin.example.com                       admin-staging.example.com
Vercel (web)        example.com / www.example.com           staging.example.com
Render (API)        api.example.com                         api-staging.example.com
                       ↓                                         ↓
Render Postgres     lms-db (prod plan)                       lms-db-staging (starter plan)
Render Redis        lms-redis (prod)                         lms-redis-staging
Stripe              live keys (sk_live_*)                    test keys (sk_test_*)
Mailchimp           prod audience id                         "LMS Staging" audience id
Mux video           prod signing keys                        prod keys OR a 2nd dev signing key
Uploads             Render disk (or S3 — see §9)              Render disk (ephemeral OK)
```

Cost estimate: staging adds ~$0–14/mo depending on Render plan choices. Free
tier works for staging but spins down on inactivity (~30s cold start on first
request after idle) — acceptable for an internal-use environment.

---

## 4. Build order (REVISED — code-only deliverables)

Sequenced low-risk → higher-risk. Each is an independently mergeable PR
against `amardeepLMS`. Nothing in this list requires hosting access.

| # | PR | What | Effort | Risk |
|---|---|---|---|---|
| 1 | `docs/staging-readiness` | This doc revision + `deploy/QA-CHECKLIST.md` + `deploy/BACKUP.md` + `.env.example` audit (add `SENTRY_DSN`, `ENV_NAME` to all `.env.example` files) | 1h | None — docs only |
| 2 | `health/deep-check` | Deep `/health` endpoint: Prisma `SELECT 1` + Redis `PING` + `ENV_NAME` field. Backwards-compatible (still returns `status` + `uptime`) | 1h | Low — additive |
| 3 | `ci/build-gates` | New CI workflow: `tsc --noEmit` for all workspaces + `next build` for admin/web + `expo export --platform web` for mobile. Does NOT yet block merges (informational first) | 2h | None — CI only |
| 4 | `obs/sentry-api` | Wire `@sentry/node` + `@sentry/nestjs` in `apps/api`. No-op if `SENTRY_DSN` unset. Add `ENV_NAME` tag | 2h | Low — env-gated |
| 5 | `obs/stripe-webhook-log` | Log every Stripe webhook with `event.id` + `event.type` + outcome + duration. No behavior change | 1h | None — log-only |
| 6 | `auth/rate-limit` | `@nestjs/throttler` on `/auth/login`, `/auth/admin/login`, `/auth/signup` (5/min per IP). Per-route override on signup if needed | 1h | Medium — could block legit users; tune limits |
| 7 | `auth/public-signup` | New `POST /auth/signup` (no email verification). Body: email/password/firstName/lastName/phone. Issues JWT. BDD scenarios for happy/duplicate/weak/rate-limited. Web + mobile signup screens | 5h | Medium — net-new endpoint + UI |
| 8 | `tests/smoke-tag` | `@smoke` tag on 6 BDD scenarios + `npm run -w @lms/bdd test:smoke` script + `seed:staging` idempotent npm script + `smoke-staging.yml` workflow (manual + cron) targeting `$API_URL` | 2h | None — new infra |

**Total: ~15h, 8 PRs.** All against `amardeepLMS`; you merge to `main` on
your own cadence after testing each on your staging.

### Why this order
1. **Docs first** — zero risk, sets up review surface
2. **Health + CI + Sentry + webhook log** — observability before behavior change
3. **Rate limit + signup + smoke** — actual app changes, in increasing scope
4. Signup deliberately last among code changes so observability is in place
   first (if signup misbehaves, Sentry sees it)

---

## 5. Detailed step specs

### Step 1 — `render-staging.yaml`

Create `/render-staging.yaml` as a sibling to `render.yaml`. Differences from
prod:

```yaml
# render-staging.yaml — Staging blueprint. Auto-deploys from amardeepLMS.
databases:
  - name: lms-db-staging
    databaseName: lms
    plan: starter   # NOT free — staging needs to stay warm during a QA pass

services:
  - type: redis
    name: lms-redis-staging
    plan: free
    maxmemoryPolicy: noeviction
    ipAllowList: []

  - type: web
    name: lms-api-staging
    runtime: docker
    dockerfilePath: ./apps/api/Dockerfile
    dockerContext: .
    plan: starter
    healthCheckPath: /health
    autoDeploy: true
    branch: amardeepLMS   # staging tracks the dev branch, prod tracks main
    envVars:
      - key: ENV_NAME
        value: staging                 # NEW — surfaced in /health
      - key: DATABASE_URL
        fromDatabase: { name: lms-db-staging, property: connectionString }
      - key: REDIS_URL
        fromService: { type: redis, name: lms-redis-staging, property: connectionString }
      - key: PORT
        value: "3000"
      - key: JWT_SECRET
        generateValue: true
      - key: SETTINGS_ENC_KEY
        sync: false                   # set manually in Render dashboard
      - key: WEB_APP_URL
        value: https://staging.example.com
      - key: CORS_ORIGIN
        value: https://staging.example.com,https://admin-staging.example.com
      - key: STRIPE_SECRET_KEY        # sk_test_*
        sync: false
      - key: STRIPE_WEBHOOK_SECRET    # whsec_* from staging webhook
        sync: false
      - key: MAILCHIMP_API_KEY        # same key as prod is fine
        sync: false
      - key: MAILCHIMP_SERVER_PREFIX
        sync: false
      - key: MAILCHIMP_AUDIENCE_ID    # ID of the "LMS Staging" audience
        sync: false
      - key: MUX_TOKEN_ID
        sync: false
      - key: MUX_TOKEN_SECRET
        sync: false
      - key: MUX_SIGNING_KEY_ID
        sync: false
      - key: MUX_SIGNING_KEY_PRIVATE
        sync: false
```

**Risk callout:** Render's free tier API + free Redis will spin down. For a
QA pass that takes 15 minutes of click-through, that's annoying but tolerable.
Recommend `starter` for the API + DB and free for Redis (BullMQ is fine to be
cold-started). Bumping to starter is ~$7+$7+$0 = $14/mo for the full staging
stack.

### Step 2 — DNS records

On your registrar:

| Host | Type | Target |
|---|---|---|
| `staging` | CNAME | `<vercel-web-staging>.vercel.app` |
| `admin-staging` | CNAME | `<vercel-admin-staging>.vercel.app` |
| `api-staging` | CNAME | `lms-api-staging.onrender.com` |

(Vercel and Render both give you the canonical hostname after first deploy
— DNS goes in after step 1 and step 4, not before.)

### Step 3 — `ENV_NAME` + deep `/health`

Two changes to `apps/api/src/health/health.controller.ts` + module wiring:

1. Inject `PrismaService` and `@nestjs/bull` Queue. Run `SELECT 1` and
   `redis PING` with a 1s timeout each.
2. Add `ENV_NAME` (defaulting to `"production"`) to the response.

```ts
// apps/api/src/health/health.controller.ts (sketch)
@Get()
async check() {
  const env = process.env.ENV_NAME ?? 'production';
  const [db, redis] = await Promise.allSettled([
    this.prisma.$queryRaw`SELECT 1`,
    this.mailchimpQueue.client.ping(),
  ]);
  const ok = db.status === 'fulfilled' && redis.status === 'fulfilled';
  return {
    status: ok ? 'ok' : 'degraded',
    env,
    uptime: process.uptime(),
    checks: {
      db: db.status === 'fulfilled' ? 'ok' : 'fail',
      redis: redis.status === 'fulfilled' ? 'ok' : 'fail',
    },
  };
}
```

Backwards-compatible: still returns `status` + `uptime`; only adds fields.
Render's health check will continue passing.

### Step 4 — Vercel staging

Create two new Vercel projects (no repo change needed):
- `lms-admin-staging` → same repo, root `apps/admin`, branch `amardeepLMS`,
  env `NEXT_PUBLIC_API_URL=https://api-staging.example.com`.
- `lms-web-staging` → same repo, root `apps/web`, branch `amardeepLMS`,
  same env.

Vercel's preview deploys for *other* branches still work for both projects,
giving us free per-PR preview URLs as a bonus.

### Step 5 — Stripe test webhook

In Stripe **Test mode** dashboard:
- New webhook endpoint: `https://api-staging.example.com/billing/webhook`
- Events: `customer.subscription.{created,updated,deleted}`,
  `invoice.{paid,payment_failed}` (matches the switch in
  `apps/api/src/billing/billing.service.ts:118-142`)
- Copy the signing secret → Render `STRIPE_WEBHOOK_SECRET` for staging
  service
- Stripe **test** secret key (`sk_test_*`) → `STRIPE_SECRET_KEY`

### Step 6 — Mailchimp staging audience

In Mailchimp:
- Create a new audience named "LMS Staging" (yes, this counts against your
  free 500 contact cap — it's fine, staging contacts will be a handful)
- Copy its audience ID → Render `MAILCHIMP_AUDIENCE_ID` for staging
- API key + server prefix: same as prod (Mailchimp keys aren't environment-
  scoped). Discipline via audience-id separation is the only available
  control.

### Step 7 — Staging seed

`packages/db/prisma/seed.ts` already seeds an admin + member. For staging
we want it idempotent (re-runs don't duplicate). Add a small `seed:staging`
script that:
- Upserts the admin (`smoke-admin@example.com` / random rotating password
  stored in Render env)
- Upserts a `smoke-bot@example.com` member with a known password (for
  automated smoke scenarios)
- Upserts a FREE level + a PAID level wired to a `sk_test_*` price that
  costs $1.00 (for end-to-end checkout drills)
- Upserts a published page, a published popup, a published form

Run it as a Render "Job" once after the first staging deploy, or invoke
`npm run -w @lms/db seed:staging` manually via a shell session.

### Step 8 — `@smoke` BDD subset

The BDD world already accepts `API_URL` (see `world.ts:7`). All we need is:

1. Add `@smoke` tags to 5–6 existing scenarios across:
   - `auth.feature` — member login success
   - `pages.feature` — public GET /pages/<slug>
   - `blog.feature` — public GET /blog/posts
   - `popups.feature` — active popup visible for dashboard
   - `forms.feature` — admin can create a form (write path)

2. Add `package.json` script in `packages/bdd`:
   ```json
   "test:smoke": "cucumber-js --tags @smoke"
   ```

3. New workflow `.github/workflows/smoke-staging.yml`:
   - `workflow_dispatch` (manual run after staging deploy)
   - `schedule: cron '*/15 * * * *'` (every 15 min, cheap uptime check)
   - Runs `API_URL=https://api-staging.example.com npm run -w @lms/bdd test:smoke`
   - Posts to a Slack/Discord webhook on failure (optional; can defer)

**Critical:** smoke scenarios that *write* must use `name: "smoke-YYYY-MM-DD-..."` so they're identifiable + cleanable. A weekly cron can later sweep them.

### Step 9 — Manual QA checklist

New file `deploy/QA-CHECKLIST.md` — copyable markdown. The 14-item version
from the audit, refined:

```markdown
# Pre-release QA — walk against staging

## Setup
- [ ] `https://api-staging.example.com/health` returns `status:'ok'`, `env:'staging'`, both checks pass

## Admin
- [ ] Admin login (`admin@example.com`) → Members tab loads
- [ ] Create test member with firstName/lastName/phone → row appears with all fields
- [ ] Filter members by level → list narrows correctly
- [ ] Grant FREE level → Mailchimp "LMS Staging" audience receives the email + tag
- [ ] Edit the level's mailchimpTags (add one, remove one) → both changes reflect in Mailchimp within 30s

## Member (web)
- [ ] Member login → dashboard shows correct locked/unlocked courses
- [ ] Open course → lesson loads, Vimeo iframe plays
- [ ] Lesson note downloads with valid token (no naked URL leak)
- [ ] Active dashboard popup renders + "view" event increments in admin analytics

## Billing (Stripe test mode)
- [ ] PAID checkout: Subscribe → Stripe Checkout → card 4242 → success → UserLevel ACTIVE within 5s
- [ ] Customer Portal cancel → UserLevel CANCELED + Mailchimp tag removed
- [ ] Card 4000 0000 0000 0341 (past_due test card) → UserLevel PAST_DUE

## Public surfaces
- [ ] Admin Pages → create → publish → public /<slug> renders Puck blocks
- [ ] Form submission lands in admin entries view + Mailchimp staging audience
- [ ] embed.js: paste snippet on a local HTML file → form renders + submits cross-origin

## Mobile (Expo Go pointed at api-staging)
- [ ] Login → dashboard → course → lesson video → popup overlay all work

## Settings (do last — destructive)
- [ ] Remove Stripe keys via Settings UI → re-add → no crash, login still works
- [ ] Remove Mailchimp keys → re-add → audience list re-fetches
```

### Step 10 — Sentry in `apps/api`

```bash
npm install --workspace @lms/api @sentry/node @sentry/nestjs
```

Wire in `apps/api/src/main.ts`:
```ts
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.ENV_NAME ?? 'production',
    tracesSampleRate: 0.1,
  });
}
```
Plus the Nest integration in `app.module.ts`. New env var `SENTRY_DSN`
added to both `render.yaml` and `render-staging.yaml` (`sync: false`).

Why API only first: the billing webhook + Mailchimp queue are where silent
failures hurt most. Admin/web/mobile Sentry can be a follow-up PR once we've
seen what the API surfaces.

### Step 11 — CI build checks

Extend `.github/workflows/bdd.yml` (or add a `build.yml` companion) with:
- `npm run -w @lms/api build`
- `npm run -w @lms/admin build` (Next.js production build)
- `npm run -w @lms/web build`
- `npm run -w @lms/types build`
- `(cd apps/mobile && npx expo export --platform web)` — quickest mobile bundle check

Marketing this as a "required" check on `main` (in addition to BDD) requires
updating the GitHub ruleset; can defer that toggle.

### Step 12 — Backup + restore drill

Render Postgres has automatic daily backups on starter+ plans. The plan:
- Document the restore procedure in `deploy/BACKUP.md` (where to find the
  snapshot, the CLI command to restore into a fresh DB).
- Perform a one-time restore drill into a throwaway DB to confirm it works.
- (Optional later) S3 off-site backup if you want belt-and-braces.

For the uploads volume on Render: if you're using ephemeral disk, that's a
gap — call out a follow-up to migrate uploads to S3/R2 (Render's persistent
disk is single-instance, doesn't auto-snapshot).

---

## 6. Test strategy applied per component

Aligning to the testing-pyramid framework:

### Unit tests (NEW — biggest gap, lowest effort items)
Single-file, single-function tests for pure logic. Defer if needed, but
worth listing the high-value targets:

| Target | File | Why |
|---|---|---|
| `mapSubStatus` | `apps/api/src/billing/billing.service.ts:14-35` | Maps Stripe status → 6 internal statuses; if wrong, member access breaks silently |
| `reconcileLevelTags` diff logic | `apps/api/src/levels/levels.service.ts:170-193` | Adds/removes wrong tags = wrong Mailchimp state |
| `last4()` helper | `apps/api/src/settings/settings.controller.ts` | Returns the wrong key fingerprint = confused admin |

Recommend **Vitest** (faster than Jest, native ESM, plays nicely with Nest).
One config at repo root, one `*.spec.ts` per target. Not a CI gate yet,
just visible.

### Integration / BDD (exists, expand 2 scenarios)
New scenarios I'd add post-staging:
- `billing.feature` — mocked Stripe webhook (with valid HMAC signature)
  → reconcileSubscription → assert UserLevel + Mailchimp queue job emitted
- `levels.feature` — edit `mailchimpTags`, assert queue jobs emitted for
  every ACTIVE holder (uses a BullMQ test mode that captures jobs in
  memory rather than enqueueing for real)

This needs a BullMQ test-mode helper (~50 LOC). Defer to a separate PR
after staging is up.

### E2E (manual + synthetic)
- Manual: §5 step 9 checklist on staging
- Synthetic: §5 step 8 `@smoke` cron against staging every 15min

### Smoke against prod (after each deploy)
- Same `@smoke` tag, just `API_URL=https://api.example.com`
- Only the *read-only* subset + the `smoke-bot` login (no write
  scenarios — those would dirty prod)
- A single hidden $1 PAID level for the once-after-billing-deploy
  end-to-end Stripe drill

---

## 7. Observability minimums

Before we say "test in prod is possible":

| Need | Owner | Effort |
|---|---|---|
| API errors visible | Sentry in `apps/api` (Step 10) | 3h |
| DB/Redis health | Deep `/health` (Step 3) | 1h |
| Stripe webhook audit trail | Log every event with `event.id` + outcome (add to `BillingService.handleWebhook`) | 1h |
| Queue backlog visible | Bull-board UI on a protected admin route (optional) | 2h |
| Structured request logs | Swap `Logger` → `nestjs-pino` (optional) | 1h |

The first three are non-negotiable. Last two are nice-to-have.

---

## 8. Rollback story

Render auto-deploys from `main`. If a bad deploy lands:

1. **App rollback**: Render dashboard → service → "Deploys" tab → "Rollback"
   to previous successful deploy. ~30s.
2. **DB rollback**: Render Postgres snapshots are point-in-time. Restore to
   a fresh DB, swap connection string, re-deploy. ~5min.
3. **Migration rollback**: Prisma doesn't have native down-migrations.
   Convention: **no destructive migrations in a single step**. To drop a
   column, ship two releases:
   - Release N: stop writing the column, deploy
   - Release N+1: drop the column in a migration

Document this convention in `packages/db/prisma/README.md` (or just
`packages/db/README.md`).

---

## 9. Open questions (code-side only)

Hosting-side decisions (domain, plan tiers, Mux keys, Sentry plan, DNS) are
yours. The only decisions that affect what I write into the codebase:

1. **Rate-limit defaults** (PR #6): proposed `5 requests/min/IP` on `/auth/login`
   and `/auth/admin/login`; `3/min/IP` on `/auth/signup`. Adjustable later
   via env vars if you want them configurable.
2. **Signup auto-grant** (PR #7): when a user signs up, should we auto-grant
   a default `FREE` level? Or land them in a "no level" state until an admin
   grants? **Recommend auto-grant FREE if a level named "Free" exists**, no-op
   otherwise — least surprising for a WordPress migration.
3. **Smoke cron interval** (PR #8): every 15 min, hourly, or no cron (manual
   `workflow_dispatch` only)? **Recommend manual-only** initially — you can
   add cron once staging is stable.
4. **Smoke failure notification** (PR #8): GitHub Action's default email,
   GitHub issue auto-creation, or nothing? **Recommend default email** (zero
   integration) — escalate later if it becomes noise.
5. **CI build gate** (PR #3): should the new build job be a *required* check
   on `main`, or informational first? **Recommend informational for 2 weeks**
   to surface flakes before gating.

---

## 10. Separate track: public signup (no email verification)

Not part of this staging buildout, but called out so we don't forget. You
selected "partial signup — no email yet". Concrete scope when you're ready
to start that track:

- New route: `POST /auth/signup` in `apps/api/src/auth/auth.controller.ts`
- Body: `{email, password, firstName, lastName, phone?}`
- Behavior: creates a `User`, no FREE level granted automatically (TBD —
  configurable via Settings?), issues JWT identical to login
- Validation: password ≥ 10 chars, email unique, all the usual
- Rate limit: 5/minute per IP (use `@nestjs/throttler`)
- Web UI: new `/signup` page in `apps/web/`
- Mobile: new signup screen
- BDD: 4 scenarios — happy path, duplicate email, weak password, rate limit

**Effort: ~6h, blocking nothing.** Worth scheduling after staging is up so
we can verify it on staging before launching the signup link publicly.

If you want a level auto-granted on signup (e.g. a "registered" free level
that gives lightweight content access), that's a 30-min addition.

---

## 13. Hosting handoff — what you do after each PR merges

Tied to PRs so you know what to wire when. Anything you can do anytime is
flagged "anytime".

### After PR #1 (docs)
- Anytime: read `deploy/QA-CHECKLIST.md`, get familiar with the 15-min walk
- Anytime: read `deploy/BACKUP.md`, do a one-time restore drill into a
  scratch DB

### After PR #2 (deep /health)
- On your staging server: set `ENV_NAME=staging` in the staging environment
- On your prod server: optionally set `ENV_NAME=production` (default is
  `production` if unset)

### After PR #3 (CI build gates)
- No action — runs automatically on PRs

### After PR #4 (Sentry)
- Create Sentry account (free tier sufficient), one project per environment
  (or one project with environment tag)
- Set `SENTRY_DSN` in staging + prod env vars on your hosting
- Verify by intentionally throwing a 500 on staging and seeing it in Sentry

### After PR #5 (Stripe webhook logging)
- No env change needed; logs are emitted via the existing Nest `Logger`
- Optionally: pipe logs to a structured store (Render's log drain, papertrail,
  etc.) — your call

### After PR #6 (rate limiting)
- No env change in default mode
- If you want different limits per env: set `THROTTLE_LOGIN_LIMIT`,
  `THROTTLE_SIGNUP_LIMIT` env vars (will be documented in the PR)

### After PR #7 (public signup)
- Decide signup endpoint visibility: open to internet, or require an
  invitation code? (PR will support an optional `SIGNUP_INVITE_CODE` env
  var — if set, signups must include it)
- Add `/signup` to your web + mobile app's nav once you're ready to launch
  public signup

### After PR #8 (smoke tests)
- On your staging server: run `npm run -w @lms/db seed:staging` once to seed
  the `smoke-bot@example.com` member
- (Optional) configure the `smoke-staging.yml` workflow with your staging
  API URL as a repo secret `STAGING_API_URL`
- Run the smoke workflow manually after your first staging deploy to confirm

### One-time hosting setup (independent of PR order)
- Staging server provisioned (your shared host or VPS)
- DNS records pointing staging subdomain(s) at your server
- Stripe **test mode** webhook pointing at `<staging-api>/billing/webhook`
- Stripe test mode secret + signing secret in staging env vars
- Mailchimp dedicated "LMS Staging" audience (or use a tag like
  `env:staging` if you don't want a second audience)
- Mailchimp audience ID + API key in staging env vars
- Mux signing keys (reuse prod or generate a dev key — your call)
- Backup cron (`pg_dump` to off-server storage, daily)

---

## 11. What this doc does NOT cover

- Mobile app store submission process (already in `deploy/README.md` §11)
- Email infrastructure (signup verification, password reset, transactional
  email) — punted explicitly
- Multi-region / multi-tenant
- Load testing — no current perf complaints
- Penetration testing — worth a one-off external audit pre-launch but not
  part of regular testing

---

## Sign-off

Once you've answered §9, I'll execute steps 1–12 in order, one PR each, and
update this doc with a "✅ shipped" stamp per step. The whole sequence is
~13–14h of focused work and can be paced across however many sessions
you want.
