// Central runtime config. Set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WEB_ACCOUNT_URL
// to override (e.g. the Render API for release builds, or 10.0.2.2 for the
// Android emulator which maps that to the host's localhost). Defaults to local dev.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

// Members manage billing/account on the web (Apple/Google IAP rules forbid in-app billing).
export const WEB_ACCOUNT_URL =
  process.env.EXPO_PUBLIC_WEB_ACCOUNT_URL ?? "http://localhost:3001/account";
