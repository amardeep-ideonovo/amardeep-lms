# Shipping the mobile app (iOS App Store + Google Play)

> **✅ Step 0 — DONE (2026-06-11): the app is on Expo SDK 56** (RN 0.85 /
> React 19.2, targetSdk 36, EAS default image Xcode 26.4) — satisfies both
> store gates: Google Play target API 35+/36 and Apple's Xcode 26 / iOS 26 SDK
> requirement. The upgrade also replaced expo-av with expo-video, the legacy
> file-system API with the new File/Directory API, and
> react-native-render-html with the in-house `HtmlView`.
> **Note:** SDK 51 development clients can NOT load the new runtime — rebuild
> the dev client (`npx expo run:android` / `run:ios`, or
> `eas build --profile development`) before local device testing. Building
> `run:ios` locally requires full Xcode 26.4 (Command Line Tools alone are
> not enough); without it, use the EAS development profile (its
> `ios.simulator: true` produces a simulator build in the cloud).

The steps below need **your** accounts / credentials — fill the placeholders
in `eas.json`, then build & submit.

## 1. Brand assets (now automatic)

EAS builds pull the admin-uploaded icon/splash (Admin → App Customization,
**PNG only**) into the binary via the `eas-build-pre-install` hook — see
[assets/README.md](assets/README.md). If those fields are unset, the checked-in
files ship instead; manual replacement (same filenames) remains the fallback.

## 2. Server URLs — shared build vs white-label — REQUIRED reading

The STORE build is the SHARED "connect to your academy" app. It must **NOT**
bake `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_WEB_ACCOUNT_URL` — baking an API URL
locks the binary to ONE academy (see `src/config.ts`), which is the
white-label path, not the store app. The committed `eas.json` preview and
production profiles are already correct for the shared app: they set only
`EXPO_PUBLIC_DIRECTORY_URL` + `EXPO_PUBLIC_FLEET_DOMAIN`, which drive the
connect flow.

**White-label (single-academy) builds only:** set `EXPO_PUBLIC_API_URL` (the
academy's API base, HTTPS) and `EXPO_PUBLIC_WEB_ACCOUNT_URL` (its member-web
`/account` URL) via that client's own EAS profile or dashboard env — never in
the committed preview/production profiles.

## 3. Apple (App Store)

- Apple Developer account; register the bundle id `com.thewebpaanda.lms`.
- Create the app record in App Store Connect.
- In `eas.json` → `submit.production.ios`, set `appleId`, `ascAppId`,
  `appleTeamId`.
- `eas build` will create/manage signing credentials (or supply your own).

## 3b. Tablets (iPad + Android tablets)

The app is a universal iPhone + iPad app (`supportsTablet: true`) and Android
tablets rotate freely (phones stay portrait-locked — see `src/responsive.ts`).
Consequences for store submission:

- **Apple reviews on iPad** and the listing requires **13" iPad screenshots
  (2064×2752)** in addition to the iPhone set. Capture on the
  "iPad Pro 13-inch" simulator.
- **Play**: upload 7"/10" tablet screenshots so the listing qualifies for
  tablet surfacing (large-screen quality guidelines).
- Orientation/tablet settings are **native config** — changing them ships only
  in a new store binary (`eas build`), never over OTA.

## 4. Google (Play)

- Create the app in Google Play Console under `com.thewebpaanda.lms`.
- Create a Play **service-account JSON** and save it as
  `apps/mobile/play-service-account.json` (already gitignored). It is referenced
  by `eas.json` → `submit.production.android.serviceAccountKeyPath`.
- EAS manages the upload keystore (or upload your own).

## 5. Build & submit (from `apps/mobile`)

```bash
eas build  --profile preview    --platform all   # internal test (APK + ad-hoc / TestFlight)
eas build  --profile production --platform all   # store builds (AAB + App Store)
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

## 6. App privacy questionnaire

Both stores ask about data collection. This app collects: account **email + name**
(login/signup) and **lesson progress**; **no tracking, no ads**. The auth token is
stored in the device keychain (SecureStore). Declare accordingly. Export compliance
is pre-answered via `app.json` (`ios.config.usesNonExemptEncryption: false` — HTTPS
only, no custom crypto).

Account deletion (required by both stores because the app has in-app signup) is
built: members delete from the in-app Account screen, and the public page is
`https://<member-web>/delete-account` — use that URL in the Play Data-safety form.

## 7. OTA updates & code signing — updates ship UNSIGNED

The app ships expo-updates (OTA) so JS-only fixes go out without a store review.
Publish an update with:

```
eas update --channel production --message "…"
```

(The operator console's **Publish OTA** lane does exactly this — it runs the
preflight, then dispatches the `ota.yml` workflow.)

**OTA bundles are UNSIGNED, on purpose.** EAS Update code signing requires the
**EAS Enterprise plan** — EAS rejects a signed publish without it. Worse, a build
that _arms_ signing (a `codeSigningCertificate` in `app.config.ts`) then rejects
every UNSIGNED update, so it can never receive an OTA — that is what bricked the
v6 build. So there is deliberately:

- **no** `codeSigningCertificate` in `app.config.ts` (and no env conditional that
  could re-arm one — do NOT set `EXPO_PUBLIC_CODE_SIGNING_CERT`),
- **no** committed certificate (`certs/certificate.pem` was removed),
- **no** `--private-key-path` on publish.

Security tradeoff: an unsigned channel means a compromised Expo/EAS account could
push JS to installed apps, so account hygiene (hardware-key MFA, a scoped
`EXPO_TOKEN`, restricted workflow dispatch) is the control. Accept this until the
account is on Enterprise.

**To enable signing later (once on EAS Enterprise):** generate a per-project cert
and key —

```
npx expo-updates codesigning:generate --key-output-directory keys \
  --certificate-output-directory certs --certificate-validity-duration-years 10 \
  --certificate-common-name "thewebpaanda LMS"
npx expo-updates codesigning:configure …
```

— add `codeSigningCertificate` + `{ keyid, alg }` back to the `updates` block in
`app.config.ts`, upload the private key as an EAS secret, publish with
`--private-key-path`, and **cut a fresh store build** (a signed binary can't be
introduced by OTA). Back the private key up like the Android upload keystore: if
it is lost after a signed binary ships, installs reject every future OTA and you
need a full store re-release with a fresh cert.

Native changes (new dependencies, config plugins, permission changes, SDK bumps)
still require a new store build + submit — OTA only ships JS/asset changes for the
SAME runtime version (`runtimeVersion.policy: "appVersion"`, currently 1.0.0).
