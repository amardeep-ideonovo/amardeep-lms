// Central runtime config. Two build flavors share this file:
//
// LOCKED builds (white-label per-instance apps + local dev with env set):
//   EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WEB_ACCOUNT_URL are baked at bundle time
//   and the app is permanently bound to that one instance — no picker.
//
// SHARED builds (the store app that serves many instances):
//   No EXPO_PUBLIC_API_URL is baked. The app starts on the Connect screen and
//   resolves a client's "connect code" against the licensing control plane
//   (EXPO_PUBLIC_DIRECTORY_URL), then persists the binding in SecureStore.
//
// API_BASE_URL / WEB_ACCOUNT_URL / WEB_BASE_URL are `export let` on purpose:
// Babel compiles them to live bindings, so every existing call site reads the
// value current at call time — binding an instance at runtime "just works".
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const BAKED_API_URL = process.env.EXPO_PUBLIC_API_URL ?? null;
const BAKED_WEB_ACCOUNT_URL = process.env.EXPO_PUBLIC_WEB_ACCOUNT_URL ?? null;

// Locked = this binary serves exactly one instance (white-label / dev).
export const IS_LOCKED_BUILD = BAKED_API_URL != null;

// Control plane the shared app resolves connect codes against.
export const DIRECTORY_URL = (
  process.env.EXPO_PUBLIC_DIRECTORY_URL ?? ""
).replace(/\/$/, "");

export type InstanceBinding = {
  apiUrl: string; // instance API origin
  webUrl: string; // member website origin (account/billing links)
  code?: string; // connect code the user entered (subdomain or instance id)
  name?: string; // instance display name at connect time (cosmetic)
};

function accountUrlFrom(webUrl: string): string {
  return `${webUrl.replace(/\/$/, "")}/account`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export let API_BASE_URL = BAKED_API_URL ?? "";
export let WEB_ACCOUNT_URL =
  BAKED_WEB_ACCOUNT_URL ?? (BAKED_API_URL ? "http://localhost:3002/account" : "");
export let WEB_BASE_URL = WEB_ACCOUNT_URL ? originOf(WEB_ACCOUNT_URL) : "";

export function isBound(): boolean {
  return API_BASE_URL !== "";
}

// ---------- per-instance storage namespacing ----------
// One shared binary can serve different instances over its lifetime; tokens and
// cached branding must never leak across instances. Keys are suffixed with a
// sanitized form of the instance API host (SecureStore allows [A-Za-z0-9._-]).
export function storageScope(): string {
  const base = API_BASE_URL.replace(/^https?:\/\//, "");
  return base.replace(/[^A-Za-z0-9._-]/g, "-") || "unbound";
}

export function scopedKey(base: string): string {
  return `${base}.${storageScope()}`;
}

// ---------- binding persistence (shared builds) ----------
const BINDING_KEY = "lms.instance.binding";
const isWeb = Platform.OS === "web";

function applyBinding(b: InstanceBinding): void {
  API_BASE_URL = b.apiUrl.replace(/\/$/, "");
  WEB_ACCOUNT_URL = accountUrlFrom(b.webUrl);
  WEB_BASE_URL = originOf(b.webUrl);
}

export async function loadInstanceBinding(): Promise<InstanceBinding | null> {
  if (IS_LOCKED_BUILD) {
    return { apiUrl: API_BASE_URL, webUrl: WEB_BASE_URL };
  }
  try {
    const raw = isWeb
      ? typeof localStorage !== "undefined"
        ? localStorage.getItem(BINDING_KEY)
        : null
      : await SecureStore.getItemAsync(BINDING_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as InstanceBinding;
    if (!b?.apiUrl || !b?.webUrl) return null;
    applyBinding(b);
    return b;
  } catch {
    return null;
  }
}

export async function bindInstance(b: InstanceBinding): Promise<void> {
  applyBinding(b);
  const raw = JSON.stringify(b);
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.setItem(BINDING_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(BINDING_KEY, raw);
}

export async function unbindInstance(): Promise<void> {
  API_BASE_URL = "";
  WEB_ACCOUNT_URL = "";
  WEB_BASE_URL = "";
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(BINDING_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(BINDING_KEY);
}
