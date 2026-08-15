# LMS Monorepo — Engineering Standards & Architecture

> **Status:** Adopted — roadmap phases P0-P5 executed and deployed (2026-08-14 → 2026-08-15) · **Date:** 2026-08-14 · **Scope:** this monorepo (the licensing-dashboard control-plane repo should mirror these standards in a follow-up).
>
> Produced from a repo-wide audit (five parallel research passes over `apps/api`, `apps/web` + `apps/admin`, `apps/mobile`, `packages/*` + CI/deploy, and a string/constant-duplication census). Every count and file reference below was taken from the tree at branch point `cb4f138` (post-#122).

**How to read this document.** Each section describes what the codebase actually does today, marked:

- ✅ **Standard** — this is the convention; follow it in new code.
- ⚠️ **Drift** — known debt or inconsistency; do **not** imitate it, and fix it opportunistically when touching the file.
- 🎯 **Decision** — a proposed new standard (Section 10) that changes current practice; adopt once merged.

---

## 1. Architecture

### 1.1 System shape — a single-image, multi-instance fleet

The product is a white-label membership LMS sold as one isolated instance per client:

- **One image set per commit.** CI builds `api`, `web`, `admin` Docker images on every push to `main` and publishes them to GHCR tagged `latest` + `sha-<sha>` (`.github/workflows/images.yml`). There is **no per-client build**.
- **One instance = one Docker Compose project** (`deploy/instance/docker-compose.instance.yml`): its own Postgres, Redis, and upload volumes, namespaced `lms_<id>`, bound to `127.0.0.1` behind a shared Caddy ingress. Per-instance secrets (`JWT_SECRET`, `SETTINGS_ENC_KEY`, `SEED_ADMIN_*`, `INSTANCE_SERVICE_TOKEN`) are injected by the provisioner.
- **The control plane is a separate repo** (licensing-dashboard) that provisions/upgrades instances by pinning `API_IMAGE`/`WEB_IMAGE`/`ADMIN_IMAGE` to a `sha-*` tag. Rolling the fleet is an explicit operator action, never automatic on push. (`apps/control-plane` in this repo is the operator console's in-monorepo Next.js app; see 1.2.)
- **Runtime origin resolution** is what makes one image serve every tenant: web/admin read `RUNTIME_API_URL`/`RUNTIME_WEB_URL` at request time and serve them to the browser via `app/env.js/route.ts` → `window.__ENV__`. See §2.6.
- **Branding is data, not build config.** The singleton `AppConfig` row drives instance branding. The mobile app derives its entire theme from it at runtime (§5.4); web/admin currently consume brand _text_ (site title) at runtime and ship a single baked-in "Spark" appearance (§4.5).
- **Mobile** is a shared multi-tenant Expo app (plus per-client locked builds): a connect code binds it to an instance, and all branding/theme arrives from that instance's `/app/config`.

### 1.2 Monorepo layout

npm workspaces (`package.json` → `apps/*`, `packages/*`), Node ≥ 20. No Turborepo/Nx — root scripts delegate with `npm -w`.

| Workspace            | Role                                                                                   | Stack                                                                |
| -------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/api`           | The instance backend (REST + WebSocket)                                                | NestJS 10, Express, Prisma via `@lms/db`                             |
| `apps/web`           | Member-facing site (public pages, checkout, learning)                                  | Next.js 14.2.5, App Router, port 3002                                |
| `apps/admin`         | Instance admin panel                                                                   | Next.js 14.2.5, App Router, port 3001, `NEXT_PUBLIC_ADMIN_BASE_PATH` |
| `apps/control-plane` | Operator console UI (fleet/licensing)                                                  | Next.js 14.2.5                                                       |
| `apps/mobile`        | Shared + white-label member app                                                        | Expo SDK 56 (dev-client), RN 0.85, React 19, react-navigation v7     |
| `packages/db`        | Prisma schema, migrations, seed, client singleton                                      | Prisma 5.22, CommonJS `index.js`                                     |
| `packages/types`     | **The shared contract**: 297 exports (DTOs, enums, route types)                        | Raw TS, consumed via tsconfig `paths` + `transpilePackages`          |
| `packages/puck`      | Shared page-builder config for `@puckeditor/core`                                      | Raw TSX, same consumption pattern                                    |
| `packages/ui`        | Shared browser UI for web/admin: modal a11y, toast, fetch core, cropper mechanism (D5) | Raw TSX, same consumption pattern                                    |
| `packages/bdd`       | API-level Cucumber suite (13 features / 64 scenarios)                                  | Cucumber.js 10                                                       |

### 1.3 Data flow and boundaries

- Clients (web, admin, mobile, and server components in web) talk **only** to the NestJS API over REST; the API is the single owner of Postgres via Prisma. There is no client-side DB access and no Next.js API-proxy layer (exactly two route handlers exist, both `env.js`).
- Realtime: Socket.IO gateway (`apps/api/src/projects/projects.gateway.ts`) with a Redis adapter that degrades gracefully to in-memory when `REDIS_URL` is absent.
- Instance ⇄ control-plane: outbound notifier (`apps/api/src/control-plane/control-plane.notifier.ts` — bearer `INSTANCE_SERVICE_TOKEN`, 4s timeout, never throws, inert unless configured) and inbound `ServiceTokenGuard`-protected endpoints (`support-sync`). Payment webhooks (Stripe/PayPal) use per-route raw-body parsers registered in `main.ts`.
- Shared types: **all four apps compile against `@lms/types`** (69 importing files in api, 53 admin, 31 web, 27 mobile). Cross-check found near-zero drift — exactly one name collision (`MediaKind`, redeclared in `apps/api/src/media/media.config.ts`). `apps/control-plane/lib/types.ts` is a _deliberate_ exception (fleet/licensing UI types, banner-commented "Do NOT import from packages/types").

### 1.4 Locked architectural decisions (and why)

- **Raw-TS shared packages, no build step.** `@lms/types`/`@lms/puck` ship `main: index.ts`; each Next app adds them to `transpilePackages` and tsconfig `paths`. Cheap to change, no publish loop. Trade-off: every consumer must repeat the wiring (see D7 for the Dockerfile manifest drift this caused).
- **JWT in localStorage, no cookies, no SSR auth.** Member token `lms_member_token` (web), `lms.admin.token` (admin), SecureStore on mobile. Gating is post-hydration client redirect (`AuthGate`/`AuthGuard`). Public/SEO routes are server-rendered; member-gated content is client-fetched.
- **`headers()`-forced dynamic rendering, not `export const dynamic`** in web's root layout — deliberate, so the fetch Data Cache keeps working (`apps/web/app/layout.tsx:88-96`); Next metadata routes ignore `export const dynamic`.
- **One-shot demo seed as a second create path.** Every instance boots `prisma migrate deploy` + seed; `SEED_DEMO_ONCE` + the `SeedState` singleton row make demo content a first-boot-only template so client edits survive restarts. `SEED_WIPE=1` is the _only_ destructive path; never `prisma migrate reset`.
- **Storage dirs are boot-guarded.** `apps/api/src/storage/storage-dirs.ts` declares all five dirs; production boot aborts if a writable dir is on its dev fallback (a real fleet incident: media loss on recreate). `deploy-pins.spec.ts` statically asserts every declared dir stays pinned in compose + Dockerfile.
- **Secrets at rest** ride AES-256-GCM under `SETTINGS_ENC_KEY` (`apps/api/src/common/crypto.util.ts`, `iv:authTag:ciphertext` base64; the `enc:v1:` envelope in `secret-value.util.ts` layers on top for JSON-embedded secrets).

---

## 2. Language, tooling & repo practices

### 2.1 TypeScript

- ✅ `strict: true` in **every workspace** — `apps/api` joined in P5 (full strict cost exactly 4 fixes; the DTO `!:` discipline had already paid the price).
- ✅ Per-workspace tsconfig, no shared base (only mobile extends `expo/tsconfig.base`). Deliberate split: root-hoisted TS 5.5.4 serves the Next apps + puck; mobile pins its own nested TS 6.0.3 (+ React 19 types) and is typechecked/tested in its own directory in CI.
- ✅ Compiler versions pinned exactly per workspace (P5): 5.9.3 for api/db/bdd, 5.5.4 for the Next apps, mobile's own 6.0.3.
- `noUnusedLocals` is intentionally set nowhere; ESLint's `no-unused-vars` (error) is the single enforcement point.

### 2.2 Linting — ESLint 9 flat config (`eslint.config.mjs`)

- ✅ **Warning-first philosophy** (documented in the config header): only rules that are clean today or catch outright bugs are errors; CI fails on errors only.
- ✅ Error-level: `@typescript-eslint/no-unused-vars`, `no-var`, `no-debugger`, `react-hooks/rules-of-hooks`, and — type-aware, on api/web/admin/control-plane/puck — `no-floating-promises`, `await-thenable`, `no-misused-promises` (with `checksVoidReturn.attributes: false`; use the `() => void fn()` idiom for async handlers handed to timers/listeners).
- ✅ Mobile is deliberately syntax-only (its TS 6 can't be served by the root compiler); react-hooks rules still apply.
- ⚠️ `packages/db` and `packages/types` get syntax-only coverage — `seed.ts` (2,825 lines of `await prisma.*`) is never checked for floating promises. → D7.

### 2.3 Formatting

- ✅ Prettier with **all defaults** (`.prettierrc.json` is `{}`) + `format:check` as a required CI step. Don't fight it; don't add options without a reason.
- ✅ `.editorconfig`: 2-space, LF, UTF-8, final newline, trim trailing whitespace (except `*.md`).
- ✅ One load-bearing ignore: `apps/api/src/contacts/confirm-token.util.ts` contains a literal NUL byte and must stay byte-identical (`.prettierignore`).

### 2.4 Naming conventions

| Layer                   | Convention                                                                                                                                                                                                                        | Example                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| API files               | kebab-case + Nest suffix (`.module/.controller/.service/.guard/.decorator/.dto/.strategy/.spec.ts`); non-Nest helpers `.util.ts`                                                                                                  | `src/live/live.throttler.guard.ts` |
| API variant controllers | ⚠️ two styles exist — dot-infix (`live.admin.controller.ts`) vs dash-prefix (`public-menus.controller.ts`). **Standard going forward: dash-prefix** (`admin-*.controller.ts`, `public-*.controller.ts`) — it's the majority form. |
| React components        | `PascalCase.tsx`, one component per file. Web/admin use default exports; mobile uses named exports (52 named vs 2 defaults — keep named on mobile).                                                                               |
| `lib/` modules          | ⚠️ mixed (`memberData.ts` vs `checkout-config.ts`). **Standard going forward: kebab-case** for new non-component modules.                                                                                                         |
| DTO files               | one `<feature>.dto.ts` per feature holding multiple classes (`src/auth/dto/`'s 8 single-class files are the legacy outlier)                                                                                                       |
| CSS classes             | feature-prefixed (`ik-`, `co-`, `pj-`, `nav-`…) + `/* ---------- Section ---------- */` banners; see §4.5                                                                                                                         |
| Commits                 | Conventional commits with scope: `feat(admin): …`, `fix(web): …`, `chore(format): …`, imperative lowercase subject, PR number appended by squash-merge                                                                            |
| Branches                | `claude/<topic>-<id>` for agent work; PRs squash-merge to `main`                                                                                                                                                                  |

### 2.5 CI gates (`protect-main` required checks)

| Check            | What it runs                                                                                                                                                                                                                             | Workflow    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Lint             | `eslint .` (errors only) then `prettier --check .`; runs `prisma generate` first so type-aware rules see real types                                                                                                                      | `build.yml` |
| TypeCheck matrix | `tsc --noEmit` for mobile (own TS 6), puck, bdd, db                                                                                                                                                                                      | `build.yml` |
| Test (mobile)    | mobile `node:test` suite, separate job so a tsc failure can't mask a test regression                                                                                                                                                     | `build.yml` |
| Next build ×2    | `next build` for admin and web                                                                                                                                                                                                           | `build.yml` |
| BDD              | postgres+redis services → migrate → seed → **`test:seed` (11-scenario seed-provisioning check)** → build & boot API from `dist` → 64 Cucumber scenarios; `ENV_NAME` deliberately unset to exercise the production storage-dir boot guard | `bdd.yml`   |

- `images.yml` (push to main): Buildx → GHCR `{api,web,admin}` with `latest` + `sha-*` tags, GHA layer cache. `smoke-staging.yml` (manual): `/health` + `@smoke` Cucumber subset against a deployed URL.
- ⚠️ **Gaps** (→ D7): the API's 23 spec files are **never run in CI**; `apps/control-plane` is neither typechecked nor built (lint-only); web/admin `tsc` is only implicit via `next build`. (**PR #127** adds `Test (api)` + `Next build (control-plane)` — add both to the `protect-main` ruleset after it merges.)

### 2.6 Environment variables

Three tiers — this distinction has bitten before (a build-time `NEXT_PUBLIC_SITE_NAME` shipped "LMS" to every instance):

| Tier            | Rule                                                                                                                                                                                                                          | Examples                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `RUNTIME_*`     | Per-instance, read at **request time**, served to the browser via `app/env.js/route.ts` → `window.__ENV__`; SSR reads `process.env.RUNTIME_*` directly. Precedence everywhere: `RUNTIME_* \|\| NEXT_PUBLIC_* \|\| localhost`. | `RUNTIME_API_URL`, `RUNTIME_WEB_URL`            |
| `NEXT_PUBLIC_*` | **Build-time-baked** into the bundle. Only for values identical across the whole fleet or genuinely build-time (base path). Never for anything per-instance.                                                                  | `NEXT_PUBLIC_ADMIN_BASE_PATH`                   |
| Server-only     | SCREAMING_SNAKE, no prefix; API side reads env at the call site. `API_URL_INTERNAL` is the SSR-over-compose-network base.                                                                                                     | `JWT_SECRET`, `SETTINGS_ENC_KEY`, `CORS_ORIGIN` |

- ✅ Fail-closed helpers: `apps/api/src/common/env.util.ts` — unset `ENV_NAME` counts as production; `jwtSecret()` refuses the dev fallback in production.
- ✅ `.env.example` documents every var's production behavior inline. Seed/`RUNTIME_*` vars live in `deploy/instance/` instead.
- ⚠️ The API reads config two ways — `ConfigService` (20 files, only 4 keys) vs bare `process.env` (32 files, 76 reads), sometimes both in one file (`auth.service.ts`). **Standard going forward: `process.env` via small typed helpers in `env.util.ts`**; don't introduce new `ConfigService` reads. `isProduction()` is the only way to test environment (it's re-inlined in `health.controller.ts` and `instrument.ts` — fix on touch).

---

## 3. Backend standards (`apps/api`)

- ✅ **Module layout:** one flat feature directory per domain (34 modules, 45 controllers, 50 services). Admin surfaces mount at `@Controller("admin/<thing>")`; member/public surfaces bare. Global infra modules (`prisma`, `queue`, `control-plane`) are `@Global()` and grouped in `app.module.ts`.
- ✅ **Validation:** class-validator DTOs exclusively, in `dto/` subdirs; global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`. All 111 `@Body()` params are DTO classes — never `any`.
- ✅ **Response shaping:** hand-written private `toXDTO()` methods on services, returning shapes typed against `@lms/types`. **Secret masking:** never emit secret plaintext — omit the value and surface ids (`secretFieldIds[]`, `lists.service.ts:113`); cleartext only via an audited reveal endpoint. (`maskSecret()` in `crypto.util.ts` is dead code — don't copy it.)
- ✅ **AuthZ:** `PermissionsGuard` + `@RequirePermission(section, action)` is _the_ admin pattern (106 sites); `SUPER_ADMIN` short-circuits; roles come from Prisma's `AdminRole` enum. Members use `JwtAuthGuard`; server-to-server uses `ServiceTokenGuard` (`timingSafeEqual`). ⚠️ `AdminGuard` (6 legacy sites) duplicates `PermissionsGuard`'s base behavior — use `PermissionsGuard` for all new admin routes; migrate the 6 on touch. ⚠️ Import `AdminRole` from `@prisma/client` (majority form), not `@lms/types`.
- ✅ **Data access:** inject `PrismaService`; call model delegates (`this.prisma.user.…`, 679 sites). `$transaction` for multi-write invariants (22 sites). Raw SQL requires justification — exactly one site exists (health check `SELECT 1`). Note the delegate getters in `prisma.service.ts` are hand-maintained — **add the getter when you add a model**.
- ✅ **Errors:** throw Nest `HttpException` subclasses from services (329 sites; `NotFoundException` 151, `BadRequestException` 104…). No custom exception filters; Sentry's global filter only. ⚠️ Messages are ad-hoc English literals with no error codes (the one precedent: `{ code: "OUTSIDE_WINDOW" }` in `live.service.ts`) — → D6.
- ✅ **Uploads/static:** multer; static mounts are `immutable, 365d, nosniff`; access-controlled files (cert PDFs, lesson notes) stream through guarded routes, never static. ⚠️ Four near-duplicate upload configs re-declare MIME maps and size caps (`blog/`, `pages/`, `lms/`, `media/upload.config.ts`) — → D2 consolidates the constants; `MediaStorage` (`media.storage.ts`) is the abstraction to extend if storage ever moves off local disk.
- ✅ **Jobs/webhooks:** `@nestjs/schedule` crons (3 jobs); payment webhooks with per-route raw-body parsing and `@SkipThrottle()`; inbound cross-plane calls are `ServiceTokenGuard` + `202` fire-and-forget; outbound notifier never throws. `AuditService.write()` is best-effort by design (an audit failure must never fail the mutation).
- ✅ **Throttling:** `GlobalThrottlerGuard` (1000/60s, rightmost `X-Forwarded-For`) + per-route `@Throttle` for auth-sensitive endpoints, limits env-tunable (`THROTTLE_*_LIMIT`).
- ✅ **Testing:** `node:test` + `node:assert/strict`, colocated `*.spec.ts`, flat sentence-named `test()` calls, hand-rolled literal mocks via constructor injection (no mocking library, no `@nestjs/testing`). Coverage deliberately skews to security and destructive-op invariants. ⚠️ Not wired into CI — → D7.

---

## 4. Web frontend standards (`apps/web`, `apps/admin`)

### 4.1 App Router usage

- ✅ App Router only, plain segment folders (no route groups). Per-section `layout.tsx` exists for metadata/robots, not for chrome.
- ✅ **Web:** public/SEO routes are true server components (blog, class pages, verify, root layout's parallel fetches); member-gated pages are `"use client"` + fetch-on-mount (34 of 90 files client). **Admin:** effectively a client-side SPA in Next clothing (66 of 76 files client; 3 server components). This split is accepted — admin has no SEO surface. New admin pages follow the client pattern; new public web pages must be server components.
- ✅ No server actions, no API proxy routes — talk to the NestJS API directly via the app's `lib/api.ts`.

### 4.2 Data fetching & API client

- ✅ One hand-rolled typed wrapper per app exporting a single `api` object: `apps/web/lib/api.ts` (679 lines; supports Next Data-Cache `revalidate`, refuses to cache token-bearing requests), `apps/admin/lib/api.ts` (1,260 lines; `no-store` + global 401→logout).
- ⚠️ The two wrappers have **different `request()` signatures** and each re-declares `ApiError`; web has no global 401 handling. Three separate module-level `cached`+`inflight` request-dedupe singletons exist in admin (`app-brand.ts`, `FormPickerField`, `MenuPickerField`). All of this is exactly the job of a server-state library — → D4 (TanStack Query) and D5 (shared `ApiError`/fetch core).

### 4.3 State management (today)

- ✅ Context for cross-cutting concerns only — web: `ToastProvider`; admin: `ToastProvider > AdminAuthProvider (me/permissions/can()) > DialogProvider (promise-based confirm/notify/prompt)`. Everything else is local `useState`.
- ⚠️ Scale check: admin holds 637 `useState` / 168 `useEffect`; `projects/page.tsx` is 2,246 lines, `QueueTable.tsx` 2,041. Server cache, request dedupe, and optimistic flows are all hand-rolled per page. → D4.
- ⚠️ `useOptimisticAction` exists twice with the same name and **incompatible APIs** (web's drops overlapping calls; admin's queues + toasts with Retry) — and a third shape on mobile. → D4 replaces all three with TanStack mutations.

### 4.4 Forms, modals, toasts

- ✅ Forms: controlled `useState` per field, `<form onSubmit>` + `preventDefault`, one `busy` flag, one `error` string, native HTML validation attributes; the API is the source-of-truth validator and `ApiError.message` is surfaced. No form/validation library — acceptable at current form complexity; revisit only if a form needs cross-field validation.
- ✅ **Modal contract** (post-#106/#107): `.modal-overlay[role=dialog][aria-modal] > .modal` with `.modal-header/.modal-close/.modal-body/.modal-actions`; **form/editor modals must not close on backdrop click or Escape** — dismiss is ×/Cancel/Save only. Transient popovers (row menus, pickers, notification panel) remain outside-dismissable by design.
- ✅ **Keyboard/AT wiring (PR #129):** `useModalA11y` (in `apps/{admin,web}/lib`, one copy each pending the P2 `packages/ui` extraction) is attached at every overlay: focus moves in on open, Tab/Shift-Tab is trapped, escaped focus is pulled back (never from a dialog stacked later), and the opener regains focus on close. Web's modals (account ×2, `AvatarCropper`, checkout `LoginModal`) joined the contract in the same PR — their backdrop/Escape closes are gone. **Escape decision (recorded here):** form modals stay Escape-proof — with the trap in place, Tab always reaches ×/Cancel, so keyboard dismissal exists without Escape's risk of discarding a half-filled form; dialogs with nothing to lose take Escape (DialogProvider `confirm`/`notify`, `prompt` while its input is pristine, web's cancel-membership confirm). New modals must use the hook and this policy.
- ✅ Toasts: provider-based queue with SR live region pre-mounted; admin's flavor adds action buttons (Retry). ⚠️ Two near-identical implementations (`web/components/Toast.tsx` vs `admin/components/ToastProvider.tsx` — the diff is comments) + duplicated CSS. → D5.
- ✅ Destructive confirms go through `DialogProvider.confirm()` (42 admin sites) — never `window.confirm` (one raw usage left in `coupons/page.tsx`; fix on touch).

### 4.5 Styling system

**What it is:** a hand-authored design system, not a utility framework. Two global stylesheets (`apps/web/app/globals.css` 6,302 lines; `apps/admin/app/globals.css` 4,801) define CSS-custom-property tokens on `:root` (Spark theme: ink chrome ramp, cream surfaces, teal accent, status colors, radius/shadow/easing scales, class-accent slots) plus feature-prefixed semantic classes (`ik-*` 184 selectors, `co-*` 66, `pj-*` 211, `nav-*` 70…), organized under banner comments. Components combine a structural class with occasional inline `style` for dynamic values. Measured ratio: **~84% className / 16% inline** (web), ~79/21 (admin). Single appearance: `:root` and `[data-theme="light"]` carry identical values by design.

Class-accent theming is the one dynamic mechanism: `.class-c0…c5` remap `--cls/--cls-base/--cls-dark/--cls-text`, slot chosen by keyword regex (color-named slots — they dress whatever a client's catalog sells).

✅ **Rules that ARE the standard:**

1. Every color comes from a token (`var(--…)`); spacing/radius/shadows from the scales.
2. Static styling → a prefixed class in `globals.css` under the feature's banner; inline `style={{}}` **only** for values computed at runtime (positions, percentages, user-content colors).
3. New feature = new short prefix + banner section; don't reuse another feature's classes.
4. Buttons: admin's `.btn`/`.btn--modifier` family is the canonical convention (web's `.btn-primary` single-dash family is legacy — align on touch).

⚠️ **Known drift (fix opportunistically; D3 finishes the job):**

- Web and admin name the **same hex values differently** (web `--lav-bg/--lav-text` + color-named accents vs admin semantic `--bg/--text/--surface` + domain-named accents); admin's semantic vocabulary is the keeper.
- 108 raw hex literals inline in TSX (35 web / 73 admin), including 8 uses of retired `#8b8a87` that now sit **below AA contrast** (admin moved `--muted` to `#74726c`); `puck-theme.css` re-hardcodes the palette instead of `var()` refs.
- Web's `--violet-*`/`--pink-*` token names hold teal values post-rebrand (names lie; values correct).
- Dead theming plumbing: `ThemeToggle.tsx` + `data-theme` scripts ship in both apps but both themes are identical — remove or wire up, don't extend.

### 4.6 Accessibility baseline

- ✅ Global `:focus-visible` outline, `prefers-reduced-motion` blocks, decent `aria-label`/`aria-hidden`/`aria-busy` coverage, `role=dialog/status/alert` on the right things, SR live regions for toasts.
- ⚠️ Thin on relationships (`aria-describedby`/`labelledby`: ~0) and focus management (no trap/restore — see 4.4). The shared Modal primitive (D5) is where this gets fixed once.

---

## 5. Mobile standards (`apps/mobile`)

- ✅ **Stack:** Expo SDK 56 dev-client, RN 0.85, React 19, react-navigation v7 (typed param lists in `src/navigation.ts`, module nav ref, deep links resolved against the live instance URL). Flat `src/` with `screens/` + `components/`; named exports; import order react → react-native → third-party → `@lms/types` → local.
- ✅ **Server state = TanStack Query v5** (`src/query.tsx`): one client per mount, two-tier `STALE` constants, 4xx-no-retry policy, `AppState`→`focusManager` bridge, prefix-stable query keys in a single `qk` object (`src/queries.ts`). **Cache isolation is a hard invariant:** instance switch remounts everything via `InstanceGate` (fresh client), member switch clears the cache **during render** in `QueryAuthReset` — deliberately not an effect, so a new session can never read the old user's cache. Don't "optimize" either.
- ✅ **API client:** single private `request<T>()` + one exported `api` object; `API_BASE_URL` is a documented live-binding mutated on connect; tokens in SecureStore, per-instance-scoped keys, epoch counter invalidates caches on rebind; 401 → registered sign-out callback.
- ✅ **Styling:** `makeStyles(theme)` factory + `useStyles`/`useScopedStyles` (32 factories; static `StyleSheet.create` only in the 5 theme-independent files). Theme derives ~24 tokens from the instance's 8 admin-configurable colors with real WCAG contrast math (`paletteFrom`, `darkenUntilAA` in `src/theme.ts`). Fonts: Plus Jakarta Sans with **per-weight `fontFamily(weight)`** — RN does not cascade or synthesize weights; never rely on `fontWeight` alone.
- ✅ **Responsive:** everything goes through `src/responsive.ts` (`useContentLayout`, `isWide`, width-driven not device-class-driven — iPad Split View safe; tablet orientation unlock gated at ≥600dp).
- ✅ **Errors:** no `Alert.alert`; screens render the shared `<ErrorState message onRetry>` with calm per-context copy, or inline error text.
- ⚠️ **Drift to burn down:**
  - **Two data-fetching architectures**: 7 screens on TanStack hooks vs 9+ on hand-rolled `load()` + `[data, loading, error]` triples — two loading languages (Skeleton vs spinner), two retry stories. Migrate manual screens to `queries.ts` hooks as touched. **Zero `useMutation` exists** — mutations are ad-hoc `optimistic()` + manual cache write-back (`LessonScreen` holds the same lesson in local state _and_ the query cache). → D4.
  - 29 hardcoded `"#ffffff"` (token `colors.heroText` exists), 41 raw `rgba()`, 164 raw spacing literals vs 296 `spacing.*` (the 4-step scale is too coarse — D3 extends it), and `PopupHost.tsx` ships an unrelated slate palette ignoring instance branding.
  - 81 redundant `fontWeight`s alongside correct `fontFamily`; stale header comment in `optimistic.ts` ("app has no data-fetching library"); `KeyboardAvoidingView` boilerplate copy-pasted in 4 screens instead of living in `Screen.tsx`.
- ✅ **Testing:** `node:test` on pure modules (format/theme/token-store — each guards a real shipped regression), run as a dedicated CI job. UI is untested; keep extracting logic into pure modules to make it testable.

---

## 6. Data layer standards (`packages/db`)

- ✅ **Schema** (63 models, 41 enums): PascalCase models, camelCase fields, no `@map` (DB names mirror code); ids `cuid()`; `createdAt @default(now())` everywhere, `updatedAt @updatedAt` only where rows mutate; **`onDelete` always explicit** (Cascade 36 / SetNull 13); named relations only for disambiguation; index generously (58 `@@index`, 11 `@@unique`).
- ✅ **Migrations:** forward-only chain, 66 dirs, `<timestamp>_snake_case_verb_noun`. Real drop/backfill migrations are normal. **Never `prisma migrate reset`** against any shared DB; `SEED_WIPE=1` is the only sanctioned wipe (content tables + upload dirs).
- ✅ **Seed = a second create path** and is treated as production code: env-mode matrix (`SEED_ADMIN_*`, `SEED_DEMO_CONTENT`, `SEED_DEMO_ONCE`, `SEED_DEMO_VIDEO_URL`), one-shot marker via `SeedState` singleton, media copied through `seedUploadedMedia()`. **Any seed change must keep `npm run -w @lms/db test:seed` green** — an 11-scenario provisioning check that runs against a throwaway DB in CI and encodes real past incidents ("restart must not clobber a password change", "real client boots empty", "deleted-class resurrection").
- ✅ Client export: 6-line CommonJS singleton (`global.__lmsPrisma` in dev to survive hot reload). Consumers import runtime from `@lms/db` and _types_ from `@prisma/client`.

---

## 7. Shared packages

- ✅ **`@lms/types` is the contract.** Add/change any API response shape here first; api `toXDTO()` methods and all three clients compile against it. One 2,771-line `index.ts` organized in banner sections; 297 exports incl. value constants (`ADMIN_SECTIONS` with labels — precedent for D1). Don't redeclare a shared type locally (the one existing collision, `MediaKind`, is a bug to fix).
- ✅ **`@lms/puck`** wraps `@puckeditor/core` 0.21.3 with one `createPuckConfig` used by admin's `<Puck>` editor, web's server `<Render>`, and API-side stored-document validation. Blocks must stay server-renderable; client-only edit fields are injected via config options. Stylesheet order: core `puck.css` → `@lms/puck/styles.css` → app `puck-theme.css`.
- ✅ **`packages/bdd`** is the API-level acceptance suite (13 features / 64 scenarios, TS step defs, real SMTP catcher; `@smoke` subset safe against prod). New user-visible API behavior should land with a scenario.

---

## 8. Testing & quality practices

| Runner                  | Where                         | What                                                                                                | In CI?                                |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `node:test` + ts-node   | `apps/api` (23 spec files)    | security/destructive-op invariants, crypto, guards, storage pins                                    | ⚠️ **No**                             |
| `node:test`             | `apps/mobile` (3)             | pure-module regression guards                                                                       | ✅ dedicated job                      |
| Cucumber.js             | `packages/bdd` (64 scenarios) | end-to-end API behavior vs built artifact                                                           | ✅                                    |
| seed-provisioning-check | `packages/db` (11 scenarios)  | every seed/boot mode incl. incident regressions                                                     | ✅                                    |
| `deploy-pins.spec.ts`   | `apps/api`                    | **cross-file contract test**: every declared storage dir stays pinned in compose/Dockerfile/scripts | ⚠️ only via the api suite → not in CI |

- ✅ House style: no mocking framework — constructor-inject literal fakes; flat `test()` calls with sentence names; specs colocated; tests encode _incidents_ (the best specs cite the regression they guard).
- ✅ The contract-test pattern (`deploy-pins.spec.ts`: parse the other file, assert the invariant, self-extend from the source-of-truth table) is the sanctioned way to keep "must move together" files honest — use it for future cross-file invariants (e.g. the accent map, until D2 removes the copies).
- ⚠️ Zero tests in web, admin, control-plane, types, puck. Don't block on this; D4/D5 make the frontends testable by extracting shared logic first.

---

## 9. Drift register (consolidated, ranked)

**High — correctness/user-facing risk:**

| #   | Problem                                                                                                                                                                                                                                                       | Evidence                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| H1  | API's 23 spec files never run in CI (incl. the storage-pin contract test) — **PR #127** adds the `Test (api)` job                                                                                                                                             | no workflow invokes `-w @lms/api test`                                                      |
| H2  | `apps/api` non-strict (`noImplicitAny: false`) — largest workspace, weakest compiler — **resolved in P5** (full `strict`, 4 fixes)                                                                                                                            | `apps/api/tsconfig.json`                                                                    |
| H3  | ~2,000 hardcoded user-facing strings; top-15 literals repeated ~230×; same messages drift in wording/punctuation across apps and vs API — **PR #126** ships the `STR` catalog, a ~590-site migration, and the warn-level lint ratchet                         | §10 D1 census                                                                               |
| H4  | Accent map ×3 verbatim copies (each self-documenting "three copies, no shared package") + a 4th palette copy in demo-art — **consolidated in PR #126** (`packages/types/class-accents.ts`; the three files are now re-export shims)                           | `web/lib/memberData.ts:94`, `admin/lib/class-accent.ts:12`, `mobile/src/class-colors.ts:38` |
| H5  | Optimistic-UI implemented 3 incompatible ways; web's drops overlapping actions; nothing tested — **resolved in P4-2**: web + mobile helpers deleted (useMutation), admin's re-chartered as the narrow dynamic-key realtime primitive (D4)                     | two `useOptimisticAction.ts` + `mobile/src/optimistic.ts`                                   |
| H6  | Modal a11y: no focus trap/restore anywhere + Escape removed → keyboard users can't dismiss; web modals never migrated to the no-accidental-close contract — **fixed in PR #129** (`useModalA11y` at all 20 sites; Escape policy in §4.4)                      | `web/components/checkout/LoginModal.tsx`, web `AvatarCropper.tsx`                           |
| H7  | Password min-length tiers (member 10 / admin 8 / reset 12 — intentional per owner) are re-hardcoded by every client instead of imported — **named as `PASSWORD_MIN` in PR #126**, which also fixed checkout's stray client floor of 8 (below the server's 10) | `api/src/admins/dto/admins.dto.ts:16` vs `auth/dto/signup.dto.ts:17`                        |
| H8  | 8 inline uses of retired `#8b8a87` render below AA contrast since the admin token moved — **fixed in P3** (hex sweep → `var(--muted)`; the `[data-theme]` re-pin that had been overriding the token fix is also gone)                                         | admin TSX inline styles                                                                     |

**Medium — duplication/maintainability:**

| #   | Problem                                                                                                                                                                                                                                                                                                        | Evidence                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| M1  | Two token vocabularies for identical hexes (web `--lav-*`/color-named vs admin semantic); puck-theme re-hardcodes palette — **P3**: one shared core (`@lms/ui/tokens.css`) + web semantic aliases; puck-theme stays all-literal BY DESIGN (style-synced into the canvas iframe where tokens.css doesn't exist) | both `globals.css`, `admin/app/puck-theme.css` |
| M2  | 108 raw hexes in web/admin TSX; mobile: 29 `#ffffff`, 41 raw `rgba()`, slate palette in `PopupHost` — **P3**: web/admin swept to `var()` + warn ratchet; mobile color pass deferred to P3b (visual verification needed)                                                                                        | census                                         |
| M3  | Two fetch wrappers with different signatures; `ApiError` ×2 (+ mobile's third); web lacks 401 handling; 3 ad-hoc request caches in admin — **P2**: one `createRequest` core + one `ApiError`; per-app signatures kept as thin wrappers; web-401 + dedupe caches wait for D4                                    | `web/lib/api.ts:152` vs `admin/lib/api.ts:180` |
| M4  | Toast system ×2 (diff = comments); croppers ×3; `AuthGate`/`AuthGuard` divergent UX — **P2**: toast merged, cropper mechanism single-sourced (`useImageCropper`); AuthGate deferred                                                                                                                            | components dirs                                |
| M5  | Currency formatter ×13 files, `formatBytes` ×5, date-format block ×6, `MIME_TO_EXT` ×5, upload configs ×4 — **P2**: formatters canonical in `packages/types/format.ts`, exact-semantic sites migrated                                                                                                          | census                                         |
| M6  | API error surface: 329 throws, ad-hoc English, 1 machine-readable code — **P5**: `ErrorCode` union + `HttpExceptionFilter` (every body carries a code, `UNSPECIFIED` for legacy), auth converted, clients parse `ApiError.code`; the rest convert opportunistically                                            | `live.service.ts` is the lone precedent        |
| M7  | Env read two ways in API; `isProduction()` re-inlined twice                                                                                                                                                                                                                                                    | §2.6                                           |
| M8  | `AdminGuard` (6 sites) duplicates `PermissionsGuard`; `AdminRole` imported from 2 sources                                                                                                                                                                                                                      | §3                                             |
| M9  | Mobile: two fetch architectures; zero `useMutation`; `LessonScreen` dual source of truth — **resolved in P4-2c** (one hook per endpoint; three useMutations; the query cache is the single owner of `completed`)                                                                                               | §5                                             |
| M10 | control-plane: no typecheck/build in CI (**PR #127** adds the build job); Dockerfiles' manifest-copy layer missing `packages/puck` + `apps/control-plane` (**fixed in this PR**)                                                                                                                               | `build.yml`, all three Dockerfiles             |
| M11 | 4 TS compiler versions in tree; floating `^` where CI pins matter — **resolved in P5** (exact pins everywhere)                                                                                                                                                                                                 | §2.1                                           |

**Low — cosmetic/naming (fix on touch):** variant-controller naming (dot vs dash); `lib/` casing mix; `src/auth/dto` file granularity; mobile's one default export; `[error, setError]` vs `[errorMsg, …]`; dead `ThemeToggle`; `ScheduleModule.forRoot()` living in `email.module.ts`; stale docs (`deploy/STAGING.md` says "PLAN" but is live; `LIVE-SESSIONS-PLAN.md` historical; README's tree omits control-plane/puck/bdd; `render.yaml` legacy); root `docker-compose.yml` lacks a "dev-only" banner; three ignore files (`.gitignore`/`.dockerignore`/`.prettierignore`) answer differently for `.claude/` and `graphify-out/`.

---

## 10. Standardization decisions

### D1 — Shared strings catalog 🎯 (the "Close" problem)

> **Status: shipped as PR #126** — `STR` in `packages/types/strings.ts`, ~590 call sites migrated across the four client apps, warn-level lint ratchet in place. The long tail migrates via the ratchet + PR review.

**Verdict: adopt.** The census found ~2,000 distinct user-facing strings, all inline. A catalog of ~60 entries covers ~600 call sites (~30%): `Loading…` ×79, `Cancel` ×45, permission-denied sentence ×28, `Close` ×26, `Delete` ×26, the 42 `confirm()` prompts (11 near-identical `Delete <entity> "<name>"?` shapes, three spellings of "cannot be undone"), and 334 `setError("…")` sites drawing on ~10 recurring error sentences.

**Where:** `packages/types/strings.ts` + `constants.ts`, re-exported from `index.ts`. Rationale: all four apps already consume `@lms/types` (zero new wiring — a new package means touching 5 tsconfigs, 3 next.configs, and the already-drifted Dockerfile manifest lists), and the package already exports user-facing labels (`ADMIN_SECTIONS`). Promote to a standalone `packages/strings` later if i18n arrives — a mechanical move.

**Shape** (namespaced, `as const`, template functions for interpolation):

```ts
export const STR = {
  common: {
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    delete: "Delete",
    edit: "Edit",
    remove: "Remove",
    retry: "Try again",
    loading: "Loading…",
    active: "Active",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    permissionDenied: "You don’t have permission to view this.",
    network: "Network error. Check your connection and try again.",
    imageUnreadable: "That image couldn’t be read. Try another file.",
  },
  validation: {
    passwordMin: (n: number) => `Password must be at least ${n} characters.`,
  },
  confirm: {
    deleteEntity: (kind: string, name?: string) =>
      `Delete ${kind}${name ? ` “${name}”` : ""}? This can’t be undone.`,
    removeEntity: (thing: string) => `Remove ${thing}?`,
  },
} as const;
```

**Rules:** the catalog is the single place punctuation/casing is decided (curly apostrophes, real `…` — the census found straight-vs-curly drift in the _same sentence_). Any string used in ≥2 places, any destructive confirm, and any error sentence **must** come from `STR`. One-off body copy may stay inline. English only for now; the catalog keys are the future i18n extraction seam.

**Enforcement:** ESLint `no-restricted-syntax` entries generated from the catalog's top literals (e.g. `JSXText[value=/^\s*Close\s*$/]` → "use STR.common.close") — start as `warn`, ratchet to `error` per app once migrated.

### D2 — Shared constants 🎯

> **Status: core shipped in PR #126** — `PASSWORD_MIN` (tiers named; every DTO + client check imports them), accent map consolidated, `SEARCH_DEBOUNCE_MS`, shared upload caps, safe-image MIME map. The shared formatters (`formatMoney`/`formatBytes`/`formatDateLong`) landed with P2 in `packages/types/format.ts`.

Same home (`packages/types/constants.ts`). First residents, all currently multiply-declared:

- `ACCENT_KEYWORDS` + `CLASS_ACCENTS` + `classAccentIndex()` — **deletes the three self-confessed copies** (H4); the demo-art generator keeps a pointer comment or imports it.
- `PASSWORD_MIN = { member: 10, admin: 8, instanceAdminReset: 12 }` — tiering **confirmed intentional by the owner (2026-08-14)**; clients import the constant and stop re-hardcoding numbers into copy (pairs with `STR.validation.passwordMin`).
- `MIME_TO_EXT` (×5 today), upload caps (`MAX_IMAGE_BYTES` 5MB, `AVATAR_MAX_BYTES` 8MB — each currently named once and inlined twice), default page sizes, debounce ms.
- Shared formatters move next to it (or into `packages/ui`, D5): `formatMoney` (×13), `formatBytes` (×5), `fmtDate` (×6) — locale `undefined` (user's locale), never hardcoded `"en-US"`/`"en-CA"`.

### D3 — Styling: codify the token system; do not adopt Tailwind 🎯

> **Status: core shipped (P3).** `@lms/ui/tokens.css` is the single color source (values verified byte-identical before extraction — a resolver diff proved the refactor value-preserving); web adopted the canonical semantic vocabulary via aliases; the TSX hex sweep landed with a warn-level lint ratchet; the dead `ThemeToggle`/`data-theme` plumbing is gone (removing it surfaced that admin's `[data-theme]` re-pin block had been silently overriding the `:root` AA corrections at runtime). A cross-file contract test (`apps/api/src/common/design-tokens.spec.ts`, deploy-pins mold) now asserts every token resolves (no cycles/danglers), no `[data-theme]` blocks return, and the CSS accent slots stay in step with `CLASS_ACCENTS`. **Deliberate rendering changes, all AA corrections**: web/admin muted+faint text, teal/success/warning text tones (web inherited the values admin had already chosen).
>
> **P3b (deferred, needs design eyes / visual verification):** mobile color sweep (29 `#ffffff` vs `heroText`, 41 raw `rgba()`, PopupHost's off-brand slate palette — fixing it finally themes popups per instance), web↔TS blue/sea gradient-triplet reconciliation, the off-palette `#4f46e5`/`#101828` leftovers, chart `MIX_COLORS`, the off-scale 12/20 mobile spacing steps, and web/admin `--bg`/`--border-strong` value unification (currently deliberately per-app).

**Verdict: keep and tighten what exists.** The repo already has a real design system: ~11,000 lines of authored CSS encoding the Spark identity as CSS-variable tokens + feature-prefixed classes, with a healthy ~84/16 class-to-inline ratio. Adopting Tailwind would mean rewriting ~2,900 `className` sites for zero user-visible gain, and it cannot express the runtime class-accent slots or mobile's WCAG-derived instance theming any better than variables do. The _actual_ problems are token drift and raw values — fixable in place:

1. **One token vocabulary.** Adopt admin's semantic names (`--bg --surface --surface-2 --border --text --text-soft --muted --accent` + status set) as canonical across web/admin/puck-theme; keep legacy names as aliases during migration; generate both apps' `:root` blocks from a single `packages/theme/tokens` source so values can never diverge again. Mobile keeps deriving from `AppConfig` but its _default_ palette imports the same source (`theme.ts` already documents the sync requirement with api + seed).
2. **No raw color values** in TSX or new CSS — `var(--token)` on web/admin, `theme.colors.*` on mobile. CI grep gate: fail on new `#hex`/`rgb(` in `.tsx` (allowlist file for the genuine exceptions). Kills M2/H8 permanently.
3. **Inline `style={{}}` only for runtime-computed values.** Static styling goes in the feature's banner section in `globals.css`.
4. Extend mobile's spacing scale (`xs/sm/md/lg` → add `xl`, and the missing 12/20/32 steps) so the 164 raw spacing literals have somewhere to go.
5. Remove the dead `ThemeToggle`/`data-theme` plumbing (or ship a real second theme; don't keep the zombie).

**Tailwind stays evaluated-not-adopted.** Revisit trigger: a greenfield surface or team growth where utility-class DX beats the rewrite cost — and if adopted, its config must map classes onto the shared CSS variables, never literal colors.

### D4 — State management: TanStack Query everywhere for server state; Context for app state; Zustand not yet 🎯

> **Status: P4-1 + P4-2a shipped.** Foundation (PR #134): providers mirroring mobile's config; admin's three dedupe singletons gone; blog/coupons + web's dashboard/classes/certificates/payments/account reads on `useQuery`; **web's first global 401 handling**. P4-2a: web's `useOptimisticAction` **deleted** (both sites on scope-serialized `useMutation`); admin's seven non-realtime optimistic sites converted with exact toast+Retry/rollback parity (`lib/mutations.ts` glue). **P4-2b/c (final wave): D4 is COMPLETE.** Mobile's manual screens migrated to `queries.ts` hooks and its `optimistic.ts` helper is gone (its three sites on `useMutation`). On the realtime projects board the plan CHANGED after recon, deliberately: the four remaining hook sites are all **dynamic-entity-key** writes (`message:<id>` reactions/edit/delete, `list-item:<id>` cell saves) with reachable same-key overlap — the exact shape v5 mutation scopes cannot express (per-instance scope ids; per-row instances would break the unmount boundary). Rather than re-implementing the serializer inline, admin's `useOptimisticAction` is **re-chartered as the sanctioned narrow primitive** for that niche (its header carries the full argument; do not add consumers outside the shape). The board's reads likewise stay socket-fed local state on purpose — on a realtime surface the socket stream is the freshness authority, and a parallel query cache would be a second one. Everything else across web/admin/mobile: TanStack.
>
> ⚠️ **v5 trap (verified against query-core 5.101.4, worth its own line):** `onMutate` runs at `mutate()` time, BEFORE the scope-queue pause — a scope-queued mutation's `onMutate` snapshot captures mid-flight state. Where same-scope overlap is genuinely reachable, put the snapshot+paint inside `mutationFn` (which does run at queue-turn) with a context "snapshot box", plus a per-key ticket for newest-waiter supersede (see `apps/admin/app/navigation/page.tsx`). Where the UI makes overlap unreachable (control disabled while pending), plain `onMutate` snapshotting is fine — say so in a comment. Per-row entity scopes need per-row hook instances (scope ids are fixed per instance); prefer a page-level mutation + row-busy guards where rows unmount mid-flight.

**Server state (the real pain): adopt TanStack Query v5 on web and admin** — it is already the mobile standard, so this converges the whole repo on one library the codebase knows. It directly replaces the hand-rolled per-page `[data, loading, error]` triples, admin's three `cached+inflight` dedupe singletons, web's missing 401 story (via a shared `queryClient` error handler), and **all three divergent `useOptimisticAction` implementations** (use `useMutation` + `onMutate` snapshot/rollback — same contract the comments already describe, finally enforced by one implementation). Adoption order: new pages immediately; then admin's heaviest surfaces (`projects/page.tsx`, `QueueTable`); mobile's 9 manual screens migrate to `queries.ts` hooks and mutations move to `useMutation` (today there are zero).

**App/client state: React Context stays** for the existing cross-cutting singletons (auth, toast, dialog, config/theme). The audit found almost no genuine global client state beyond them (`mobile-nav.ts`'s 20-line store is fine).

**Zustand: not adopted now — with a defined trigger.** Nothing in the codebase currently needs a global client store; adding one would be architecture-by-fashion. Adopt Zustand (over Redux) the day a feature needs complex client state shared across distant components without server round-trips — the Projects board is the likeliest first candidate if it grows collaborative client-side interactions. Module-level mutable stores are otherwise banned in new code (the documented singletons in §5 are grandfathered).

### D5 — `packages/ui`: extract the copy-pasted components 🎯

> **Status: shipped (P2).** `@lms/ui` now holds `useModalA11y` (single source; the per-app copies from #129 are re-export shims), the merged toast provider, the `createRequest()` fetch core behind both apps' `lib/api.ts`, and `useImageCropper` — the pan/zoom/crop mechanism all three croppers triplicated (each cropper file is now thin per-app markup over it; markup unification waits for P3's token merge). `ApiError` and the shared formatters live in `@lms/types` so mobile shares them too. Still open from the charter: `AuthGate`/`AuthGuard` unification (app-coupled, deferred) and a `<Modal>` markup component (the contract is already enforced by the hook; extract when a new modal needs it).

New workspace consumed like `@lms/puck` (raw TSX + `transpilePackages`). Charter members, in order of value:

1. **`<Modal>`** — encodes the no-accidental-close contract, adds the missing focus trap/restore + `aria` wiring once, and brings web's two non-compliant modals into line by adoption (closes H6).
2. **Toast provider** (merge the two; keep admin's action-button API).
3. **`ApiError` + `createApiClient()`** core (one request implementation, per-app config: base URL resolution, auth header, 401 behavior) — the TanStack `queryFn`s (D4) call through it.
4. **Cropper** (collapse the three).
5. `AuthGate` (standardize on skeleton-fallback UX), shared format helpers (D2).

Adding the package is also the moment to fix the Dockerfile manifest-copy drift (M10) since the list must be touched anyway.

### D6 — API error codes 🎯

> **Status: shipped (P5).** `ErrorCode` union in `packages/types/error-codes.ts` (small and semantic — a code earns its place when a client genuinely branches on it); `ApiError` carries `code` (default `UNSPECIFIED`), parsed by both shared request cores; the API's one custom exception filter (`http-exception.filter.ts`) stamps every error body additively — Nest's default fields untouched, `code` added, legacy string throws normalized to `UNSPECIFIED`, so there is exactly one response shape with no migration deadline. Auth's throws are converted (`INVALID_CREDENTIALS`, `EMAIL_EXISTS`, `USERNAME_TAKEN`, `INVALID_INVITE_CODE`, `CURRENT_PASSWORD_INCORRECT`, `PASSWORD_UNCHANGED`, `RESET_LINK_INVALID`), joining live's pre-existing `OUTSIDE_WINDOW`; mobile signup demonstrates the client side (code-first branch, status fallback). Billing and the remaining ~290 throws convert opportunistically — the doc rule: **a new throw that a client will branch on ships with a code**.

Extend the one existing precedent (`{ code: "OUTSIDE_WINDOW" }`) into the standard error shape: `throw new BadRequestException({ code: ErrorCode.X, message })`, with the `ErrorCode` union living in `@lms/types` and clients mapping `code → STR.errors.*` instead of parroting server prose (kills the API↔client message drift in H3/H7). Rollout: new endpoints + auth/billing first; a thin exception filter can normalize legacy string-only errors into `{ code: "UNSPECIFIED", message }` so clients handle one shape.

### D7 — Enforcement & CI hardening 🎯

> **Status: COMPLETE (P5 closes it).** CI gates (#127) · Dockerfile manifests + dead code (#125) · string ratchet (#126) · hex ratchet (#133) · **api full `strict`** — not just `noImplicitAny`; 4 fixes total (P5) · **type-aware lint on `packages/db`** — zero violations found; `seed-provisioning-check.ts` now inside the tsconfig/CI gate (P5) · **TS versions pinned exactly** in every workspace (P5). Outstanding owner action from #127 still stands: add `Test (api)` + `Next build (control-plane)` to the `protect-main` ruleset.

- Add the missing gates: `Test (api)` job running the 23 specs (this also puts the storage-pin contract test in CI — closes H1); `TypeCheck (control-plane)` + its `next build`.
- Ratchet `apps/api` strictness: flip `noImplicitAny: true` first (smallest blast radius), then full `strict` module-by-module; new files must be strict-clean now.
- Extend type-aware lint to `packages/db` (seed.ts's floating promises are unguarded).
- Pin TypeScript versions that CI depends on; regenerate the Dockerfile manifest lists.
- Add the D1 string lint + D3 hex grep as `warn`, ratchet per app after migration.
- **PR definition-of-done** (enforced in review): strings from `STR`; colors from tokens; server data via TanStack (new pages); destructive confirms via `DialogProvider` + `STR.confirm`; new API routes use `PermissionsGuard` + DTO validation + (new) error codes; schema changes keep `test:seed` green; user-visible API behavior lands with a BDD scenario.

---

## 11. Adoption roadmap

| Phase                                     | Work                                                                                                                                                                                                              | Size                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **P0 — same-day wins**                    | CI: api-test + control-plane typecheck/build jobs; fix Dockerfile manifests; delete dead `maskSecret()`; banner-comment root compose as dev-only                                                                  | ~½ day                |
| **P1 — strings & constants**              | `STR` + `constants.ts` in `@lms/types`; migrate the top ~60 strings (~600 sites, mostly mechanical), the 42 confirm prompts, accent-map consolidation (H4), `PASSWORD_MIN` decision; add the lint ratchet as warn | 2–3 days              |
| **P2 — packages/ui**                      | `<Modal>` (focus trap + web compliance), merged Toast, shared `ApiError`/client core, cropper collapse                                                                                                            | 2–3 days              |
| **P3 — tokens**                           | Single token source; adopt semantic names in web; hex sweep incl. the 8 AA-contrast regressions; mobile spacing scale + `#ffffff`→token sweep; retire dead theme toggle                                           | 2 days                |
| **P4 — TanStack on web/admin**            | Provider + client wiring, then per-page migration starting with admin's heaviest lists; replace the three optimistic implementations with `useMutation`                                                           | incremental, per-page |
| **P5 — API error codes + strict ratchet** | `ErrorCode` union + filter normalization; `noImplicitAny` flip                                                                                                                                                    | incremental           |

Each phase is an independent PR (or small stack) with no fleet-deploy coupling except P1's accent consolidation (pure refactor, same rendered output — verify via screenshots on demo).

---

_Related docs: `PLAN.md` (product architecture & locked decisions) · `deploy/VPS-GUIDEBOOK.md` (fleet ops) · `docs/react-19-upgrade-checklist.md` (deferred upgrade) · `deploy/instance/README.md` (per-instance provisioning)._
