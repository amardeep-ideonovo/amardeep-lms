// Central runtime config. Override API_BASE_URL / WEB_ACCOUNT_URL for prod builds
// (e.g. via app config `extra` + expo-constants). Defaults target local dev.
export const API_BASE_URL = "http://localhost:3000";

// Members manage billing/account on the web (Apple/Google IAP rules forbid in-app billing).
export const WEB_ACCOUNT_URL = "http://localhost:3001/account";
