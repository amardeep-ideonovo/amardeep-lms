# Per-Client Mobile Apps — Scope

Status: **scoping** (no implementation yet). Verified against the code on
`upgrade/expo-sdk-56`, 2026-07-01.

We sell the LMS as a multi-client B2B SaaS where **1 license = 1 full LMS
instance + mobile apps**. Each client already gets an isolated instance (own
DB + API subdomain) via the control plane. This doc scopes how the mobile app
becomes part of that per-client offering — the largest open gap.

**Bottom line up front:** in-app branding is already done and good; per-build
icon/splash is already automated. The near-term unlock is a **shared app with
runtime instance-selection (Option A, size M)**, dominated by a greenfield
control-plane "org directory," not by mobile code. True per-client white-label
(Options B/C) is **size L and an ongoing operational cost** — sell it as a
priced premium, not bundled by default.

---

## 1. Current state — baked vs runtime

Web/admin were re-architected for one-image-many-instances (runtime API-origin
via `apps/web/app/env.js/route.ts`). Mobile was **intentionally left out** (see
`deploy/instance/README.md`) because store binaries are immutable and their
identity/signing is fixed by Apple/Google at build+submit — mobile can't copy
the web pattern wholesale.

### Baked at build time (immutable without a rebuild + store resubmit)

| Thing | Where | Current value | Why it's per-client |
|---|---|---|---|
| App display name | `apps/mobile/app.json` | `"LMS"` | Home-screen label |
| Slug | `app.json` | `lms-mobile` | Ties to the EAS project |
| iOS bundle id | `app.json` | `com.lms.mobile` | Immutable store identity — 1 per listing |
| Android package | `app.json` | `com.lms.mobile` | Same |
| Deep-link scheme | `app.json` | `lms` | `lms://` collides if two client apps on one device (`App.tsx` `ExpoLinking.createURL`) |
| EAS projectId / owner | `app.json` | `0f8efe5e-…` / `amardeeplms` | One build/credential namespace |
| Icon / adaptive / splash images | `app.json` | placeholders | Store + home icon (**but see the sync hook below**) |
| Splash / adaptive **bg color** | `app.json` | `#100c1b` | Padding behind splash — NOT from config |
| **Which instance the app talks to** | `src/config.ts` | `EXPO_PUBLIC_API_URL` (Expo inlines at build) | The single biggest blocker |
| Web account/billing URL | `src/config.ts` | `EXPO_PUBLIC_WEB_ACCOUNT_URL` → `WEB_BASE_URL` (deep-link prefix) | Per-instance |
| Fonts | `theme.ts` / `App.tsx` | Montserrat + Playfair | Shared across all clients (not brandable) |

Config is a static `app.json` — there is **no `app.config.js/ts`**; every
identity field is a literal.

### Runtime-configurable — ALREADY DONE (do not rebuild)

In-app look is served live from each instance via **`GET /app/config`** (public,
unauthenticated — `apps/api/src/site/public-app-config.controller.ts`; singleton
DB row, sanitized/default-merged in `app-config.service.ts`; `AppConfig` type at
`packages/types/index.ts`):

- `title`, `tagline`, `description`, `logoUrl`, `colorScheme`, full `light`/`dark`
  8-color palettes → `paletteFrom()` (`theme.ts`) derives ~20 tokens, restyling
  every surface.
- Client flow (`apps/mobile/src/config-provider.tsx`): cache-first paint from
  SecureStore, first-paint gate capped at 4000ms, background refetch, foreground
  refetch + 30s poll (an admin Save re-themes open apps within one tick), offline
  fallback to cache / `DEFAULT_APP_CONFIG`.
- **Pre-login is fully branded** — `ConfigProvider` wraps above the auth gate, so
  the logged-out login screen already shows the client's logo/name/tagline/colors.
- Operator controls it in `apps/admin/app/app-customization/AppCustomizationBuilder.tsx`
  (`PUT /admin/app/config`) with a live phone preview.

**~90% of "looks like the client's app" is already solved, per-instance, for
free.** Typography and store identity are the exceptions.

### The clever bridge already built (icon/splash)

`iconUrl`/`splashUrl` in `AppConfig` are "reference only — not applied at
runtime," BUT `apps/mobile/scripts/sync-brand-assets.js` (wired as
`eas-build-pre-install` in `apps/mobile/package.json`) fetches
`${EXPO_PUBLIC_API_URL}/app/config` **on the EAS builder** and overwrites
`assets/icon.png` + `adaptive-icon.png` + `splash.png` before install (API
unreachable → keep checked-in files; URL set but not a valid PNG → fail the
build). So **per-client icon/splash are already automated at the per-build
level** — they follow whatever instance `EXPO_PUBLIC_API_URL` points at. This is
the most important "already done" piece for the white-label path.

---

## 2. The core options

### Option A — one SHARED app with runtime instance-selection
One binary, one App Store / Play listing under **your** account. On first run the
user picks/enters their org; the app resolves it to the client's API URL via a
new control-plane org directory, persists it, and points all requests there;
`/app/config` themes it per the selected instance.

- **Client gets:** their branding *inside* the app; a **shared store listing**
  (store name/icon/developer-of-record are yours). Not a true white-label.
- **Engineering:** runtime API-base + first-run org picker (mobile) + a new
  control-plane org-lookup endpoint (does not exist — no org/tenant model
  anywhere today).
- **Per-client ops:** ~zero (no new build/submit per client).
- **Store policy risk:** Low (one legitimate multi-tenant app — Slack/Canvas
  pattern).
- **Maintenance:** Lowest — 1 iOS + 1 Android build per release, total.

### Option B — per-client WHITE-LABEL apps
One codebase → N branded binaries, each its own store listing/icon/name/bundle
id, published (ideally) under the client's own store accounts.

- **Client gets:** a true white-label app — their identity in the store. Premium,
  sellable.
- **Engineering:** `app.json → app.config.ts` from a per-client manifest;
  per-client EAS project + env + parameterized submit creds. Icon/splash already
  handled by the sync hook.
- **Per-client ops:** high — per client: Apple app record, Play app +
  service-account, signing assets, EAS project, store listing, 2 builds + 2
  reviews per release.
- **Store policy risk:** High under your account; Low under client accounts (§3).
- **Maintenance:** Highest and recurring — every Expo SDK / OS deadline =
  2×N builds + N×2 reviews (see `apps/mobile/SHIPPING.md` for the 51→56 pain).

### Option C — hybrid (A now, B as premium later)
Ship A to unblock the first paying clients; offer B as a priced "your own app in
the store" upsell for clients who use their own store accounts. A's pieces
(org directory + runtime API-base) are exactly what B needs, so A is not
throwaway — it's B's foundation.

---

## 3. The two hard problems

### (i) Baked `EXPO_PUBLIC_API_URL` — how mobile targets an instance
`src/config.ts` reads `process.env.EXPO_PUBLIC_API_URL`, inlined into the bundle
at build. There is no mobile analog to web's `/env.js`. Two closes:
- **Per-client build (B):** set `EXPO_PUBLIC_API_URL` per EAS build → API URL,
  icon, and splash all follow that instance (sync hook already does this). No new
  server code, but 1 build per client.
- **Runtime selection (A/C):** make `API_BASE_URL` runtime — first-run tenant
  resolver (org code / subdomain / deep link) → resolve via a new control-plane
  org-lookup → persist in SecureStore → all requests use it; derive `WEB_BASE_URL`
  from the resolved value too. **Validate** the resolved API (hit `/app/config`
  or a new `/app/whoami`) before persisting; fall back to the picker on failure.

### (ii) Apple white-label review risk (Option B only)
Many near-identical binaries differing only by colors/logo/API URL, submitted
from **one** developer account, is the classic App Store "spam" pattern
(historically Guideline 4.3(a), reinforced by 4.2.6 "commercialized
template / app-generation" — **re-verify exact numbering against live Apple docs
before any customer commitment**; Apple renumbers). First one or two may pass;
the account gets flagged as the pattern accumulates.
- **Load-bearing mitigation — publish under each client's own accounts
  (Model A).** The client owns Apple ($99/yr) + Play ($25) and is
  developer-of-record; you operate the build/submit pipeline *into* their account
  (their Team ID / ASC API key + Play service-account). Apple's sanctioned
  white-label path; the only model that scales past a handful.
- **Secondary:** maximize genuine per-client distinctness (real content,
  screenshots, descriptions) — but account ownership is the real mitigation.
- EAS Update (OTA) pushes JS-only fixes without review but does **not** help the
  expensive SDK/native-upgrade case — don't count on it for the maintenance
  multiplier.

---

## 4. Recommendation

**Adopt Option C, starting with A.**
1. In-app branding is already done and good, so the shared app delivers most of
   the perceived "their app" value on day one with near-zero per-client ops and
   no store-policy exposure.
2. A per-client-build fleet is an operational business (N store accounts, N
   reviews per SDK cycle), not a feature — don't take it on to land the *first*
   paying client.
3. A's new pieces (control-plane org directory + runtime API-base) are exactly
   what B reuses, so A is B's foundation.

### Phased plan
- **Phase 0 — Decide (no code).** §6.
- **Phase 1 — Ship the shared app (A).** Runtime API-base + first-run org
  resolver + control-plane org-lookup + provisioner registration + one store
  listing under your account. Unblocks the first paying client.
- **Phase 2 — White-label foundation (B).** `app.json → app.config.ts` from a
  per-client manifest; per-client EAS project + env; parameterized submit; reuse
  the sync hook for icon/splash; provisioner writes instances into the directory.
- **Phase 3 — White-label as premium.** Per-client store-onboarding runbook
  (Model A), control-plane "kick an EAS build for client X" orchestration, fleet
  build/submit dashboards, ongoing credential handling. Priced to cover the
  maintenance multiplier.

---

## 5. Implementation checklist — near-term (Phase 1, Option A)

**Mobile (`apps/mobile/`):**
- `src/config.ts` — replace the `EXPO_PUBLIC_API_URL` constant with a mutable
  runtime resolver: read persisted tenant API URL from SecureStore; expose
  `getApiBaseUrl()` / `setApiBaseUrl()`; derive `WEB_ACCOUNT_URL` / `WEB_BASE_URL`
  from it. Keep `EXPO_PUBLIC_API_URL` as a dev/default fallback only.
- `src/api.ts` — use the runtime getter instead of the constant (every request +
  `appConfig()`).
- `App.tsx` — deep-link `prefixes` must read the resolved `WEB_BASE_URL` at
  runtime, not a build constant.
- New `src/screens/TenantPickerScreen.tsx` — first-run org entry (code /
  subdomain / paste-link); validate against the control plane; on success persist
  and enter the normal `ConfigProvider` flow. Gate it above `ConfigProvider` in
  `App.tsx`.
- Optional deep-link onboarding: an org-invite URL that pre-fills the tenant.
- **Leave untouched** (already correct): `config-provider.tsx`,
  `theme-provider.tsx`, `theme.ts`, `AppCustomizationBuilder.tsx`,
  `public-app-config.controller.ts`.

**Control plane (new — does not exist today):**
- Org-directory service + store, cross-instance (not in any isolated instance
  DB): `org slug/code → { apiUrl, webAccountUrl, orgName, status }`; public read
  `GET /orgs/{slug}`.
- Provisioner hook: when an instance is provisioned, register its public API URL
  into the directory.
- Optional `/app/whoami` on the instance API (returns org name/slug) so the app
  can confirm which org it's bound to.

**Store:** one App Store Connect + one Play listing under your account; fill the
real `eas.json` `submit` block (currently `REPLACE_` placeholders) once.

**Deferred to Phase 2:** `app.config.ts` reading
`EXPO_PUBLIC_APP_NAME`/`APP_SCHEME`/`BUNDLE_ID`/`EAS_PROJECT_ID`/splash-bg;
per-client EAS projects + env/secrets; parameterized submit creds; control-plane
EAS build orchestration.

---

## 6. Decisions the user must make
1. **Shared-brand vs white-label at launch** — recommend **shared (A)** first.
2. **Whose store accounts for white-label** — recommend **Model A (client-owned)**
   to survive Apple review. Confirm willingness to operate builds into clients'
   accounts (collect their ASC API key + Play service-account).
3. **Platforms first** — iOS + Android together, or Android-first (cheaper/faster,
   $25 one-time vs $99/yr) to de-risk?
4. **Tenant-resolution UX** for the shared app — org code, subdomain,
   login-email→org, or deep-link invite?
5. **White-label pricing** — is the per-client maintenance multiplier (N builds ×
   2 platforms × every SDK/OS cycle) priced into the premium tier?
6. **Where the org directory lives** — extend the `licensing-dashboard` control
   plane, or a new service?

---

## 7. Effort estimate

| Phase | Scope | Size |
|---|---|---|
| 0 — Decide | Product/policy, no code | XS |
| 1 — Shared app (A) | Runtime API-base + org picker (mobile) + control-plane org-lookup + provisioner registration + 1 store listing | **M** (bulk is the greenfield org directory) |
| 2 — White-label foundation (B) | `app.config.ts` + per-client EAS project/env + parameterized submit + provisioner→directory | **M–L** |
| 3 — White-label as premium | Store-onboarding runbook + EAS build orchestration + fleet dashboards + Model-A credential handling | **L** (a build/submit ops function, not a one-off) |

Honest bottom line: in-app branding is done; icon/splash-per-build is done. The
near-term unlock (Phase 1) is **M**. True per-client white-label (Phases 2–3) is
**L** and an ongoing operational cost — price it as a premium, don't bundle it
into the base license by default.

---

### Key files (all verified)
`apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/src/config.ts`,
`apps/mobile/src/config-provider.tsx`, `apps/mobile/src/api.ts`,
`apps/mobile/App.tsx`, `apps/mobile/scripts/sync-brand-assets.js` +
`apps/mobile/package.json`, `apps/mobile/SHIPPING.md`,
`apps/admin/app/app-customization/AppCustomizationBuilder.tsx`,
`apps/api/src/site/public-app-config.controller.ts`,
`apps/api/src/site/app-config.service.ts`, `apps/web/app/env.js/route.ts`,
`packages/types/index.ts` (AppConfig), `packages/db/prisma/schema.prisma`
(AppConfig singleton), `deploy/instance/README.md`.
