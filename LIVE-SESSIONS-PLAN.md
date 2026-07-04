# Live Sessions — implementation plan (hardened)

Admin-scheduled Zoom / Google Meet calls, surfaced to entitled members as a
countdown "live" bar on the dashboard that opens a gated join page. Produced from
a full codebase audit + a design panel (MVP / security-first / product-first) →
synthesis → adversarial red-team (security, data-model, product) → this hardened
final. Branch: `feat/live-sessions` (off `upgrade/expo-sdk-56`).

## 1. Key decisions

- **Targeting:** a `LiveAudience` enum — `LEVELS` (targets specific Classes = `Level`s via a `LiveSessionTarget` join) or `ALL_ACTIVE` (any member with ≥1 ACTIVE `UserLevel`). Default `LEVELS`, which fails closed.
- **"Class" == `Level`.** A member is entitled when `AccessService.activeLevelIds(userId)` (status = ACTIVE) intersects the session's targets — the exact gate that already unlocks courses/lessons.
- **Credential storage:** join URL + passcode as AES-256-GCM ciphertext (`crypto.util.encryptSecret` / `SETTINGS_ENC_KEY`), same at-rest boundary as Stripe keys. Admin read paths never decrypt (expose `hasJoinUrl` / `hasPassword` booleans); a dedicated `GET /admin/live-sessions/:id/reveal` (edit perm) decrypts for test-join.
- **Two-tier credential release** (the security spine): the dashboard bar (`GET /live/current`) and join shell (`GET /live/:id`) DTOs carry no url/passcode fields, so they can't leak. Credentials come only from `GET /live/:id/credentials`, gated by entitlement + join window `[startsAt − joinLeadMin, endsAt)` + `status = SCHEDULED`, and every release writes a `LiveJoinAudit` row.
- **State/timer:** server is authoritative. `endsAt` is a stored column (= `startsAt + durationMin`) so the "current" query is a pure indexed range on `@@index([status, endsAt])`. Responses include `serverNow`; the client computes a one-time clock offset and ticks every second — no polling, no cron in phase 1. The client clock can never unlock credentials; only the server window check releases them.
- **Timezone:** admin sends naive `startsAtLocal` + IANA `timezone`; the server converts to UTC via `common/wallclock.util.ts` (extracted from the campaign scheduler's DST-correct Intl logic). Never `new Date(local).toISOString()` on the client — it ignores the chosen zone.
- **RBAC:** new admin permission section `liveSessions` in `ADMIN_SECTIONS`; admin routes guarded by `PermissionsGuard` + `@RequirePermission('liveSessions', …)`. Credentials route throttled per-user by a custom `LiveThrottlerGuard` (`getTracker` → `req.user.sub`).

## 2. Data model (`packages/db/prisma/schema.prisma`) — DONE (phase 1)

Enums `LiveProvider` / `LiveAudience` / `LiveSessionStatus`; models `LiveSession`,
`LiveSessionTarget`, `LiveJoinAudit`; back-relations on `Level`
(`liveSessionTargets`) and `Admin` (`liveSessions`). `@@index([status, endsAt])`
for the current-session query. Apply with:

```
cd packages/db && npx prisma migrate dev --name add_live_sessions
```

(Held until you confirm — it applies to the shared dev DB.)

## 3. Shared types (`packages/types/index.ts`)

- `LiveSessionBarDTO` (bar/shell — no url/passcode; `startsAt/endsAt/joinsAt`, `serverNow`, `isLive`, `canJoinNow`, `audienceLabel`, `status`).
- `LiveCurrentDTO = LiveSessionBarDTO[]` (array, cap 3).
- `LiveJoinCredentialsDTO` (returned only by the credentials endpoint: `joinUrl`, `password`).
- `AdminLiveSessionDTO` (booleans `hasJoinUrl` / `hasPassword`, `audienceLabel`, `targetsEmpty`, times) + `AdminLiveRevealDTO`.
- `LiveSessionInput` (takes `startsAtLocal` + `timezone`, not a pre-converted instant).
- Add `{ key: "liveSessions", label: "Live Sessions" }` to `ADMIN_SECTIONS`.

## 4. API (`apps/api/src/live/`)

New module: `live.module.ts`, `live.service.ts`, `live.controller.ts`,
`live.admin.controller.ts`, `live.throttler.guard.ts`,
`dto/live-session.input.ts`. Extend `lms/access.service.ts` with
`canAccessLiveSessionWith(activeSet, { audience, levelIds })` — DONE (phase 1).
Time conversion via `common/wallclock.util.ts` — DONE (phase 1).

Member (`JwtAuthGuard`):

| Method | Path | Returns / gate |
|---|---|---|
| GET | `/live/current` | `LiveSessionBarDTO[]` (cap 3); entitlement; 200 `[]` if none |
| GET | `/live/:id` | shell; not-entitled 403, DRAFT/unknown 404, CANCELED 410 (entitled) |
| GET | `/live/:id/credentials` | decrypted creds; entitlement + window + `SCHEDULED`; throttled; writes `LiveJoinAudit` |

Admin (`PermissionsGuard` + `@RequirePermission('liveSessions', …)`): `GET
/admin/live-sessions` (read), `GET /:id` (read), `GET /:id/reveal` (edit), `POST`
(create), `PATCH /:id` (edit), `POST /:id/publish` (edit; validates URL present +
non-empty targets + `endsAt > now`), `DELETE /:id` (delete; soft → CANCELED). DTO
validated with class-validator (https-only + provider-host allow-list
`*.zoom.us` / `meet.google.com`, re-checked on decrypt). Wrap `encryptSecret` to
return 503 (not 500) if `SETTINGS_ENC_KEY` is unset. Register `LiveModule` in
`app.module.ts`.

## 5. Admin (`apps/admin`)

`app/live-sessions/page.tsx` cloning the Forms list↔edit state machine, guarded
by `can('liveSessions', …)`. Fields: title, description, provider segmented
`Zoom | Google Meet` (Meet hides the passcode field; Zoom shows it and detects an
embedded `pwd=`), meeting URL (write-only with "Test link" via `/reveal`),
audience radio (all-active vs specific-classes multi-select, with a "visible to
~N members" confirm on all-active), schedule (`datetime-local` sent as
`startsAtLocal` + IANA `timezone` select), duration, join-lead. Save as DRAFT;
Publish flips to SCHEDULED after server validation. Add `lib/api.ts` methods and
a Sidebar nav item gated by `can('liveSessions','read')`.

## 6. Member web (`apps/web`)

`components/LiveSessionBar.tsx` mounted in the empty top-right region of
`.md-head` on `app/dashboard/page.tsx`, using `.glass--strong` + `.md-*` tokens.
Fetches `api.liveCurrent()` alongside the existing dashboard fetches; computes a
one-time clock offset from `serverNow`; re-derives upcoming / join-window / live
states each second (with one refetch when a card crosses a boundary, to catch
cancels); renders up to 3 stacked; nothing if empty. New
`app/live/[id]/page.tsx` (client, `AuthGate`, `useParams`) clones the lesson-page
state machine plus a 410-canceled state, shows a countdown before the window,
fetches credentials only in-window, shows the destination host before
`window.open(url, '_blank', 'noopener,noreferrer')`, and shows a copyable
passcode only for Zoom. Add `liveCurrent` / `liveSession` / `liveCredentials` to
`lib/api.ts` and matching CSS in `app/globals.css`.

## 7. Security guarantees

No credential field exists on the bar/shell types; credentials only from the
per-id endpoint gated on that specific session (no "is-logged-in" shortcut) +
window + status; IDOR closed. AES-256-GCM at rest; only `/reveal` (edit) and the
entitled+in-window member path decrypt. Status oracle avoided (DRAFT/unknown →
404 for all; CANCELED → 410 only for entitled). Per-user throttle + audit
tripwire. Revoking a `UserLevel` blocks the next credentials fetch; in-session
revocation relies on provider waiting rooms (surfaced as admin guidance).

## 8. Phased build & acceptance

1. **Data + entitlement** — schema/migration, `canAccessLiveSessionWith`, wall-clock util. ✅ **DONE** on this branch (schema valid; 10 unit tests pass). Migration held pending confirmation.
2. **Admin API + page** — ✅ **DONE** on this branch (API type-checks clean; admin type-checks clean; 19 unit tests pass incl. the provider-host allow-list). Files: `apps/api/src/live/*` (service/admin-controller/module/dto/util), `PrismaService` getters, `app.module` registration, `liveSessions` in `ADMIN_SECTIONS`, `apps/admin/app/live-sessions/page.tsx`, admin `lib/api.ts` methods, Sidebar nav. CRUD + `/reveal` + publish validation (past/empty-target/host) + missing-key 503 are implemented. **Runtime behavior pending the Phase 1 migration** (tables don't exist until it runs).
3. **Member API** — ✅ **DONE**. `/live/current` (array, cap 3), `/live/:id` (403/404/410), `/live/:id/credentials` (window + audit + `LiveThrottlerGuard` per-member). Verified by a real-DB integration run (16/16 assertions: entitlement, no-credential-leak on bar/shell, window gate, decrypt round-trip, one audit row per release, immediate revocation) and a live HTTP call through the running server.
4. **Member web** — ✅ **DONE**. `components/LiveSessionBar.tsx` (server-clock-offset countdown, live/upcoming states, boundary refetch), `app/live/[id]/page.tsx` (locked/404/410/countdown/join states, host shown before `window.open`, Zoom-only passcode), dashboard integration, `globals.css`. Type-checks clean; runs on the worktree stack (ports 3300/3302).

**Deferred / out of scope** (each pre-wired): reminder emails (`reminderSentAt`
column + reuse the `ScheduledEmail` `@Cron` drain) and a client-only `.ics`
button; `/live` history + `recordingUrl`; recurrence; mobile parity (`apps/mobile`
DashboardScreen — additive, no API change); provider APIs / auto-created meetings.

## 9. Test plan

Unit: entitlement predicate (LEVELS intersect / empty / ALL_ACTIVE), wall-clock →
UTC across zones + DST — ✅ done. Integration: full gating matrix, exactly-one
audit row per release, per-user throttle, revocation, 503 on missing key, admin
write-only + `/reveal` RBAC, publish rejections. E2E: admin creates a Zoom
session → entitled member sees the bar with class name + countdown → button
enables at `joinsAt` → opens new tab (host shown) → Meet hides passcode →
ends/cancels correctly; a clock-skew test confirms the countdown tracks the
server.
