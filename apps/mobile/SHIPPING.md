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
