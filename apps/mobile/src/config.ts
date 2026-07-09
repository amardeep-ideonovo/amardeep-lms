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

// `|| null` (not `?? null`): an empty EXPO_PUBLIC_API_URL must mean "shared
// build", not a locked build hard-wired to an empty API base.
const BAKED_API_URL = process.env.EXPO_PUBLIC_API_URL || null;
const BAKED_WEB_ACCOUNT_URL = process.env.EXPO_PUBLIC_WEB_ACCOUNT_URL || null;

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
// cached branding must never leak across instances. The scope keeps the scheme
// so http:// and https:// origins never collapse into one namespace.
export function storageScope(): string {
  return API_BASE_URL.replace(/[^A-Za-z0-9._-]/g, "-") || "unbound";
}

export function scopedKey(base: string): string {
  // A LOCKED build serves exactly one instance for the life of the binary, so
  // it keeps the ORIGINAL un-namespaced keys — namespacing them would log out
  // (and orphan the keychain entries of) every existing install on the update
  // that ships this change. Only SHARED builds, which switch instances, need
  // the per-instance suffix.
  return IS_LOCKED_BUILD ? base : `${base}.${storageScope()}`;
}

// ---------- binding persistence (shared builds) ----------
const BINDING_KEY = "lms.instance.binding";
const isWeb = Platform.OS === "web";

// Storage base for the member auth token. Single source of truth shared with
// api.ts so "Switch academy" (unbindInstance) can clear the exact scoped key.
export const AUTH_TOKEN_BASE = "lms.auth.token";

// The app POSTs the member's credentials + session token to the bound origin,
// so in a release build that origin MUST be https. http is allowed only in dev
// (localhost testing). Blocks a mistyped / social-engineered http:// origin from
// exfiltrating the login over cleartext, and is the last-line check even if the
// resolver response is ever tampered.
export function isAllowedInstanceUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    if (proto === "https:") return true;
    // Metro defines __DEV__ as a runtime global; read it via globalThis so this
    // stays type-safe without an ambient declaration. http only in dev.
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    return dev && proto === "http:";
  } catch {
    return false;
  }
}

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
    // Drop a stored binding that isn't https (in prod) — forces a re-connect
    // rather than silently reusing a cleartext origin.
    if (!isAllowedInstanceUrl(b.apiUrl) || !isAllowedInstanceUrl(b.webUrl)) {
      return null;
    }
    applyBinding(b);
    return b;
  } catch {
    return null;
  }
}

export async function bindInstance(b: InstanceBinding): Promise<void> {
  if (!isAllowedInstanceUrl(b.apiUrl) || !isAllowedInstanceUrl(b.webUrl)) {
    throw new Error("This academy must use a secure (https) address.");
  }
  applyBinding(b);
  const raw = JSON.stringify(b);
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.setItem(BINDING_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(BINDING_KEY, raw);
}

// The InstanceGate registers here so "Switch academy" (LoginScreen) can drop
// the binding and land back on the Connect screen without an app restart.
let unbindListener: (() => void) | null = null;
export function setUnbindListener(fn: (() => void) | null): void {
  unbindListener = fn;
}

export async function unbindInstance(): Promise<void> {
  // Clear the current instance's auth token FIRST, while API_BASE_URL still
  // resolves the scoped key — otherwise "Switch academy" would leave the
  // previous member's session token at rest in the Keychain and silently
  // re-activate it on reconnect (a shared-device leak). This makes the switch a
  // real sign-out for that academy.
  const tokenKey = scopedKey(AUTH_TOKEN_BASE);
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(tokenKey);
  } else {
    await SecureStore.deleteItemAsync(tokenKey);
  }

  API_BASE_URL = "";
  WEB_ACCOUNT_URL = "";
  WEB_BASE_URL = "";
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(BINDING_KEY);
  } else {
    await SecureStore.deleteItemAsync(BINDING_KEY);
  }
  unbindListener?.();
}
