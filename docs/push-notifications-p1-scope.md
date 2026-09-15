# Push Notifications — P1 Scope

**Status:** scoping (not yet built) · **Depends on:** P0 ([#252](https://github.com/amardeep-ideonovo/amardeep-lms/pull/252), `docs/push-notifications-p0-spec.md`)
**Audience:** engineering + product (the open decisions in §6 need a call)
**Terminology:** Class = Prisma `Level` ⊃ Course (`CourseLevel`) ⊃ Lesson. Access = `UserLevel.status = ACTIVE AND (expiresAt IS NULL OR > now)`, `isPreview:false`.

---

## 1. What P1 delivers

Six new member sends, and the shared infrastructure they need. P1 is where push graduates from P0's **1:1 dispatch** to **entitlement fan-out**, and where members finally get a **durable notification inbox**.

| #   | Send                           | Shape                 | Emit-site (verified)                                      | Trigger exists?            |
| --- | ------------------------------ | --------------------- | --------------------------------------------------------- | -------------------------- |
| 1   | Certificate earned             | 1:1                   | `certificates.service.ts:353` (claim create)              | ✅ email hook              |
| 2   | Certificate ready to claim     | 1:1                   | `lms.service.ts:615` (`statusForLesson`, terminal lesson) | ⚠️ compute exists, no emit |
| 3   | New course in a Class you own  | **fan-out**           | `lms.service.ts:226` publish transition                   | ❌ build                   |
| 4   | New lesson in a Course you own | **fan-out**           | `lms.service.ts:375` `createLesson`                       | ❌ build                   |
| 5   | Live session starting soon     | **scheduled fan-out** | new live cron (`startsAt − joinLeadMin`)                  | ❌ build                   |
| 6   | Live now / join open           | **scheduled fan-out** | same cron tick (`startsAt`)                               | ❌ build                   |

Everything P1 sends is **transactional / owned-content** (earned by entitlement) — default-on, no marketing consent needed. The marketing/broadcast sends (new-class announce, blog, coupon, engagement) remain **P2/P3**.

**Already done in P0 (don't re-scope):** the mobile notification-tap listener, pending-deep-link queue, and `isSafeInternalHref` sanitisation all shipped in `App.tsx`. The only mobile deep-link gap for P1 is adding the `live` route head to `links.ts` (§3.5).

---

## 2. The sends

### 2.1 Certificates — the cheap wins (ship first)

Both reuse P0's `PushService.dispatch` (1:1). Work per send is ~S:

- **Extend the `PushCategory` union** (`push.service.ts:12`) with `"certificate-issued" | "certificate-ready"` (local union — the API can't runtime-import `@lms/types` values; keep the DTO copy in sync). Neither is a `BILLING_CATEGORY`, so `stripSteering` correctly won't apply.
- **certificate-issued** — beside the existing `notifications.record` + email at `certificates.service.ts:353`, add `void this.push.dispatch({ userId, category:"certificate-issued", href:"classes/<levelId>", dedupeKey:"cert-issued:<userId>:<levelId>" })`. `claim()`'s idempotent fast-path (`:260`) already guarantees first-issue-only; the PushLog dedupe is a backstop.
- **certificate-ready** — in `completeLesson` (`lms.service.ts:615`), when `statusForLesson` returns a row with `eligible && !claimed`, dispatch `category:"certificate-ready"`, `dedupeKey:"cert-ready:<userId>:<levelId>"`. `statusForLesson` recomputes on every completion (incl. re-POSTs), so the **stable per-(member,class) dedupeKey is load-bearing**.
- **Wire `PushModule`** into `CertificatesModule` and `LmsModule` (both currently import neither; `PushModule` exports `PushService`, no cycle).

> **Decision (§6-A):** issued vs ready can double-notify seconds apart (finish final lesson → ready; tap claim → issued). Recommend shipping **certificate-ready** as the primary and treating certificate-issued as optional/suppressible.

### 2.2 Content — the fan-out pair

- **new-course-in-owned-class** — a course is **born unpublished** (`createCourse:183`), so the emit belongs on the draft→published transition in `updateCourse`. ⚠️ **The verified trap:** `updateCourse` writes `published` unconditionally (`:226`) and the existing-row read (`:193`) does **not** load `published`, so today it can't tell a publish from a re-save. Fix: add `published` to that select, compare `existing.published === false && next === true`, and fan out to the **final** `levelIds` from the post-write re-read (`fresh.courseLevels`, `:245`) — never from `dto.levelIds` (optional/undefined on update).
- **new-lesson-in-owned-course** — `createLesson` (`:375`) has no emit. The parent-course read already loads `published`/`archivedAt` (gate on `published && archivedAt === null`); add `include:{ courseLevels:{ select:{ levelId:true } } }` to get the audience `levelIds`.

Both call the shared resolver (§3.1): `void this.push.dispatchToLevels(levelIds, {...})`.

> **Decisions (§6):** new-lesson can fire on _every_ lesson added to a live course (§6-B — coalesce/debounce?), and an **open course** (zero `CourseLevel` rows) is owned by _everyone_ (§6-C — blast radius).

### 2.3 Live — the scheduled fan-out

A new `LiveReminderService` (`@Cron(EVERY_MINUTE)`, cloned from `email/scheduler.service.ts` with its `running` overlap guard) scans `LiveSession where status = SCHEDULED`, matching two fire-instants to the current 60s bucket (half-open `[tickStart, tickStart+60s)`):

- **live-starting-soon** at `startsAt − joinLeadMin` · **live-now** at `startsAt`.
- Audience: `LiveSessionTarget → Level → entitled members` (`audience = LEVELS`), or all active members (`ALL_ACTIVE`) — the reverse of `access.service.activeLevelIds`, deduped to one push per member.
- **Deep-link to the in-app join bar** (`live/<sessionId>`), never credentials (they're pull-only and window-gated at `live.service.ts:388`).

⚠️ `LiveSession.reminderSentAt` is **one** nullable column but there are **two** fires — resolve via a second marker (`liveNowSentAt`) or per-(event,session,user) `PushLog` dedupe (§6-E). Filter `status = SCHEDULED` so a cancelled session (`adminDelete:230`) never reminds. All timing math is UTC (`startsAt`/`joinLeadMin`); `timezone` is display-only.

---

## 3. New shared infrastructure

### 3.1 Audience resolver

`resolveEntitledMembers(levelIds): userId[]` — query **`User`** (not `UserLevel`) with `where:{ isPreview:false, pushOptOut:false, levels:{ some:{ levelId:{ in }, status:"ACTIVE", OR:[{expiresAt:null},{expiresAt:{gt:now}}] } } }`. Querying `User` gives **free user-level dedupe**; the `expiresAt` guard is mandatory (a grant stays ACTIVE during dunning grace). **Empty `levelIds` ⇒ open course** — must branch to "all non-preview members" (a naive `in:[]` matches nobody, the exact inverse of intent). Do **not** copy `levels.service.ts` member-count queries — they omit both the `expiresAt` guard and the preview exclusion.

### 3.2 Batched fan-out send

P0's `dispatch` is strictly 1:1 (one user lookup + token query + Expo call). A ~500-member fan-out must not be 500 of those. Add `dispatchToLevels(levelIds, …)` / `dispatchMany(userIds, …)`: one `DeviceToken` query across the cohort, `PushLog.createMany({ skipDuplicates })` with **per-recipient** keys (`event:<entityId>:<userId>` — a single event-level key would suppress the whole fan-out), one chunked Expo send across all members, reuse `pruneInvalidTokens`. Refactor the shared token-send block out of `dispatch`.

### 3.3 Async substrate — **recommend DB-outbox + cron, not BullMQ**

BullMQ is a **dormant dep with zero usage** — adopting it is net-new infra (worker process, new compose service), not reuse. Instead add a **`PushOutbox`** table and drain it with `@Cron(EVERY_MINUTE)`, cloning `automation.service.ts drainScheduledEmails` (atomic `updateMany` claim → `count === 1` proceeds; `running` re-entrancy bool; stuck-SENDING recovery). This is safe across replicas (the claim serialises) and mirrors the email engine one-for-one. Fan-out emit-sites enqueue; the drain resolves + sends.

> **Decision (§6-F):** snapshot the audience at **enqueue** (store `userId`s) vs at **drain** (store `levelIds`/`courseId` and resolve then). Recommend **resolve-at-drain** so a member who buys the class in the ~1-min gap isn't missed.

### 3.4 Expo receipt/prune cron

P0 only inspects the **immediate** send ticket; `DeviceNotRegistered` usually arrives in a **receipt ~15 min later**. Add a **`PushReceipt`** table (`receiptId @unique`, `expoPushToken`, `status`, `checkAfter`), write one row per `ok` ticket in the send loop, and a `@Cron` that (after `checkAfter`) calls `getPushNotificationReceiptsAsync` and disables dead tokens. A receipt id **missing** from the response means "not ready", never "prune". Give up stuck rows after ~24–48h.

### 3.5 Mobile deep-link for live (S)

Add `live` to `links.ts` `RESERVED` and the `openPath` switch (`case "live": nav.navigate("LiveSession", { sessionId })`). Tap-routing itself is already wired (P0).

---

## 4. Member notification inbox (sub-track — the largest piece)

Members have **no** inbox today (`AdminNotification`/`AdminNotificationRead` are admin-only). This makes push ephemeral — a member with the app closed, push off, or a pruned token **never learns** an event happened, and there's no authoritative badge source. P1 promotes the inbox to first-class.

- **Model** — `MemberNotification { id, userId FK(Cascade), type/category, title, body, href, dedupeKey @unique, readAt DateTime?, createdAt, @@index([userId,readAt]), @@index([userId,createdAt]) }`. **A single `readAt` column, not the admin join table** — the admin `…Read` table exists only because one admin notification fans to many admins; a member notification is owned by exactly one member.
- **Service + controller** — mirror `notifications.service.ts` (list / unreadCount / markRead / markAllRead) behind `JwtAuthGuard` at `@Controller("notifications")`, scoped to `principal.sub`, with the `if (p.isAdmin) return` no-op and the **`read-all` route declared before `:id/read`** (route-order trap).
- **The key integration** — a `notify()` orchestration helper that **always writes the durable inbox row first (ignoring `pushOptOut`/token presence), then best-effort dispatches the push.** The inbox write must sit **before** `dispatch`'s early-returns (opt-out / zero-tokens), or opted-out and token-less members get no record. Stored `href` must be a relative in-app path (it feeds `isSafeInternalHref`).
- **Mobile** — a new `NotificationsScreen` (list, optimistic mark-read → `openAppHref`, mark-all, empty state) registered over the tabs like `Certificates`; an **unread badge** (Profile `tabBarBadge` or a header bell — the app has neither today, so this is a design call, §6-H) bound to a `useNotificationsUnread` hook; api methods + query keys. This is **JS-only → OTA-eligible** (no new native module), unlike the P0 native change.
- **Retention** — fan-out writes N rows per event; add a prune cron (pattern: `helpdesk-retention.service.ts`, daily) so it doesn't grow unbounded.

> **Decisions (§6):** does the inbox cover the **P0 trio** too (retrofit `helpdesk-reply`/`payment-failed`/`subscription-active` — recommended for a consistent badge) (§6-G)? Does `MemberNotification` **replace** `PushLog` as the idempotency ledger or coexist (§6-I)?

---

## 5. Sequencing — three shippable PRs

| Sub-phase                          | Contents                                                                                                                                            | Rough effort     | Ships on           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------ |
| **P1a — Certificates**             | certificate-issued + certificate-ready (1:1)                                                                                                        | **~1–2 days**    | P0 substrate as-is |
| **P1b — Fan-out + content + live** | audience resolver · batched send · `PushOutbox` + drain cron · Expo receipt cron · new-course + new-lesson · live cron + markers · `live` deep-link | **~2–3 weeks**   | new infra          |
| **P1c — Member inbox**             | `MemberNotification` model + service/controller + `notify()` orchestration (+ P0 retrofit) · mobile inbox screen + badge + hooks · retention prune  | **~1.5–2 weeks** | P1b's send path    |
| _Optional — Per-category prefs_    | `NotificationPref` (content/learning/live buckets, default-on; always-on `account` bucket) + `/push/prefs` API + mobile category switches           | _~3–4 days_      | any time after P1b |

P1a can land immediately and independently (great momentum win). P1b is the heart. P1c is separable — it can slip to "P1.5" without blocking the sends, though the sends are far more useful with it. **Rough total: 4–6 weeks** of focused work; treat the numbers as order-of-magnitude, not commitments.

---

## 6. Open decisions (need a call — recommendations in **bold**)

- **A. Certificate double-notify** — ship certificate-ready only, or both issued+ready? → **certificate-ready primary; issued optional.**
- **B. new-lesson frequency** — notify on every lesson added to a live course, or coalesce? → **coalesce/debounce** ("N new lessons in <Class>") via a short outbox window, or at minimum a per-course-per-day cap. Un-debounced fan-out on bulk lesson uploads is a spam risk.
- **C. Open-course blast radius** — an open course (no `CourseLevel`) is technically owned by every logged-in member. → **restrict content fan-out to members holding ≥1 active grant** (paying members), not literally everyone, to bound the blast.
- **D. Async substrate** — **DB-outbox + `@Cron` (recommended)** vs BullMQ.
- **E. Live dedupe** — second marker column (`liveNowSentAt`) vs per-(event,session,user) `PushLog` dedupe → **add `liveNowSentAt` for the session-level gate + `PushLog` for per-user idempotency.**
- **F. Audience snapshot timing** — enqueue vs **drain-time (recommended)**.
- **G. Inbox coverage** — P1 events only, or **retrofit the P0 trio too (recommended)** so the badge/inbox is complete.
- **H. Badge surface** — Profile `tabBarBadge` vs a header bell (new UI either way; design call).
- **I. `MemberNotification` vs `PushLog`** — coexist (two tables) or **unify** (inbox row is also the dedupe ledger). Unify is cleaner but couples send-dedupe to the inbox write; **recommend coexist for P1** (least risk), revisit later.
- **J. Per-category prefs** — master switch + inbox sufficient for launch, or add `NotificationPref` now? → **defer to the optional track**; P1 sends are default-on transactional, so the P0 master toggle suffices initially.

---

## 7. Traps carried from the audit + P0 review (must-honor)

1. **Transition detection** — `updateCourse` can't currently tell publish from re-save; without the `published`-in-select fix, new-course fires on every edit.
2. **Empty-`CourseLevel` inversion** — `dispatchToLevels([])` notifies _nobody_; the resolver must branch to the open-course audience.
3. **Per-recipient dedupe keys** — a fan-out with one event-level `PushLog` key suppresses the entire blast after the first recipient.
4. **`expiresAt` + `isPreview`** — every audience query needs the expiry guard and the preview exclusion; the unlocked preview member synthetically "owns every class."
5. **Inbox before the opt-out bail** — write the durable row regardless of `pushOptOut`/tokens.
6. **Multi-replica cron** — the `running` guard is per-process; fine for one API container/instance, but the live-session marker stamp and outbox drain must use conditional `updateMany` claims (they do) if the API ever scales horizontally.
7. **Deep-link to the join bar, not credentials** for live.
8. **Best-effort everywhere** — `void this.push.*`, never throw into an emit path (webhook/reply/cron).
