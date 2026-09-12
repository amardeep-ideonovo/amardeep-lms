# Push Notifications — P0 Implementation Spec

**Status:** proposed · **Scope:** P0 (foundation + 3 transactional sends) · **Audience:** engineering
**Companion audit:** [full 31-type catalog](https://claude.ai/code/artifact/0198fce9-e2dd-4d82-939a-39d7c6195414)
**Terminology:** Class = Prisma `Level` ⊃ Course (via `CourseLevel`) ⊃ Lesson. Member = `model User` (JWT `sub` = `User.id`).

---

## 1. What P0 delivers

The entire send pipeline (data model → token registration → Expo transport → deep-link tap routing → one store build), plus the **three lowest-risk, highest-value 1:1 transactional pushes** that ride emit-sites already firing an email today:

| #   | Notification                         | Emit-site (exists today)                                                     | Deep-link              | Audience                   |
| --- | ------------------------------------ | ---------------------------------------------------------------------------- | ---------------------- | -------------------------- |
| 1   | **Support reply from a human**       | `helpdesk.service.ts:658` `notifyMember` block                               | `help/:conversationId` | the one conversation owner |
| 2   | **Payment failed / renewal at risk** | `billing.service.ts:230` `firePaymentFailedAutomation`                       | `account/payments`     | the affected member        |
| 3   | **Membership activated / welcome**   | `billing.service.ts:180` `fireSubscriptionAutomation('SUBSCRIPTION_ACTIVE')` | `account`              | the newly-entitled member  |

All three are **transactional** (no marketing consent needed) and **1:1** (no fan-out), so P0 needs no audience resolver, digest, or consent-preference center — those land in P1+.

**Explicitly out of P0** (deferred — see the audit): member notification inbox, per-category preference center, quiet hours, digest/frequency-cap, `PushLog`-backed admin observability, per-academy admin category switch, content fan-out (new class/course/lesson), live, engagement, marketing. P0 ships a single master on/off, nothing more.

---

## 2. Architecture decision — a dedicated `PushService`, called per-site

**Do NOT hang push off `AutomationService.fire()`.** Three findings from the code make per-site dispatch the correct choice:

1. `fire()`'s context (`AutomationFireContext`, `automation.service.ts:19-30`) carries `{ email, vars, eventKey }` but **no `userId`** — device tokens key on `User.id`, so a dispatcher inside `fire()` would have to re-resolve the user by email.
2. `fire()` only acts when an **`Automation` row is `active`** for the trigger. `ensureSystemAutomations()` (`automation.service.ts:308`) seeds only `SIGNUP` + `PAYMENT_FAILED` — **`SUBSCRIPTION_ACTIVE` has no seeded row**, so a `fire()`-coupled push would silently never fire for send #3.
3. **helpdesk-reply never calls `fire()`** at all — it sends via `EmailService.sendTemplate` directly (`helpdesk.service.ts:691`), so `fire()` would cover only 2 of 3 anyway.

**Design:** a new `PushService.dispatch(...)` (best-effort, never throws) injected into `BillingService` and `HelpdeskService`, invoked at each of the three emit-sites _alongside_ the existing email call, **inside the existing try/catch** (the webhook-never-500 contract). Each site already has `user.id` (or `conv.userId`) in scope.

```
PushService.dispatch(input: {
  userId: string;
  category: "helpdesk-reply" | "payment-failed" | "subscription-active";
  title: string;
  body: string;
  href: string;            // deep-link path, e.g. "help/<id>" — becomes data.href
  dedupeKey: string;       // reuses each site's existing idempotency key
}): Promise<void>          // MUST swallow all errors
```

---

## 3. Data model (`packages/db/prisma/schema.prisma`)

### 3.1 New models + `User` columns

Add beside `emailOptOut` (line 33) and to the `User` relation block (lines 45-48):

```prisma
model User {
  // ... existing fields ...
  emailOptOut  Boolean @default(false)
  pushOptOut   Boolean @default(false) // master push suppress; mirrors emailOptOut
  // ... existing relations ...
  deviceTokens DeviceToken[]
}

// One row per (member, device). Registered by the mobile app on login;
// pruned when Expo reports DeviceNotRegistered.
model DeviceToken {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expoPushToken String   @unique // ExponentPushToken[...] minted by the Expo build
  platform      String            // "ios" | "android"
  appVersion    String?
  disabled      Boolean  @default(false) // set true on DeviceNotRegistered
  createdAt     DateTime @default(now())
  lastSeenAt    DateTime @updatedAt

  @@index([userId])
}

// Idempotency ledger for push (separate table from ScheduledEmail so the
// shared dedupeKey namespaces do not collide with @unique on email rows).
model PushLog {
  id        String   @id @default(cuid())
  userId    String
  category  String
  dedupeKey String   @unique
  sentAt    DateTime @default(now())

  @@index([userId])
}
```

**Notes**

- `pushOptOut` and every new column carry `@default(...)` — `docker-compose.instance.yml:83` runs `prisma migrate deploy` on every API container boot, and a NOT-NULL column without a default would fail on existing rows.
- `onDelete: Cascade` mirrors `HelpdeskConversation` (`schema.prisma:1643`); a member's tokens vanish when the account is deleted.
- No `instanceId` — each academy is its own DB, so the DB _is_ the tenant boundary.
- P0 uses **token-presence + `pushOptOut`** as the whole consent model. `NotificationPref` (per-category) is deferred to P1.

### 3.2 Migration

```bash
npm run migrate --workspace @lms/db -- --name add_push_device_tokens
npm run generate --workspace @lms/db
```

- `npm run migrate` = `prisma migrate dev` (dev only). **Never** `prisma migrate reset` (destroys fleet data).
- `npm run generate` (= `prisma generate`) is mandatory before `apps/api` `tsc` — the client types won't include `DeviceToken`/`PushLog` otherwise.
- Prod applies automatically via `prisma migrate deploy` on container start.

---

## 4. Server (`apps/api`)

### 4.1 Transport

Add `expo-server-sdk` to `apps/api`. Use the Expo Push Service (it abstracts APNs + FCM v1, batches 100/request, returns tickets/receipts). New operator-level env var:

```
EXPO_ACCESS_TOKEN=   # operator secret, NOT per-academy AppConfig
```

### 4.2 `PushService` (`apps/api/src/push/push.service.ts`, new)

Responsibilities, all **best-effort**:

1. **`register(userId, dto)`** — upsert `DeviceToken` by `expoPushToken` (reassign `userId` if the device changed hands; refresh `lastSeenAt`).
2. **`unregister(userId, expoPushToken)`** — delete the row (idempotent; a missing row is a no-op).
3. **`dispatch(input)`** — the contract in §2:
   - return early if `user.pushOptOut` is true;
   - **idempotency:** `try { await prisma.pushLog.create({ data: { userId, category, dedupeKey } }) } catch (P2002) { return }` — a duplicate `dedupeKey` means already sent;
   - load `DeviceToken` where `{ userId, disabled: false }`; if none, return;
   - build `ExpoPushMessage[]` → `to: token`, `title`, `body`, `data: { href }`, `sound: null`, `priority: "high"`;
   - `chunkPushNotifications` → `sendPushNotificationsAsync`;
   - on a per-ticket `DeviceNotRegistered` error, set that token's `disabled = true`;
   - **wrap the entire method in try/catch that only logs** — a bad token must never bubble into a webhook or the helpdesk reply flow.
4. **`stripSteering(body)`** — a content-safety helper applied to the `payment-failed` category: assert/strip any URL and any currency/price token before send (see §7). For P0 the copy is already compliant, but the guard is the choke point that keeps it that way.

Server push **title** uses `(await appConfig.read()).title` (`app-config.service.ts`) — the same `brand`/`cfg.title` the three send-sites already resolve. Do **not** use the mobile `pickBrandTitle`/`boundName` resolver (client-only; there is no connect-code name server-side). `cfg.title` falls back to `"Spotlight Academy"`, consistent with the existing emails.

### 4.3 `push.controller.ts` (`apps/api/src/push/`, new) — member routes

Copy the shape from `account.controller.ts:20-47` / `helpdesk.controller.ts:60`:

```ts
import {
  Controller,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";
import { RegisterDeviceTokenDto } from "./dto/register-device-token.dto";
import { PushService } from "./push.service";

@Controller("push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("register")
  @HttpCode(200)
  register(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.push.register(p.sub, dto); // p.sub === User.id
  }

  @UseGuards(JwtAuthGuard)
  @Delete("register")
  @HttpCode(204)
  unregister(
    @CurrentUser() p: AuthenticatedPrincipal,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.push.unregister(p.sub, dto.token);
  }
}
```

DTO (class-validator, enforced by the global `ValidationPipe`):

```ts
export class RegisterDeviceTokenDto {
  @IsString() @MinLength(1) token!: string; // ExponentPushToken[...]
  @IsIn(["ios", "android"]) platform!: string;
}
```

**Auth facts (verified):**

- Member id is **`principal.sub`** (a string = `User.id`) — there is **no `.id`** on the principal.
- Guard is **`JwtAuthGuard`** (`auth/guards/jwt-auth.guard.ts`) — the same guard members and admins share; **not** `PermissionsGuard`/`AdminGuard`.
- **No CSRF work needed:** the global `CsrfGuard` short-circuits on `Authorization: Bearer` (`csrf.guard.ts:59`), and mobile is bearer-only. Do **not** add `@SkipCsrf()`.
- **Preview members are auto-blocked:** the global `PreviewReadOnlyGuard` 403s any non-GET from an `isPreview` session — a previewing admin correctly cannot register a token. No code needed.
- `JwtStrategy.validate` re-loads the `User` every request and 401s if deleted / `tokenVersion` stale, so `DeviceToken.userId` never dangles for an authenticated caller.

### 4.4 `push.module.ts` + registration

```ts
@Module({
  controllers: [PushController],
  providers: [PushService, AppConfigService],
})
export class PushModule {}
```

`PrismaService` is `@Global`; a module using `@UseGuards(JwtAuthGuard)` needs **no** `AuthModule` import (see `AccountModule`). Register `PushModule` in the `imports` array of `apps/api/src/app.module.ts` (next to `AccountModule`) — that is the only wiring step; routes auto-mount.

### 4.5 The three emit-site hooks

Inject `PushService` into `BillingService` (constructor at `billing.service.ts`) and `HelpdeskService` (`helpdesk.service.ts:91-97`).

**① helpdesk-reply** — `helpdesk.service.ts:658`, inside the existing `if (notifyMember)` block, beside `void this.emailMemberAboutReply(...)`:

```ts
void this.push.dispatch({
  userId: conv.userId, // in scope; HelpdeskConversation.userId
  category: "helpdesk-reply",
  title: cfg.title, // academy brand
  body: `New reply to "${conv.subject}"`, // + optional 240-char preview
  href: `help/${id}`, // id === conversationId
  dedupeKey: `push:helpdesk-reply:${id}:${conv.messageCount + 1}`,
});
```

Gate is the existing `notifyMember = !internal && !conv.unreadForMember` (line 614) → one push per unread burst. **Extend the `conv.user` select** at `helpdesk.service.ts` to include `id` if you dispatch from `emailMemberAboutReply` instead of the `notifyMember` block (the block already has `conv.userId`).

**② payment-failed dunning** — `billing.service.ts:230-243`, inside `firePaymentFailedAutomation` (already try/catch-wrapped), beside the `automations.fire("PAYMENT_FAILED", ...)` call:

```ts
void this.push.dispatch({
  userId: user.id, // param, in scope
  category: "payment-failed",
  title: cfg.title,
  body: graceEndsAt
    ? `We couldn't process your payment for ${planLabel}. Your access continues until ${graceText}.`
    : `We couldn't process your payment for ${planLabel}.`,
  href: "account/payments",
  dedupeKey: `push:payfail:${externalSubId}:${graceEndsAt ? graceEndsAt.getTime() : "nogr"}`,
});
```

Reuses the existing per-episode `eventKey`. The call-site gate `enteredDunning` (`billing.service.ts:1490`) already scopes it once per dunning episode, provider-neutral (Stripe + PayPal both funnel through `applySubscriptionState`).
**Compliance:** copy is date-only. No price. No "update on the web". No `WEB_ACCOUNT_URL`. Run it through `stripSteering()`.

**③ subscription-active** — `billing.service.ts:180-183`, inside `fireSubscriptionAutomation`, guarded to `trigger === "SUBSCRIPTION_ACTIVE"`:

```ts
if (trigger === "SUBSCRIPTION_ACTIVE") {
  void this.push.dispatch({
    userId: user.id,
    category: "subscription-active",
    title: cfg.title,
    body: `Your access to ${planLabel} is now active. Tap to start learning.`,
    href: "account", // P0: my-classes/account (levelId not threaded)
    dedupeKey: `push:sub:active:${externalSubId}`,
  });
}
```

Double-fire is prevented by the caller's `prevMirror == null && (ACTIVE||TRIALING)` gate (`billing.service.ts:1503`). `fireSubscriptionAutomation` passes no `eventKey`, so we add an explicit `dedupeKey`. To deep-link to the specific Class, thread `s.items[].levelId` through `fireSubscriptionAutomation` (currently only `levelName` flows) and set `href: classes/<levelId>` — optional for P0.

---

## 5. Mobile (`apps/mobile`)

### 5.1 Dependencies + native config

- Add `expo-notifications` (+ `expo-device`) to `apps/mobile/package.json` at the `~56.x` line.
- Append the plugin in `app.config.ts:55-81` `plugins`:
  ```ts
  [
    "expo-notifications",
    { icon: "./assets/notification-icon.png", color: "#101014" },
  ];
  ```
- **This is a native change.** `runtimeVersion.policy` is `"appVersion"` (`app.config.ts:40`) → it **cannot** ship via `eas update` (OTA). It needs a fresh `eas build` + `eas submit` on **both** stores (`SHIPPING.md §7`).

### 5.2 `src/push.ts` (new) — handler + helpers

Set the foreground handler **at module load** (Expo requires it before the first notification), and house the token helpers here. Import this module once at the top of `App.tsx` so it runs on bundle load.

```ts
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerPushForCurrentInstance(): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return; // never prompt here; only in the toggle
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await api.registerPushToken(token, Platform.OS); // hits the LIVE API_BASE_URL
  } catch {
    /* best-effort */
  }
}

export async function unregisterPushForCurrentInstance(): Promise<void> {
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await api.unregisterPushToken(token).catch(() => {});
  } catch {
    /* best-effort */
  }
}
```

### 5.3 `api.ts` — two new methods

Beside the existing endpoints (`api.ts:179+`), mirroring the `request()` bearer pattern:

```ts
registerPushToken: (token: string, platform: string) =>
  request<{ ok: true }>("/push/register", { method: "POST", body: { token, platform } }),
unregisterPushToken: (token: string) =>
  request<void>("/push/register", { method: "DELETE", body: { token } }),
```

Authed by default (bearer auto-attached); both fetch the live `API_BASE_URL`, so they always target the currently-bound academy. `request()` returns `undefined` on 204 — type `unregister` as `request<void>`.

### 5.4 Token lifecycle

| Event                       | Where                                                                                             | Action                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| After login                 | `auth.tsx:33` `signIn`, right after `setTokenState(next)`                                         | `void registerPushForCurrentInstance()` — covers Login + Signup screens; `bindInstance` already ran so `API_BASE_URL` is the right tenant |
| Cold start with token       | `auth.tsx:25-29` bootstrap                                                                        | `.then(tok => { setTokenState(tok); if (tok) void registerPushForCurrentInstance(); })`                                                   |
| Sign out                    | `auth.tsx:36-39` `signOut`, **before** `await clearToken()`                                       | `void unregisterPushForCurrentInstance()` — also covers the 401-revoke path (routes through `signOut`)                                    |
| **Switch academy / delete** | `config.ts:256`, **top of `unbindInstance()` before `bindingGeneration++` / `API_BASE_URL = ""`** | **CRITICAL cross-tenant leak fix** — DELETE the outgoing tenant's token while `API_BASE_URL` + the scoped bearer still resolve            |

**`unbindInstance` caveat:** `config.ts` cannot cleanly import `api.ts`. Add a registered cleanup hook (mirroring `setUnbindListener`) that fires _first_ inside `unbindInstance`, or do a direct `fetch(`${API_BASE_URL}/push/register`, { method: "DELETE", ... })` before the base is cleared. The existing `unbindListener` (line 283) runs **too late** — the base is already `""`.

**Epoch invariant:** if you memoize a "last-registered token" to skip duplicate POSTs, stamp it with `scopedKey` + `bindingEpoch` exactly like `token-store.ts`, or a tenant switch will re-POST a stale token to the wrong academy.

### 5.5 Tap routing + the logged-out cold-start fix

In `ThemedApp`, around the single `<NavigationContainer ref={navigationRef}>` (`App.tsx:443`):

```ts
useEffect(() => {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const href = resp.notification.request.content.data?.href as
      string | undefined;
    if (!href) return;
    if (navigationRef.isReady() && tokenRef.current) openAppHref(href);
    else pendingDeepLink.current = href; // queue for after login
  });
  // killed-app cold-start tap:
  Notifications.getLastNotificationResponseAsync().then((r) => {
    const href = r?.notification.request.content.data?.href as
      string | undefined;
    if (href) pendingDeepLink.current = href;
  });
  return () => sub.remove();
}, []);

// drain once authed + nav ready:
useEffect(() => {
  if (token && navigationRef.isReady() && pendingDeepLink.current) {
    const href = pendingDeepLink.current;
    pendingDeepLink.current = null;
    openAppHref(href);
  }
}, [token]);
```

**Why the queue is required:** `RootNavigator` (`App.tsx:396`) mounts **only** `<AuthNavigator/>` (Login/Signup) while `token == null` — none of the target screens (`HelpdeskThread`/`Payments`/...) exist, and `openPath` falls back to the browser when `!navigationRef.isReady()` (`links.ts:63`). Without the queue, a dunning-push tap on a killed, logged-out app bounces the member to the web instead of into the app after login. This is the documented v1 limit at `App.tsx:60`.

The three P0 hrefs map to route heads already handled in `openPath` and already in `RESERVED` (`links.ts:12`) — `help/<id>` → `HelpdeskThread`, `account/payments` → `Payments`, `account` → Profile. **No new linking path or `RESERVED` entry needed.**

### 5.6 Permission priming + Account toggle

No cold-launch prompt (the pre-connect screen is blank). Prime **inside a user action**, mirroring `AccountScreen.pickAvatar` (`AccountScreen.tsx:252`). Add a `<Switch>` row in the "More" card (`AccountScreen.tsx:778`) — import `Switch` from `react-native` and `* as Notifications from "expo-notifications"`:

- **On enable:** `Notifications.requestPermissionsAsync()` → on `!granted` set an inline error and return; else `registerPushForCurrentInstance()`.
- **On disable:** `unregisterPushForCurrentInstance()`.
- **Initial state:** derive from `getPermissionsAsync()` + whether a token is registered; re-sync with the existing `useRefreshOnFocus` (`AccountScreen.tsx:224`).

---

## 6. Ops & store

- **Push credentials are per-app-binary, not per-academy.** Provision **one** APNs `.p8` key + **one** FCM (v1 service account) on the **shared** EAS project (`0f8efe5e-…`, `com.thewebpaanda.lms`), and a **separate** set per white-label EAS project (`INSTANCE_EAS_PROJECT_ID`) in that client's own Apple/Play accounts. Configured on the EAS project, separate from the `eas.json` submit stubs.
- **Data-safety filing (blocking for submit):** amend `SHIPPING.md §6` and both stores' privacy forms to declare the **push/device token as a collected identifier** and the notification permission. Currently they declare only email + name + lesson progress / "no tracking" — under-declaring an identifier is a rejection risk.
- Set `EXPO_ACCESS_TOKEN` in the API environment (all instances).

---

## 7. The one compliance line (P0's sharpest edge)

Members buy on the web and the app unlocks that content, so a push that steers to web purchase to dodge IAP is the exact **Apple 3.1.1 / anti-steering** violation the in-app billing screen already avoids. Of the three P0 sends, **payment-failed** is the risk.

> **DO:** "We couldn't process your payment for _Pro Membership_. Your access continues until Oct 3." → deep-link `account/payments` (in-app read-only status).
> **DON'T:** any price · "Renew now" · "update your card at academy.example.com" · any `WEB_ACCOUNT_URL`.

`PushService.stripSteering()` (applied to the `payment-failed` category) is the mandatory server-side choke point — not advice. It stays in place for every future billing/marketing send.

---

## 8. Cross-cutting requirements (apply to all three sends)

1. **Webhook-never-500:** the billing sites are called from Stripe/PayPal webhook reconcile paths that _rethrow to trigger provider retries_. Every `dispatch()` call is `void` + best-effort and sits inside the existing try/catch. A throwing push = infinite provider retries.
2. **Idempotency:** dedupe via `PushLog.dedupeKey` (unique), reusing each site's existing key (helpdesk `seq`, dunning `eventKey`, sub-active `externalSubId`).
3. **Preview exclusion:** handled automatically — preview members can't register a token (`PreviewReadOnlyGuard`), and `isPreview` sessions never reach the mobile register flow.
4. **Per-tenant scoping:** tokens live in each instance's own DB; mobile registers against the live `API_BASE_URL` and de-registers on academy switch.
5. **Brand:** server copy uses `cfg.title` per instance (never a hardcoded operator name).

---

## 9. Acceptance criteria

- [ ] Migration applies cleanly on a populated DB (`pushOptOut` backfills to `false`).
- [ ] Logged-in member on a real device registers a token on login; row appears scoped to `p.sub`.
- [ ] Admin replies to a helpdesk thread → member gets one push (not one per burst message); tap opens `HelpdeskThread`.
- [ ] Simulated `invoice.payment_failed` → member gets a dunning push with a grace date, **no price/URL**; tap opens `Payments`; a webhook replay sends **no** second push.
- [ ] New subscription activates → member gets a welcome push once; a reconcile replay sends **no** second push.
- [ ] Switching academy de-registers the token from the outgoing instance (verify the old instance's DB row is gone).
- [ ] Tapping a push on a killed, logged-out app lands on the target screen **after** login (pending-deep-link queue).
- [ ] Expo `DeviceNotRegistered` receipt marks the token `disabled`.
- [ ] Disabling the Account toggle removes the token; no further pushes arrive.
- [ ] A throwing Expo call never 500s a webhook or blocks an admin reply.

---

## 10. File-by-file change checklist

**`packages/db`**

- [ ] `schema.prisma` — `DeviceToken`, `PushLog` models; `pushOptOut` + `deviceTokens` on `User`
- [ ] new migration `add_push_device_tokens`; run `generate`

**`apps/api`**

- [ ] add `expo-server-sdk`; `EXPO_ACCESS_TOKEN` env
- [ ] `src/push/push.service.ts`, `push.controller.ts`, `push.module.ts`, `dto/register-device-token.dto.ts` (new)
- [ ] register `PushModule` in `app.module.ts`
- [ ] `helpdesk.service.ts:658` + `helpdesk.module.ts` — inject `PushService`, dispatch in `notifyMember` block
- [ ] `billing.service.ts:180` + `:230` — inject `PushService`, dispatch at the two fire helpers

**`apps/mobile`**

- [ ] `package.json` — `expo-notifications`, `expo-device`; `app.config.ts` plugin
- [ ] `src/push.ts` (new); import in `App.tsx`
- [ ] `api.ts` — `registerPushToken` / `unregisterPushToken`
- [ ] `auth.tsx` — register on signIn + cold-start; unregister on signOut
- [ ] `config.ts` — unregister hook at top of `unbindInstance`
- [ ] `App.tsx` (`ThemedApp`) — response listener + pending-deep-link queue
- [ ] `AccountScreen.tsx` — `Notifications` toggle + priming

**Ops**

- [ ] APNs `.p8` + FCM on the shared EAS project (+ each white-label)
- [ ] `SHIPPING.md §6` + store data-safety: declare push-token identifier
- [ ] fresh `eas build` + `eas submit` (both stores)
