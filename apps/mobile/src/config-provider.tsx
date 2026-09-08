import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import type { AppConfig } from "@lms/types";

import { api } from "./api";
import {
  APP_CONFIG_CACHE_BASE,
  boundName,
  IS_LOCKED_BUILD,
  scopedKey,
} from "./config";
import { DEFAULT_APP_CONFIG, isCompleteAppConfig, pickBrandTitle } from "./theme";

// Namespaced per instance (see config.ts) so a shared binary never paints one
// instance with another instance's cached branding. The key BASE is shared
// with the boot splash, which reads this cache before the scope is applied.
const configKey = () => scopedKey(APP_CONFIG_CACHE_BASE);

// ---- app <-> API version handshake ----
// The API injects apiVersion/minAppVersion into GET /app/config. The app
// compares them here so version skew gates gracefully (a friendly screen)
// instead of breaking silently on missing endpoints.
//
// Bump REQUIRED_API_VERSION only in lockstep with a fleet image upgrade: it is
// the oldest instance API this app build is known to work against. Instances
// that predate the handshake report no apiVersion and are never gated.
const REQUIRED_API_VERSION = "0.0.0";
// null when the runtime can't report this app's version — in that case we must
// NOT gate (fail open), or a version we can't even read would brick the app.
const APP_VERSION_RAW = Constants.expoConfig?.version ?? null;
const APP_VERSION = APP_VERSION_RAW ?? "0.0.0";

const hasDigits = (v: string) => /\d/.test(v);

// Segment-wise numeric compare. Both operands here are semver-ish app versions
// ("0.1.0"); missing segments count as 0. Callers must pre-check hasDigits so a
// non-version string never silently compares as 0.0.0.
function versionAtLeast(actual: string, required: string): boolean {
  const parse = (v: string) =>
    (v.match(/\d+/g) ?? []).slice(0, 3).map((n) => parseInt(n, 10));
  const a = parse(actual);
  const r = parse(required);
  for (let i = 0; i < Math.max(a.length, r.length); i++) {
    const x = a[i] ?? 0;
    const y = r[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export type VersionCompat = {
  apiOutdated: boolean; // instance API is older than this app build supports
  appOutdated: boolean; // API demands a newer app build (store/OTA update)
};

// Both gates FAIL OPEN: they only trip on a well-formed version we can actually
// compare. A misconfigured/garbled minAppVersion, an unknown app version, or an
// empty apiVersion must never brick the app (recovery would need a reinstall).
function compatOf(config: AppConfig): VersionCompat {
  const apiVersion = config.apiVersion || null;
  const minAppVersion = config.minAppVersion || null;
  return {
    apiOutdated:
      REQUIRED_API_VERSION !== "0.0.0" &&
      apiVersion != null &&
      hasDigits(apiVersion) &&
      !versionAtLeast(apiVersion, REQUIRED_API_VERSION),
    appOutdated:
      APP_VERSION_RAW != null &&
      minAppVersion != null &&
      hasDigits(minAppVersion) &&
      !versionAtLeast(APP_VERSION, minAppVersion),
  };
}

// The handshake fields are evaluated live, never persisted — a bad
// minAppVersion cached from one bad response must not keep gating offline cold
// starts. Strip them before caching branding.
function stripVersionFields(config: AppConfig): AppConfig {
  const { apiVersion: _a, minAppVersion: _m, ...rest } = config;
  return rest;
}

type ConfigState = {
  config: AppConfig;
  loading: boolean; // true until the first cache/network resolution
  compat: VersionCompat;
};

const ConfigContext = createContext<ConfigState | undefined>(undefined);

// Cache the last-known config so the app paints with the correct branding
// instantly on the next launch (and stays branded offline). Mirrors api.ts'
// token storage: SecureStore on native, localStorage on web.
const isWeb = Platform.OS === "web";

async function readCache(): Promise<AppConfig | null> {
  try {
    const raw = isWeb
      ? typeof localStorage !== "undefined"
        ? localStorage.getItem(configKey())
        : null
      : await SecureStore.getItemAsync(configKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    // Reject a cached config whose palettes aren't complete — an older app
    // version's palette schema, or a truncated write. Seeding a partial palette
    // into the theme crashes the app on launch (see theme.ts hexToHsl), and the
    // only recovery would be clearing app data. Dropping the cache falls back to
    // DEFAULT_APP_CONFIG; the live fetch then repopulates the real branding.
    return isCompleteAppConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(config: AppConfig): Promise<void> {
  try {
    const raw = JSON.stringify(config);
    if (isWeb) {
      if (typeof localStorage !== "undefined")
        localStorage.setItem(configKey(), raw);
    } else {
      await SecureStore.setItemAsync(configKey(), raw);
    }
  } catch {
    // best-effort cache; never block on it
  }
}

// Pre-seed the branding cache for the JUST-BOUND instance (called from
// ConnectScreen with the /app/config it already fetched to validate the code).
// Runs AFTER bindInstance, so configKey() resolves to the new instance's scope.
// The next launch — and ConfigProvider's own first readCache — then paint the
// real branding instantly instead of flashing the default. Best-effort and
// gated on a complete palette (same guard readCache applies), so a partial
// payload can never poison the cache.
export async function seedConfigCache(cfg: AppConfig): Promise<void> {
  if (isCompleteAppConfig(cfg)) await writeCache(stripVersionFields(cfg));
}

// The brand name to render on member surfaces (login, header, account). An
// academy that hasn't set a custom title serves the generic product default
// ("Spotlight Academy") from GET /app/config, which would otherwise leak the
// operator brand onto every un-customized academy. So: a real custom title
// wins; otherwise fall back to the bound academy's true name (from the connect
// code, boundName()); otherwise a neutral generic. The default title is the
// "unset" sentinel — compared against DEFAULT_APP_CONFIG.title.
export function resolveBrandTitle(config: AppConfig): string {
  // Shared app = our product, so its honest deep default IS the operator brand;
  // a white-label / locked build is a client's own app and must NEVER show the
  // operator brand, so it degrades to a neutral generic instead.
  const fallback = IS_LOCKED_BUILD ? "Academy" : DEFAULT_APP_CONFIG.title;
  return pickBrandTitle(config.title, boundName(), fallback);
}

// How long a first launch (no cache yet) may hold the splash gate waiting for
// the config fetch. A black-holing network (captive portal, dead VPN) never
// errors, so without this cap the app would spin until the OS socket timeout.
const GATE_CAP_MS = 4000;

// While the app is foregrounded, re-check the config on this cadence so an
// admin's Save restyles open apps within one tick. The payload is ~600 B and
// the interval is cleared in the background, so the cost is negligible.
const POLL_MS = 30_000;

// Loads the admin's app-customization config. The first-paint gate releases at
// the EARLIEST of: cache read (last-known branding is correct enough), fetch
// settled, or GATE_CAP_MS. The fetch always continues in the background and
// re-themes reactively when it lands; a failure keeps cached/default branding.
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  // `config` holds ONLY branding (version-handshake fields stripped): those
  // change on every response, so keeping them out means the theme rebuilds only
  // when branding actually changes — no guaranteed re-theme on every launch.
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [compat, setCompat] = useState<VersionCompat>(() =>
    compatOf(DEFAULT_APP_CONFIG),
  );
  const [loading, setLoading] = useState(true);
  // Ref mirrors so applyFresh can compare without being re-created (and
  // re-arming the poll effect) on every state change.
  const configRef = useRef(config);
  configRef.current = config;
  const compatRef = useRef(compat);
  compatRef.current = compat;

  // Apply a freshly fetched config: theme from the stripped branding, track the
  // version handshake in `compat` separately, and re-set only what changed — so
  // a poll tick (or a launch) with identical branding never re-renders the
  // themed tree. Silent on failure (offline keeps the last-known config).
  const applyFresh = useCallback((fresh: AppConfig) => {
    const branding = stripVersionFields(fresh);
    if (JSON.stringify(branding) !== JSON.stringify(configRef.current)) {
      setConfig(branding);
      void writeCache(branding); // already stripped
    }
    const nextCompat = compatOf(fresh);
    if (JSON.stringify(nextCompat) !== JSON.stringify(compatRef.current)) {
      setCompat(nextCompat);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyFresh(await api.appConfig());
    } catch {
      // offline / API down — keep the current config
    }
  }, [applyFresh]);

  useEffect(() => {
    let alive = true;
    const cap = setTimeout(() => {
      if (alive) setLoading(false);
    }, GATE_CAP_MS);
    (async () => {
      const cached = await readCache();
      if (alive && cached) {
        setConfig(cached); // cache is already stripped of version fields
        setLoading(false); // don't hold first paint for the network round-trip
      }
      try {
        const fresh = await api.appConfig();
        if (alive) applyFresh(fresh);
      } catch {
        // offline / API down — keep the cached or default config
      } finally {
        clearTimeout(cap);
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(cap);
    };
  }, [applyFresh]);

  // Live updates: refetch when the app returns to the foreground, and poll
  // every POLL_MS while it stays active. Backgrounded apps poll nothing.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!interval) interval = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    start(); // the app launches foregrounded
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh(); // immediate catch-up after being backgrounded
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [refresh]);

  const value = useMemo<ConfigState>(
    () => ({ config, loading, compat }),
    [config, loading, compat],
  );
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

export function useAppConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useAppConfig must be used within ConfigProvider");
  return ctx;
}
