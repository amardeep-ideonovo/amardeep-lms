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

## 7. OTA updates & code signing — ⚠ BACK UP THE PRIVATE KEY

The app ships expo-updates (OTA) so JS-only fixes go out without a store review.
The signing **certificate** is committed at `certs/certificate.pem` and baked into
every build via `EXPO_PUBLIC_CODE_SIGNING_CERT` (set in `eas.json` preview +
production). The app verifies each OTA bundle's signature against it, so a
compromised Expo/EAS account alone can't push malicious JS to installed apps.

The matching **private key** was generated at `keys/private-key.pem` and is
**gitignored — it is NOT in the repo**. You MUST:

1. **Back it up now** (password manager / secure store) AND upload it as an EAS
   secret, e.g. `eas env:create --name EXPO_UPDATES_PRIVATE_KEY --type file \
--value ./keys/private-key.pem --visibility secret`.
2. Publish signed OTA updates with it:
   `eas update --channel production --private-key-path keys/private-key.pem`.

**If this private key is lost after a signed binary has shipped, existing installs
will REJECT every future OTA update** (signature mismatch) and you'd need a full
store re-release with a fresh cert. Treat it like the Android upload keystore.

To rotate or regenerate (pre-launch only, before any signed binary ships):
`npx expo-updates codesigning:generate --key-output-directory keys \
  --certificate-output-directory certs --certificate-validity-duration-years 10 \
  --certificate-common-name "thewebpaanda LMS"`

Native changes (new dependencies, config plugins, SDK bumps) still require a new
store build + submit — OTA only ships JS/asset changes for the SAME runtime
version (`runtimeVersion.policy: "appVersion"`, currently 1.0.0).
