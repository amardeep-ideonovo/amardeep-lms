# Membership LMS — Architecture & Build Plan

Replaces a WordPress + **WooCommerce Subscriptions** site. Reuses the **same Stripe
account** (subscriptions keep billing — no migration of live subs, only reconciliation).

## Locked decisions
- **Contacts/email:** ONE in-house contact list, each level = a **tag** (not a
  separate list per level). Tags dedup naturally and a user can hold many at once.
- **Stripe multi-level:** one subscription with multiple line items (one invoice/charge).
- **Stripe self-service:** use the hosted **Customer Portal** for change-plan / update-card /
  cancel — we don't build that UI.
- **Mobile:** content + login only. All purchasing/billing on web (Apple/Google IAP rules).
- **Video:** managed (Mux) with signed playback URLs.
- **Source of truth:** app DB for membership state; Stripe for billing/entitlement;
  the in-house contacts/email platform for email deliverability. All driven by
  webhooks, never client redirects.

## Stack
| Layer | Choice |
|---|---|
| API (the "backend") | NestJS + Postgres + Prisma |
| Async jobs | Redis + BullMQ (contact/tag sync, webhooks, migration — idempotent + retryable) |
| Admin panel (web only) | Next.js |
| Member web | Next.js |
| Mobile | Expo / React Native (shares the TS API client) |
| Video | Mux (or Cloudflare Stream) |

## Monorepo layout
```
apps/api      NestJS API — single source of truth, serves all clients
apps/admin    Next.js admin (levels, members, LMS, Stripe keys)
apps/web      Next.js member site (login, dashboard, lessons, account)
apps/mobile   Expo RN (login, dashboard, lessons — no billing)
packages/db   Prisma schema + generated client
packages/types Shared TS types / API client
```

## Data model
See `packages/db/prisma/schema.prisma`. Keystones:
- **UserLevel** join carries `source (stripe|manual)` + `status`, so a manual grant and a
  paid subscription for the same level coexist (resolves the manual+paid overlap edge case).
- **CourseLevel** join: a course is assigned to many levels.
- **Access rule:** a course unlocks if the user has ANY active `UserLevel` among the
  course's assigned levels. Enforced server-side; video additionally protected by signed URLs.
- **Category** added (the doc's dashboard referenced "categories" but never defined them).
- **SubscriptionMirror** kept current by Stripe webhooks.
- **Setting** stores Stripe secrets encrypted at rest, write-only from admin UI.

## Backend modules (apps/api)
1. Auth/RBAC — admin + member login; admin roles SUPER_ADMIN/ADMIN/EDITOR.
2. Levels — CRUD; on create pick contact tag + create/link Stripe Product+Price.
3. Members — list (Username, Email, Registered Date, all levels); manual add-to-level.
4. LMS — Categories, Courses, Lessons; assign course→levels; Mux upload.
5. Billing — encrypted key config, Customer Portal session, webhook handler
   (`customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`)
   → updates UserLevel → enqueues contact tag sync.
6. Contacts/email — in-house contact list + email engine; BullMQ worker keeps
   each contact's level tags in sync idempotently (add/remove).
7. Migration — one-off import + reconciliation (below).

## Frontend
- **Member web:** Login · Dashboard (lock/unlock per access) · Course→lesson list ·
  Lesson page (Mux player) · Account → Stripe Customer Portal.
- **Mobile:** Login · Dashboard · Lesson playback · progress. Links out to web for billing.

## Migration & cutover (WooCommerce Subscriptions → same Stripe account)
1. **Users:** MySQL dump (REST/CSV drop the Stripe meta). Import users; migrate WP
   phpass/bcrypt password hashes, transparently re-hash on first login (no forced reset).
2. **Subscriptions:** none to migrate. Pull active subs from Stripe API, match
   `cus_…` → user, populate UserLevel. Reconcile both directions.
3. **Cutover:** add new Stripe webhook endpoint alongside WooCommerce's; run new app
   read-only and reconcile; then DISABLE WooCommerce's webhook and switch login/DNS.
   Keep WP read-only one billing cycle as fallback. Never run two writers.

## Security
- Stripe secret keys encrypted at rest, write-only in admin UI, never returned to client.
- Card updates via Stripe Elements/SetupIntents (no PAN on our servers).
- Signed/expiring Mux playback URLs.
- Admin RBAC + audit log.
- GDPR/consent check before pushing migrated users into the contact list.

## QA / test strategy
- Unit + integration per module; Stripe webhooks tested via Stripe CLI on a test account.
- Idempotency tests for webhook + contact-sync handlers (out-of-order/duplicate events).
- Migration dry-run against a WP staging dump with count reconciliation before cutover.
- E2E: Playwright (web), Detox/Maestro (mobile) for login → locked/unlocked dashboard →
  lesson playback → portal cancel → access revoked.

## Phasing
1. Foundation — API skeleton, DB schema, auth/RBAC.
2. LMS core — categories/courses/lessons, Mux, access rules, dashboard + lesson pages.
3. Billing — Stripe products/prices, Customer Portal, webhooks → UserLevel.
4. Contacts/email — in-house contact list + tag sync worker.
5. Migration — import + reconcile + cutover rehearsal.
6. Mobile — Expo app on the stable API.
