import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "./api";
import { isBound, scopedKey, setPushCleanup } from "./config";

// Per-device, per-instance push preference. Persisted so an explicit "off" in the
// Account toggle survives cold start / sign-in and is NOT overwritten by the
// automatic re-register. null = never set (default: follow OS permission).
const PUSH_PREF_BASE = "lms.push.enabled";

async function readPushPref(): Promise<boolean | null> {
  if (Platform.OS === "web") return null;
  try {
    const v = await SecureStore.getItemAsync(scopedKey(PUSH_PREF_BASE));
    return v == null ? null : v === "1";
  } catch {
    return null;
  }
}

async function writePushPref(on: boolean): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(scopedKey(PUSH_PREF_BASE), on ? "1" : "0");
  } catch {
    // best-effort
  }
}

// Foreground presentation: show the banner even while the app is open. Set once
// at module load (App.tsx imports this file) — Expo requires the handler before
// the first notification is delivered. Badge is off: P0 has no member inbox to
// source an authoritative unread count from.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// De-register the outgoing academy's token when the app unbinds an instance
// (Switch academy / delete-account). Wired here so importing this module is all
// it takes; config.ts calls it at the top of unbindInstance, while the token +
// API_BASE_URL still resolve.
setPushCleanup(unregisterPushForCurrentInstance);

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

// The Expo push token for THIS device, or null on a simulator / when it can't be
// minted. getExpoPushTokenAsync needs the EAS projectId in a bare/managed build.
async function currentExpoToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  try {
    const pid = easProjectId();
    const { data } = await Notifications.getExpoPushTokenAsync(
      pid ? { projectId: pid } : undefined,
    );
    return data;
  } catch {
    return null;
  }
}

// Register this device against the CURRENTLY bound academy. Only when permission
// is already granted (the toggle / prime asks first) and an instance is bound —
// registration hits the live API_BASE_URL, so it always targets the right tenant.
// Best-effort: never throws into the caller.
export async function registerPushForCurrentInstance(): Promise<void> {
  try {
    if (!isBound()) return;
    // Respect an explicit "off" — never auto-re-register against the member's
    // choice. (null/unset falls through: first run registers when permitted.)
    if ((await readPushPref()) === false) return;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const token = await currentExpoToken();
    if (!token) return;
    await api.registerPushToken(
      token,
      Platform.OS,
      Constants.expoConfig?.version ?? undefined,
    );
  } catch {
    // best-effort
  }
}

// De-register this device from the CURRENTLY bound academy. Call BEFORE the
// binding is torn down (sign-out / academy switch) so the bearer + API_BASE_URL
// still resolve; otherwise the token leaks into the next academy.
export async function unregisterPushForCurrentInstance(): Promise<void> {
  try {
    if (!isBound()) return;
    const token = await currentExpoToken();
    if (!token) return;
    await api.unregisterPushToken(token).catch(() => {});
  } catch {
    // best-effort
  }
}

// Toggle "on": prompt for permission if needed, persist the choice, then
// register. Returns whether push is now enabled. Mirrors the just-in-time
// ImagePicker consent pattern.
export async function enablePush(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    const perm = existing.granted
      ? existing
      : await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    await writePushPref(true);
    await registerPushForCurrentInstance();
    return true;
  } catch {
    return false;
  }
}

// Toggle "off": persist the choice (so cold-start won't re-register) and
// de-register this device.
export async function disablePush(): Promise<void> {
  await writePushPref(false);
  await unregisterPushForCurrentInstance();
}

// Initial state for the Account toggle: the saved preference if the member set
// one, otherwise whether the OS permission is granted.
export async function pushEnabledState(): Promise<boolean> {
  try {
    const pref = await readPushPref();
    if (pref !== null) return pref;
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
