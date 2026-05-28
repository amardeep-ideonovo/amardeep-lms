# Pre-release QA checklist

> Walk this checklist against **staging** before promoting a release to
> production. Aim for ~15 minutes — most steps are smoke-level.
>
> Set `STAGING_WEB`, `STAGING_ADMIN`, `STAGING_API` to your staging URLs
> before you start. Sample:
> - `STAGING_WEB = https://staging.example.com`
> - `STAGING_ADMIN = https://admin-staging.example.com`
> - `STAGING_API = https://api-staging.example.com`

---

## 0. Prerequisites

- [ ] Latest `amardeepLMS` deployed to staging (check the build hash in
      `$STAGING_API/health` matches the latest commit on the branch)
- [ ] Staging seed has been run at least once
      (`npm run -w @lms/db seed:staging` — added in PR #8)
- [ ] Stripe is in **test mode** on staging
      (`STRIPE_SECRET_KEY` starts with `sk_test_`)
- [ ] Mailchimp `MAILCHIMP_AUDIENCE_ID` points at the dedicated staging
      audience (NOT the production one)

---

## 1. Infrastructure smoke (2 min)

- [ ] `GET $STAGING_API/health` → `200 OK`, body contains
      `status: "ok"`, `env: "staging"`, `checks.db: "ok"`, `checks.redis: "ok"`
- [ ] `GET $STAGING_WEB` loads the public homepage without console errors
- [ ] `GET $STAGING_ADMIN` redirects unauthenticated to admin login

If any of these fail, **stop** — fix before continuing the checklist.

---

## 2. Admin surface (4 min)

- [ ] Admin login (`smoke-admin@example.com`) succeeds → Members tab loads
- [ ] Members tab: create a new member with all fields
      (firstName/lastName/email/phone) → row appears with every field
- [ ] Filter members by level → list narrows correctly
- [ ] Levels tab: edit an existing level — add one Mailchimp tag, remove one,
      save → on Mailchimp's dashboard, confirm both changes reflected within
      30 seconds on holders of that level
- [ ] Pages tab: create a new page, publish it →
      `GET $STAGING_WEB/<slug>` renders the Puck blocks
- [ ] Forms tab: open an existing form's Entries view → at least one
      submission visible; CSV export downloads without error

---

## 3. Member web surface (3 min)

- [ ] Member login (`smoke-bot@example.com`) → dashboard renders categories
- [ ] Click a category → courses listed
- [ ] Open a course → lesson loads, Vimeo iframe plays (or shows the player
      controls; you don't need to watch through)
- [ ] Click a lesson note → file downloads (no naked URL leak in network
      tab — should be a token-bearing request)
- [ ] Active dashboard popup renders; close it; refresh — confirms "show
      once" semantics if you have that flag, or every-page-load if not

---

## 4. Billing (Stripe test mode) (3 min)

- [ ] PAID checkout flow: click Subscribe on a `$1.00` test-only level →
      Stripe Checkout opens → card `4242 4242 4242 4242`, any future expiry,
      any CVC → redirected back to `/account?checkout=success`
- [ ] Within 5 seconds, that member's `UserLevel` shows ACTIVE in admin
- [ ] Customer Portal: from `/account` open portal → cancel subscription →
      within 5 seconds, `UserLevel` shows CANCELED and Mailchimp tag removed
- [ ] Past-due path: re-subscribe with card `4000 0000 0000 0341` →
      `UserLevel` eventually shows PAST_DUE after Stripe simulates the
      failed payment (allow ~30s)

If any billing step fails, **do not promote** — billing regressions are the
highest-impact class of bug.

---

## 5. Mailchimp sync (1 min)

- [ ] On the staging Mailchimp audience, confirm the test member from §2
      has the tags you expect from their levels
- [ ] Confirm no stale tags from previous QA runs persist (housekeeping —
      if many, do a one-time cleanup on the staging audience)

---

## 6. Public surfaces / embed (2 min)

- [ ] `GET $STAGING_WEB/blog` lists posts
- [ ] `GET $STAGING_WEB/blog/<slug>` renders a single post with images
- [ ] `embed.js` smoke: open
      `deploy/embed-test.html` (or any local HTML file with the embed
      snippet) → form renders cross-origin → submit → submission lands in
      admin and Mailchimp

---

## 7. Mobile (Expo) — when shipping mobile changes (3 min)

> Skip this whole section if the release contains NO mobile-affecting
> changes (you can tell by looking at `apps/mobile/**` in the PR diff).

- [ ] Start Expo Go on a real device or simulator pointed at staging
      (`EXPO_PUBLIC_API_URL=$STAGING_API`)
- [ ] Login → dashboard → course list → lesson video plays
- [ ] Active popup overlay appears
- [ ] Pull-to-refresh updates progress

---

## 8. Settings (do last — destructive operations) (1 min)

- [ ] Settings tab → Remove Stripe keys → reload page → admin still works
      (nothing crashes) → re-add the test keys
- [ ] Settings tab → Remove Mailchimp keys → reload → audience picker on
      Levels page shows the "Mailchimp unconfigured" hint → re-add keys

---

## Promotion criteria

✅ Promote to production only if **all of §1–§5 passed**. §6–§8 are
"strongly recommended" but not blocking if the release touches none of
those surfaces.

If anything failed:
1. File a GitHub issue with the failing step, the URL, and the request/
   response if relevant.
2. Do not promote.
3. Fix on a new branch, redeploy staging, re-walk the affected section.

---

## What to do if you find a regression in prod that this checklist missed

Add a checklist item that would have caught it. The checklist is a living
document — every prod incident should leave it slightly stronger.
