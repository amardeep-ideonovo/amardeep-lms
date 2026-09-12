# Store Listing Pack — shared app (paste-ready)

Everything the consoles ask for, pre-filled. Owner: review/edit → tick off in
[`docs/store-launch-runbook.md`](store-launch-runbook.md) §9 → transcribe into
App Store Connect / Play Console. Character limits are noted where they bite;
all drafts below fit them. Placeholders you must fill are `<LIKE_THIS>`.

**Voice rule for every field:** never mention prices, purchasing, upgrading,
or "buy on the website" — the app is a companion for _existing members_
(runbook §4.1).

---

## 1. Identity (decide once)

| Field                  | Value                             | Notes                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Store listing name | **Spotlight Academy - LMS**       | Plain "Spotlight Academy" was **already taken** on the App Store (2026-09-12), so the owner used this variant. Changeable anytime before submission — dropping "LMS" for e.g. "Spotlight Academy Learning" reads better if reconsidered. |
| On-device app name     | **Spotlight Academy**             | `app.config.ts` `name` — the label under the icon. Does NOT need to be storewide-unique, so it stays the clean brand even though the store listing adds "- LMS". No code change needed.                                                  |
| Bundle id / package    | `com.thewebpaanda.lms`            | **Permanent after first upload.** Already configured.                                                                                                                                                                                    |
| Category               | Education (both stores)           | No secondary category needed.                                                                                                                                                                                                            |
| Price                  | Free, no in-app purchases         | Never toggle to paid.                                                                                                                                                                                                                    |
| Availability           | All countries (or owner's choice) | No export/crypto concerns (`usesNonExemptEncryption: false`).                                                                                                                                                                            |

## 2. Contact + URLs (both consoles)

| Field                          | Value                                                            | Notes                                                                                                |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Privacy policy URL             | `https://thewebpaanda.com/privacy`                               | Live (200). Must pass the lawyer/member-facing gate (runbook §4.3) before submission.                |
| Support URL (Apple)            | `https://thewebpaanda.com`                                       | ⚠ `/contact` is currently 404 on the platform site — use the homepage, or ship a contact page first. |
| Marketing URL (optional)       | `https://thewebpaanda.com`                                       |                                                                                                      |
| Developer email (Play, public) | `support@thewebpaanda.com`                                       | Mailbox exists (Zoho).                                                                               |
| Developer website (Play)       | `https://thewebpaanda.com`                                       |                                                                                                      |
| EU trader declaration (both)   | Declare **trader**; publish business name, address, email, phone | DSA requirement for EU visibility — owner supplies the address/phone; expect a verification step.    |

---

## 3. Apple-only text fields

**Subtitle** (28/30 chars):

> Your academy, in your pocket

**Promotional text** (≤170 chars, editable without review):

> Your academy's classes, lessons, live sessions and certificates — wherever you are.

**Keywords** (95/100 chars, comma-separated, no spaces — don't waste chars on
the brand or "app", both are indexed anyway):

> learning,courses,lessons,academy,education,training,certificates,classes,lms,membership,student

## 4. Play-only text fields

**Short description** (77/80 chars):

> Your academy's classes, lessons, certificates and live sessions — in one app.

---

## 5. Full description (both stores; Play limit 4000 — this is ~1500)

> **Positioning: Option A — Spotlight Academy is the platform brand** (chosen
> 2026-09-08). The copy frames Spotlight Academy as the app/platform; the
> academies are the schools that run on it. "thewebpaanda" stays the
> company / store-seller name, behind the scenes — it is not used in
> member-facing copy.

> Spotlight Academy is the learning app for students of online academies.
> Connect to your academy with its code and take your classes, lessons, live
> sessions and certificates anywhere.
>
> **Already a member? Start in seconds**
> • Enter your academy's connect code — it's in your welcome email and in your
> academy account
> • Sign in with your existing member login
> • Your academy's branding, classes and content load automatically
>
> **Everything you're enrolled in**
> • Browse your classes and courses, just like on the web
> • Watch video lessons, listen to audio lessons, and read rich lesson content
> • Pick up where you left off — progress syncs across your devices
>
> **Stay on track**
> • Course and lesson progress at a glance
> • Earn certificates when you complete a class — view, download and share them
> • Join scheduled live sessions right from the app
>
> **Help when you need it**
> • Built-in support: look up your classes, payments and certificates, or
> message your academy's team
> • Manage your profile and account in the app, including account deletion
>
> **Made for members**
> Spotlight Academy is for people already enrolled in an academy that runs on
> it. Access is provided by your academy — if yours uses Spotlight Academy,
> your connect code is in your welcome email.
>
> Questions? support@thewebpaanda.com

---

## 6. Data inventory — source of truth

This table is (a) the input for the lawyer extending the privacy policy with a
member-facing section, and (b) what both questionnaires below are answered
from. The app has **no analytics, no ads, no tracking SDKs, no push, no
location, no contacts access, no payment collection**; the session token lives
in the device keychain (SecureStore) and never leaves the device except to the
member's own academy API over HTTPS.

| Data             | When collected               | Purpose                          | Optional?    | Deletable?                                                                        |
| ---------------- | ---------------------------- | -------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| Name             | signup                       | account                          | required     | yes — in-app account deletion purges the account                                  |
| Email address    | signup / login               | account + auth                   | required     | yes                                                                               |
| Password         | signup / login               | auth (stored hashed server-side) | required     | yes                                                                               |
| Profile photo    | user-initiated avatar upload | profile                          | **optional** | yes                                                                               |
| Support messages | helpdesk                     | customer support                 | optional     | yes (operational records like email logs are retained as disclosed in the policy) |
| Lesson progress  | using courses                | app functionality                | inherent     | yes                                                                               |

## 7. Apple — App Privacy (exact selections)

Collect data? **Yes.** Everything below: **Linked to the user's identity**,
purpose **App Functionality**, used for tracking **No**. Every category not
listed: **not collected**.

| Category     | Type                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| Contact Info | Name; Email Address                                                       |
| User Content | Photos or Videos (optional avatar); Other User Content (support messages) |
| Identifiers  | User ID (account id)                                                      |
| Usage Data   | Product Interaction (lesson progress)                                     |

Also in App Store Connect:

- **Age rating questionnaire:** all content descriptors None; no gambling; no
  unrestricted web access (the only WebView shows academy-authored lesson
  embeds, it is not a browser) → lands at **4+**.
- **Content rights:** confirm you have rights (academy content is hosted under
  the platform's terms).
- **Export compliance:** auto-answered by the build (standard HTTPS only).

## 8. Play — Data safety (exact selections)

- Does your app collect or share user data? **Collects: Yes. Shares: No.**
- All data **encrypted in transit: Yes.**
- Can users request deletion? **Yes.**
  Deletion URL: `https://demo.thewebpaanda.com/delete-account` (live; a
  platform-level page is optional polish — runbook §4.3).

| Play category     | Type                  | Collected / Shared    | Optional?    | Purpose                     |
| ----------------- | --------------------- | --------------------- | ------------ | --------------------------- |
| Personal info     | Name                  | Collected, not shared | Required     | Account management          |
| Personal info     | Email address         | Collected, not shared | Required     | Account management          |
| Photos and videos | Photos                | Collected, not shared | **Optional** | App functionality           |
| Messages          | Other in-app messages | Collected, not shared | Optional     | App functionality (support) |
| App activity      | App interactions      | Collected, not shared | —            | App functionality           |

Everything else (location, financial, health, contacts, device IDs, crash
data): **not collected** — the app ships zero analytics/crash SDKs.

Other Play "App content" declarations:

- **Ads:** No ads.
- **App access:** "All or some functionality is restricted" → add the
  instructions + credentials from §9 (used by review **and** the pre-launch
  report).
- **Content rating (IARC):** education/utility category; all descriptors No;
  no user-to-user shared content (support chat is member↔academy staff, not
  social); no location sharing → **Everyone / PEGI 3**.
- **Target audience:** **18 and over** only; not appealing to children.
- **News app:** No. **COVID app:** No. **Government app:** No.
- **Financial features:** None.

## 9. Reviewer access — paste into BOTH consoles

Apple: App Review Information → notes + demo account. Play: App access →
instructions + credentials. Create the account first (runbook §5).

> Spotlight Academy is the official app of our learning platform (operated by
> our company, thewebpaanda.com). Members of any academy — a school that runs
> on the platform — sign in here. On first launch the app asks for the
> academy's connect code, then the member's login.
>
> 1. Connect code: **demo** → tap Continue (the app connects to our demo
>    academy).
> 2. Sign in: **<REVIEWER_EMAIL>** / **<REVIEWER_PASSWORD>**
>
> This member account has active enrollments, so classes, video/audio lessons,
> progress, certificates, live sessions and the built-in support helpdesk are
> all populated. Account deletion is in Profile → Delete account. Privacy
> Policy and Terms are linked on the Login screen and under Profile → More.
>
> The app sells nothing: it has no purchases, no prices and no links to any
> checkout. Members receive access through their academy (a multiplatform
> service); each academy is a tenant configured at runtime — Spotlight Academy
> is our platform's single official app, not a re-skinned template.

## 10. Screenshot shot-list (same 6, every device set)

Capture with the reviewer account on the demo academy (runbook §3.2 has sizes

- simulator recipe). Suggested captions if caption overlays are wanted:

| #   | Screen                               | Caption                                   |
| --- | ------------------------------------ | ----------------------------------------- |
| 1   | My Classes (dashboard, content-rich) | All your classes in one place             |
| 2   | Class detail (hero + lesson list)    | Structured courses and lessons            |
| 3   | Video lesson playing                 | Learn anywhere                            |
| 4   | Certificates                         | Earn certificates as you complete classes |
| 5   | Helpdesk home                        | Help built in                             |
| 6   | Connect screen                       | One app — enter your academy's code       |

**Play feature graphic** (1024×500, console upload): flat brand tile — ink
`#101014` background, teal accent, app name + "Your academy, in your pocket".
No screenshots or device frames needed in it.

**Play hi-res icon** (512×512): export from the final 1024 icon art.

---

## 11. Positioning — DECIDED: Option A, Spotlight Academy is the platform brand

**Owner decision 2026-09-08: Option A.** Spotlight Academy is the consumer /
platform brand for the whole learning app; academies are the schools that run
on it. **thewebpaanda** stays the company and store-seller name, behind the
scenes — kept out of member-facing copy. No build-mode change: the app stays
the shared connect-code binary. Copy in §5 and the reviewer notes in §9 already
reflect this.

Follow-through this decision creates:

1. **App art must be Spotlight-branded** — the icon and splash the owner
   supplies (runbook §3.1) carry the **Spotlight Academy** identity, not a
   thewebpaanda mark. This is what a member sees before connecting.
2. **Privacy policy names the app** — the lawyer pass (runbook §4.3) should
   state that the app/service is "Spotlight Academy," operated by the company
   (thewebpaanda). The policy still lives at `thewebpaanda.com/privacy`.
3. **Apple name uniqueness** — "Spotlight Academy" is generic and may already
   be taken storewide; reserve it in App Store Connect early (creating the app
   record claims it) and keep a fallback like "Spotlight Academy — Learning".
4. **Demo academy display name** — the reviewer flow uses connect code `demo`;
   the live resolver currently returns "Demo Instance". Rename that academy to
   something on-brand (e.g. a sample school name) so a reviewer sees Spotlight
   Academy → a clearly-named school, not an unrelated "Demo Instance".
5. **Optional — support address** — `support@thewebpaanda.com` still works, but
   a Spotlight-branded alias reads more consistently to members if you want it.
