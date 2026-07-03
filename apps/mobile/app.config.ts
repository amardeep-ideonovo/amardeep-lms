import type { ExpoConfig } from "expo/config";

// Dynamic app config. Defaults reproduce the shared/dev app exactly; a
// WHITE-LABEL per-instance build overrides identity via INSTANCE_* env at
// build time (set by the control plane's build pipeline alongside
// EXPO_PUBLIC_API_URL, which locks the binary to its instance):
//
//   INSTANCE_APP_NAME        display name under the icon (store name)
//   INSTANCE_SLUG            Expo slug (one per white-label app)
//   INSTANCE_SCHEME          deep-link scheme (one per app, e.g. "acme")
//   INSTANCE_IOS_BUNDLE_ID   store-unique, registered in the CLIENT's Apple account
//   INSTANCE_ANDROID_PACKAGE store-unique, registered in the CLIENT's Play account
//   INSTANCE_EAS_PROJECT_ID  each white-label app has its own EAS project
//   INSTANCE_EAS_OWNER       Expo account that owns that project
//
// Icon/splash are NOT env: scripts/sync-brand-assets.js (eas-build-pre-install)
// overwrites ./assets/* from the instance's GET /app/config before prebuild.
const config = (): ExpoConfig => ({
  name: process.env.INSTANCE_APP_NAME ?? "LMS",
  slug: process.env.INSTANCE_SLUG ?? "lms-mobile",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  scheme: process.env.INSTANCE_SCHEME ?? "lms",
  plugins: [
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#100c1b",
      },
    ],
    "expo-font",
    [
      "expo-image-picker",
      {
        photosPermission:
          "Allow $(PRODUCT_NAME) to access your photos so you can set a profile picture.",
      },
    ],
  ],
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: process.env.INSTANCE_IOS_BUNDLE_ID ?? "com.lms.mobile",
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    // Its own env — do NOT fall back to the iOS bundle id: iOS identifiers
    // allow characters (e.g. hyphens) that are illegal in an Android package.
    package: process.env.INSTANCE_ANDROID_PACKAGE ?? "com.lms.mobile",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#100c1b",
    },
  },
  web: {
    bundler: "metro",
  },
  extra: {
    eas: {
      projectId:
        process.env.INSTANCE_EAS_PROJECT_ID ??
        "0f8efe5e-4424-495d-b4f3-2fe852ff9e90",
    },
  },
  owner: process.env.INSTANCE_EAS_OWNER ?? "amardeeplms",
});

export default config;
