# Store Launch Runbook — shared mobile app (Apple App Store + Google Play)

End-to-end, from-scratch guide for listing the **shared** member app (the
"connect to your academy" picker app) on both stores under the operator's
accounts. Facts verified against the repo, EAS, and the live fleet on
**2026-09-07**.

Companion documents:

- [`apps/mobile/SHIPPING.md`](../apps/mobile/SHIPPING.md) — build mechanics
  (SDK gates, brand-asset hook, shared vs white-label env, OTA rules). This
  runbook does not repeat it.
- [`docs/store-listing-pack.md`](store-listing-pack.md) — paste-ready listing
  copy, questionnaire answers, reviewer notes, screenshot shot-list.

**Out of scope:** white-label per-client apps (client-owned store accounts,
separate EAS profiles). See Appendix A for the one blocker to fix before any
white-label submission.

---

## 0. Current state — what is already done

The app **code** is submission-ready. All store-compliance code work shipped in
#198 (no checkout link-outs / no prices), #219 (billing portal removed — no
transactions in-app), and #220 (in-app legal links, camera/mic permissions
dropped, OTA unsigned, SHIPPING §7 corrected).

| Area | State | Evidence |
|---|---|---|
| Bundle id / package | `com.thewebpaanda.lms` (both stores) — **permanent after first upload** | `app.config.ts` |
| App name | `Spotlight Academy` (set 2026-09-08) — changeable later; see listing pack §11 positioning note | `app.config.ts` |
| Version / channel | 1.0.0, runtime policy `appVersion`, remote version source, `autoIncrement` on production, Android AAB | `eas.json` |
| Android build lane | **Proven** — 10 finished production builds (latest: build 10, `3e2c624`, 2026-09-05) | `eas build:list` |
| iOS build lane | **Never built** — blocked only on an Apple Developer account (credentials) | `eas build:list` |
| In-app legal links | Account "More" card + Login footer + Signup consent line → `https://thewebpaanda.com/privacy` + `/terms` (both live, HTTP 200) | `src/config.ts` `legalLinks()` |
| Account deletion | In-app (Account → Delete account, above Sign out) + API + public web page | `AccountScreen.tsx`, `apps/api/src/account/`, `apps/web/app/delete-account/` |
| Purchases | **None in-app, no external purchase links, no prices.** Only money-adjacent surface: "Receipt ↗" for *paid* invoices | #198 + #219 |
| Permissions | Photo library only (avatar). No camera, no mic, no location, no push | `app.config.ts` image-picker plugin |
| Tracking / analytics | None at all (no SDKs) → no ATT prompt, clean data-safety forms | `package.json` |
| Sign in with Apple | **Not required** — email/password only, no social login | `LoginScreen.tsx` |
| Export compliance | Pre-answered (`usesNonExemptEncryption: false`) | `app.config.ts` |
| SDK gates | Expo SDK 56 / targetSdk 36 / Xcode 26 image — satisfies both stores' 2026 requirements | SHIPPING.md §0 |
| Tablets | Universal iPhone+iPad, Android tablet rotation → **iPad 13" screenshots required** | SHIPPING.md §3b |
| Crash safety | Top-level `ErrorBoundary` (a render crash during review = auto-reject) | `src/components/ErrorBoundary.tsx` |
| Force-update lever | `MIN_APP_VERSION` env per instance → in-app "Update required" gate | §8.4 below |
| Reviewer path | Connect code **`demo`** resolves live → Demo Instance (verified 2026-09-07) | `https://thewebpaanda.com/api/app/resolve?code=demo` |

**What is missing** (everything below is this runbook's subject):

1. Apple Developer + Play Console accounts (owner; §1)
2. Console setup + submit credentials — `eas.json` has `REPLACE_WITH_*` Apple
   placeholders and no Play service-account JSON (§2)
3. Final icon/splash art — checked-in files are placeholders, and
   `splash.png` (720×1560) is below its own 1284×2778 spec (§3.1)
4. Screenshots — none exist anywhere in the repo (§3.2)
5. Store listing copy + questionnaires — drafted in the listing pack, needs
   owner sign-off (§4)
6. Reviewer demo account on the demo academy (§5)
7. Legal pages: live but placeholder-flagged and written for B2B clients, not
   app end-users — the highest review risk we control (§4.3)

---

## 1. Accounts — the owner critical path

Everything in this section is **owner-side** and dominates the calendar.
Start all three in parallel on day 1.

### 1.1 D-U-N-S number (needed for both org accounts)

- Free via Apple's D-U-N-S lookup/request tool (developer.apple.com → look up
  your entity; request a number if none exists). Works for India; a legal
  entity is required (the Udyam sole-proprietor registration sufficed when we
  checked in August). **Do not pay** Dun & Bradstreet India's paid "upsell"
  services — the Apple path is free.
- Lead time: **~5–10 business days.** This is usually the long pole.

### 1.2 Apple Developer Program — $99/year

- Enroll as **Organization** (recommended: seller shows as the company, and it
  keeps the operator account clearly separate from future client-owned
  white-label accounts). Requires: legal entity name (must match D-U-N-S),
  D-U-N-S number, website, and a verifiable phone. Verification: 24 h – 2 weeks.
- Individual enrollment works as a fallback but publicly lists a personal name
  as the seller and is awkward to migrate later.
- After approval, in App Store Connect accept the free-app agreement
  (the *Paid* Applications agreement / banking / tax forms are **not** needed —
  the app is free with no IAP).
- Note the **Team ID** (Membership page) — it goes into `eas.json`.

### 1.3 Google Play Console — $25 one-time

- Register as an **Organization** (same D-U-N-S / entity). Identity
  verification takes days.
- Organization accounts are **exempt** from the personal-account rule that
  requires a closed test with 12 opted-in testers for 14 consecutive days
  before production access — this exemption is the main reason to go org.
- Complete the account-level verifications (identity, address, developer
  email/phone shown on listings).

### 1.4 Expo/EAS account hygiene (do now, costs nothing)

OTA updates ship **unsigned** (EAS code signing is Enterprise-gated — see
SHIPPING.md §7), so the Expo account *is* the update-channel security boundary:

- Enable **2FA** on the `amardeeplms` Expo account (hardware key if possible).
- Keep `EXPO_TOKEN` scoped and only in GitHub repo secrets (already the case);
  never in fleet `.env`s.

---

## 2. One-time console setup

### 2.1 Apple (after enrollment)

1. **Credentials + bundle id:** from `apps/mobile`, run the first iOS build
   interactively:

   ```bash
   npx eas-cli build --profile production --platform ios
   ```

   Sign in with the Apple account when prompted and let **EAS manage
   credentials** — it registers the bundle id `com.thewebpaanda.lms` on the
   developer portal and creates/stores the distribution certificate +
   provisioning profile. (Nothing to back up locally; credentials live in EAS.)
2. **App record:** App Store Connect → My Apps → **＋ New App** → iOS, name
   (see listing pack), primary language English, bundle id
   `com.thewebpaanda.lms`, SKU e.g. `lms-shared-001`. Copy the app's numeric
   **Apple ID** (App Information page).
3. **Fill `eas.json`** → `submit.production.ios`: `appleId` (account email),
   `ascAppId` (numeric id from step 2), `appleTeamId`. The first
   `eas submit -p ios` run is interactive — authenticate once and let EAS
   store an App Store Connect API key for future non-interactive submits.

### 2.2 Google (after registration)

1. **Create the app:** Play Console → Create app → name, default language
   `en-US`, **App**, **Free** (irreversible — free is correct), accept
   declarations.
2. **First upload is manual** (the API cannot create releases for a brand-new
   app): download the production `.aab` from the EAS build page → Play Console
   → Testing → **Internal testing** → Create release → upload. Accepting
   **Play App Signing** here is automatic and correct (Google holds the app
   signing key; the EAS-managed keystore is the upload key).
3. **Service account for `eas submit`:** create a service account in Google
   Cloud console → generate a JSON key → in Play Console **Users and
   permissions**, invite the service-account email with release permissions
   (releases to testing tracks + production). Save the JSON as
   `apps/mobile/play-service-account.json` — the path `eas.json` already
   references, and it is already gitignored. **Never commit it.**
4. Subsequent uploads: `eas submit -p android` lands on the **internal**
   track (as configured); promote internal → production in the console UI.

### 2.3 CI note

`.github/workflows/native.yml` (console-dispatched `eas build`) deliberately
excludes submission while the placeholders exist. After §2.1/§2.2, submission
can stay a manual `eas submit` step — wiring it into CI is optional polish.

---

## 3. Listing assets

### 3.1 App art (owner)

The shared store build ships the **checked-in** files — the
`eas-build-pre-install` brand-asset hook only fires for white-label builds
(it is keyed off `EXPO_PUBLIC_API_URL`, which the shared app must not bake).
Replace, same filenames, before the store build. **Art carries the Spotlight
Academy identity** (Option A, listing pack §11) — it's the icon and pre-connect
splash every member sees, so it's the platform brand, not a thewebpaanda mark.

| File | Spec | Current state |
|---|---|---|
| `apps/mobile/assets/icon.png` | 1024×1024, **opaque** (iOS flattens/rejects alpha) | placeholder art, correct size |
| `apps/mobile/assets/adaptive-icon.png` | 432×432 foreground, keep art inside the central ~66% safe circle | placeholder art, correct size |
| `apps/mobile/assets/splash.png` | tall portrait ≈1284×2778, key art centered (resizeMode `contain`, bg `#101014`) | placeholder, **under-spec at 720×1560** |

Console-only uploads (not in the binary): Play **512×512** hi-res icon +
**1024×500 feature graphic** (see listing pack).

Art changes are **native** — they ship only via a new `eas build`, never OTA.

### 3.2 Screenshots (capture after art + reviewer account exist)

Required sets:

| Store | Set | Size |
|---|---|---|
| Apple | iPhone 6.9" (or 6.7") | 1320×2868 (1290×2796) |
| Apple | **iPad 13"** (required — `supportsTablet: true`) | 2064×2752 |
| Play | Phone (min 2 shots) | 1080×2400 works |
| Play | 7" tablet + 10" tablet (for tablet surfacing) | native emulator sizes |

Recipe: sign the **reviewer account** (§5) into the demo academy on the
"iPhone 17 Pro Max" + "iPad Pro 13-inch" simulators and a Pixel phone/tablet
emulator; clean the iOS status bar
(`xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100`);
capture with `xcrun simctl io booted screenshot out.png` / `adb exec-out
screencap -p > out.png`. Shot-list (6 shots, same order both stores) is in the
listing pack. 4–8 shots per set; first two carry the listing.

---

## 4. Listing content + questionnaires

All paste-ready values live in **`docs/store-listing-pack.md`**: names,
subtitle, short/full descriptions, keywords, category, contact URLs, the exact
App Privacy (Apple) and Data safety (Play) selections, content-rating answers,
target-audience choice, and the reviewer-notes text. Owner reviews/edits that
file, then transcribes into the consoles. Three items deserve emphasis:

### 4.1 The purchase question (both stores)

The app is a **companion for existing members**: it sells nothing, shows no
prices, links to no checkout. Members get access through their academy,
purchased on the academy's website — which both stores explicitly allow
(Apple 3.1.3 "multiplatform services"; Play's payments policy likewise only
bites when the app itself steers to an external purchase). Keep it that way:
**any future "buy"/"upgrade"/pricing surface or link in the app re-opens
Apple 3.1.1** and is the single most likely rejection class for this app.
Never mention prices or "purchase on the web" in the listing or review notes
beyond the neutral phrasing in the pack.

### 4.2 The multi-tenant question (Apple 4.2.6 / 4.3)

A reviewer may ask why one app serves many academies. The position (true, and
consistent with our architecture): this is the **single official app of the
thewebpaanda platform, published by the platform operator** — the same model
as other course-platform companion apps. Academies are tenants configured at
runtime; the binary is not a re-skinned template. (White-label apps are the
opposite case and deliberately ship under **client-owned** accounts, never
ours.) The reviewer-notes text in the pack covers this preemptively.

### 4.3 Legal pages — the one real content risk

`https://thewebpaanda.com/privacy` + `/terms` are live and linked in-app, but:

- Both self-identify as **placeholder, not lawyer-reviewed** (28 amber
  "owner must confirm" spans render on the live pages), and
- they are written **B2B** — the Terms address "the Client" (the business),
  and the Privacy Policy tells members to contact their academy. A reviewer
  opening the app's privacy-policy URL should find a document that describes
  **the app's own data handling to its own users**.

Before submission the owner/lawyer must finalize both pages **and** extend the
privacy policy with an end-user/member section covering exactly what the app
collects, **naming the app/service "Spotlight Academy"** (operated by the
company, thewebpaanda) per the Option A positioning (listing pack §11). The
factual data inventory to hand the lawyer is in the listing pack (it is the
same table the questionnaires are answered from). This work is in the
control-plane repo (`licensing-dashboard`, `src/app/(legal)/`) — and note a CP
deploy publishes the public site, so ship it deliberately.

Optional polish (CP repo): a platform-level `/delete-account` page — today the
Play data-safety deletion URL uses the demo academy's page
(`https://demo.thewebpaanda.com/delete-account`, live), which works but reads
academy-specific.

---

## 5. Reviewer demo account

Both stores re-review on **every** binary update — treat this account as
permanent infrastructure, not a one-off.

1. On the demo academy admin, create a dedicated member:
   `reviewer@thewebpaanda.com`, strong generated password (password manager +
   both consoles' credential fields). Do not reuse the seeded
   `member@example.com` (well-known password — rotate that account regardless,
   as the GTM audit already flagged).
2. Make the account **content-rich** (empty screens read as "incomplete app"
   under Apple 2.1): grant at least one class with video + audio + text
   lessons, complete a course so a **certificate** is issued, schedule an
   upcoming **live session**, and seed one resolved helpdesk thread.
3. Verify the full reviewer path yourself before every submission:
   connect code `demo` → sign in → classes → lesson plays → certificate opens
   → helpdesk answers → legal links open → sign out.

---

## 6. Build + submit

Preconditions: §1–§5 done, GO/NO-GO (§9) green.

```bash
# from a CURRENT main checkout (git pull --ff-only && npm install first —
# a stale checkout once shipped 6-week-old code), then:
cd apps/mobile
npx eas-cli build  --profile production --platform all    # AAB + IPA; autoIncrement bumps build numbers
npx eas-cli submit --profile production --platform ios    # → App Store Connect / TestFlight
npx eas-cli submit --profile production --platform android # → Play internal track
```

1. **TestFlight first (iOS has never run in production):** the submitted build
   appears in TestFlight → add yourself as internal tester (no beta review) →
   full smoke pass on a physical iPhone **and** an iPad: connect `demo`,
   login, video + audio lesson, progress ticks, certificate share, live
   session row, helpdesk round-trip, avatar upload (permission prompt), legal
   links, delete-account with a throwaway member, sign out / switch academy.
2. **Play internal track:** same pass on an Android phone (much lower risk —
   ten production builds already exist; the Android E2E pass vs the live
   fleet was done in August).
3. **Apple:** in App Store Connect fill everything in the listing pack, attach
   the build to the 1.0.0 version, set reviewer credentials + notes (App
   Review Information), select **manual release**, submit. Typical review:
   24–48 h.
4. **Play:** complete every "App content" task, then promote the internal
   release to **Production**. New-app review: typically 1–3 days, up to 7.

---

## 7. If review pushes back

| Guideline | Symptom | Response |
|---|---|---|
| Apple 2.1 (completeness) | "App is blank / can't proceed" | Reviewer creds broken or demo content thin — re-verify §5, reply with exact steps + a screen recording |
| Apple 3.1.1 (payments) | "App accesses paid content without IAP" | Point to 3.1.3: content is acquired outside the app by members of multiplatform academies; the app sells nothing, shows no prices, links to no checkout |
| Apple 4.2.6 / 4.3 | "Template/spam app" | §4.2 position: single official platform app by the platform operator; runtime tenant config, not a re-skin |
| Apple 5.1.1 | Privacy-policy issues | The URL must describe member data handling (§4.3) — this is why the lawyer pass is a gate |
| Play "app access" | "Couldn't review restricted features" | The App-access instructions/creds are stale — fix, re-verify, resubmit |

Rejections are conversations: fix or clarify in Resolution Center / reply,
resubmit — same-day turnarounds are common.

---

## 8. Release + post-launch operations

1. **Release:** Apple — release the approved build manually (skip phased
   release for v1.0.0; there is no install base to protect). Play — 100%
   production rollout for v1; use staged rollouts (10→50→100%) for later
   binary updates.
2. **JS vs native, forever after:** JS-only changes → OTA
   (`eas update --channel production`, or the console **Publish OTA** lane) —
   no store review. Anything native (new dependency, config plugin,
   permissions, icons/splash, SDK bump, `version` bump) → `eas build` +
   `eas submit` to **both** stores. OTA only reaches builds with the **same
   runtime version** (= `app.config.ts` `version`).
3. **Keep both store listings + reviewer creds current** — every binary
   resubmission is a fresh review with the same checklist.
4. **Force-update lever:** set `MIN_APP_VERSION` on instance API envs to make
   older binaries show the blocking "Update required" gate (fails open when
   unset). Use when an API change breaks old clients.
5. **Known gap, accepted for v1:** no crash/analytics SDK in the app. If
   wanted later, sentry-expo is a **native** change — bundle it with the next
   store build.
6. **Version discipline:** bump `app.config.ts` `version` (1.0.0 → 1.1.0) on
   the first native change after launch; build numbers auto-increment
   remotely; never hand-edit `ios.buildNumber` / `android.versionCode`.

---

## 9. GO/NO-GO — pre-submission gate

Submit only when every box ticks. Status as of **2026-09-07**:

**Code (all ✅ — verified this audit)**
- [x] No purchase UI/links/prices; billing portal removed
- [x] In-app legal links (Account + Login + Signup) → live URLs
- [x] In-app account deletion + public delete-account page
- [x] Photo-library-only permissions; export compliance pre-answered
- [x] No tracking/analytics/push; email/password auth only
- [x] ErrorBoundary; iPad layout; version handshake

**Owner / accounts**
- [ ] D-U-N-S number issued
- [ ] Apple Developer (org) active; Team ID known
- [ ] Play Console (org) verified
- [ ] Expo account 2FA enabled

**Content**
- [ ] Final app name confirmed (listing pack §1)
- [ ] Real icon / adaptive-icon / splash committed (specs §3.1)
- [ ] Screenshots captured (all 4–5 sets, §3.2)
- [ ] Listing copy + questionnaire answers signed off (listing pack)

**Legal (owner + lawyer)**
- [ ] `/privacy` + `/terms` lawyer-approved, amber placeholders removed
- [ ] Privacy policy covers the app's member data handling (§4.3)
- [ ] EU trader declaration info ready (address/email/phone for listings)

**Ops**
- [ ] `eas.json` submit profile filled; Play service-account JSON in place
- [ ] Reviewer account live + content-rich; creds in both consoles (§5)
- [ ] Seeded `member@example.com` on demo rotated
- [ ] TestFlight + internal-track smoke pass on real devices (§6)

---

## 10. Timeline + costs

| Item | Cost | Lead time |
|---|---|---|
| D-U-N-S | free | ~5–10 business days |
| Apple Developer (org) | $99/yr | 1 day – 2 weeks after D-U-N-S |
| Play Console (org) | $25 once | days |
| Art + screenshots + copy sign-off | owner time | 1–2 days, parallel |
| Lawyer pass on legal pages | varies | parallel — start day 1 |
| First iOS build + TestFlight pass | — | 1 day once Apple active |
| Apple review | — | 24–48 h typical |
| Play new-app review | — | 1–7 days |

**Realistic wall-clock from zero: 2–4 weeks, dominated by D-U-N-S + enrollment
+ legal.** Everything code-side is done today; the moment the accounts exist,
§2→§6 is about two working days.

---

## Appendix A — white-label (future) submission blocker

White-label (locked) builds resolve legal links from the academy's own web
domain — and the member web app has **no `/privacy` or `/terms` route** (the
CMS `[slug]` catch-all could serve admin-authored pages, but none are seeded).
Before the first white-label submission: seed per-academy legal pages (or add
real routes), or that build ships 404 legal links — an instant 5.1.1 problem.
Everything else in this runbook maps over (client-owned accounts, their own
D-U-N-S, their own listing pack).

## Appendix B — account-creation walkthrough (owner, hands-on)

**CONFIRMED 2026-09-07:** The Web Panda is a **registered company** → go
**Organization** on both stores (the correct route). One **D-U-N-S serves both
stores** — apply once. D-U-N-S not yet applied for → apply via Apple's free
tool (below). It is **not on the critical path**: art, legal, screenshots and
the reviewer account are all outstanding and take ~1–2 weeks too, so the
D-U-N-S wait overlaps them.

**Account identity — decided:** both developer accounts are owned by the
**legal company (thewebpaanda / its exact incorporated name)** — the D-U-N-S
issues to this entity and both stores verify against it. Spotlight Academy is a
product/tenant, **not** the account holder. Use **one durable company role
mailbox** (e.g. `appstore@thewebpaanda.com`, Zoho) for both: an Apple ID on
that email, and a Google account created with that same address for Play — not
a personal Gmail, not tied to one person. The **store app name** is a separate
listing field from the account owner: it is set to **Spotlight Academy**
(2026-09-08) while the account owner stays **thewebpaanda**. Because this is the
SHARED multi-tenant binary, naming it after one academy needs a positioning
call — see listing pack §11 (either Spotlight becomes the platform brand, or a
white-label locked build fits better). The account owner is unaffected either
way.

**Decision reference — entity type.** Registered company (Pvt Ltd/LLP/OPC) →
**Organization** on both stores. Sole proprietorship (Udyam/GST, not
incorporated) → Apple forces **Individual** (legal entities only for orgs;
convertible to Organization later without losing the app), while Play
**Organization** usually still works (D&B issues D-U-N-S to Udyam sole props
and Play keys off the D-U-N-S + matching documents). Going **without D-U-N-S**
(Apple Individual + Play Personal) is a poor fit for a registered company:
personal name shows as Apple seller, and a Play personal account must run a
closed test (12 testers × 14 consecutive days) before production — which eats
the time the D-U-N-S would have taken anyway.

**Prep (15 min):** exact legal name/address/phone as registered — every form
must match it character-for-character (mismatches cause week-long verification
loops); durable role emails on the domain (e.g. `dev@thewebpaanda.com`) for
the Apple ID and the Play owner Google account — not a personal Gmail; card
for $99 + $25; 2FA on the Apple ID (required), the Google account, and the
Expo account.

1. **D-U-N-S** — `developer.apple.com/enroll/duns-lookup/`. **Search first**
   (many Indian businesses already have one), else request via the same tool —
   free, ~5–10 business days. Decline every paid D&B India upsell. Answer
   D&B's verification call/email promptly; give it ~2 business days after
   issuance to sync before enrolling.
2. **Apple** — `developer.apple.com/programs/enroll/` with the 2FA'd role
   Apple ID. Organization: D-U-N-S + legal name + website + authority to
   sign; expect a verification call; 24 h–2 wks; pay $99 on the "Purchase"
   email. Individual (sole prop): same page, or the **Apple Developer iPhone
   app** (ID-scan; often ~48 h in India). Then in App Store Connect accept
   the free-app agreement and note the **Team ID**.
3. **Play** — `play.google.com/console/signup`. Organization: D-U-N-S +
   matching docs (Udyam/GST certificate if asked); exempt from the 12-tester
   rule. Personal fallback: 12 opted-in testers × 14 consecutive days of
   closed testing before production access (~3+ extra weeks). Pay $25;
   complete identity, email/phone, address, and website verification
   (DNS/Search Console on thewebpaanda.com). Developer email is always
   public; org/trader accounts also show address + phone on EU listings —
   use business contact details.

Nothing else blocks on these clocks — §§3–5 (art, lawyer, reviewer account,
screenshots) run in parallel. When done, fill `eas.json` (§2) with the Team
ID / Apple ID / ascAppId and the Play service-account JSON.
