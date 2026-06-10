# Shipping the mobile app (iOS App Store + Google Play)

> **⚠️ Step 0 — upgrade the Expo SDK first.** As of mid-2026 neither store
> accepts builds from Expo SDK 51 (this app's current SDK): Google Play
> requires target API 35+ for new apps/updates (API 36 from Aug 31, 2026), and
> Apple requires Xcode 26 / iOS 26 SDK builds since Apr 28, 2026. Upgrade to
> the newest Expo SDK before building for the stores. The upgrade also forces
> the expo-av → expo-video migration (expo-av is removed in SDK 54; used in
> `LessonScreen` and `PageRenderer`).

The steps below need **your** accounts / credentials — fill the placeholders
in `eas.json`, then build & submit.

## 1. Replace placeholder assets
See [assets/README.md](assets/README.md): swap `icon.png`, `adaptive-icon.png`,
and `splash.png` for real brand art (keep the same filenames).

## 2. Set the production API URL — REQUIRED
The app currently points at placeholder URLs. In `eas.json`, under
`build.preview.env` **and** `build.production.env`, set:
- `EXPO_PUBLIC_API_URL` — your deployed API base (e.g. the Render URL), HTTPS.
- `EXPO_PUBLIC_WEB_ACCOUNT_URL` — the member web `/account` URL, HTTPS.

(Or set them as EAS environment variables / secrets in the Expo dashboard.)

## 3. Apple (App Store)
- Apple Developer account; register the bundle id `com.lms.mobile`.
- Create the app record in App Store Connect.
- In `eas.json` → `submit.production.ios`, set `appleId`, `ascAppId`,
  `appleTeamId`.
- `eas build` will create/manage signing credentials (or supply your own).

## 4. Google (Play)
- Create the app in Google Play Console under `com.lms.mobile`.
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
