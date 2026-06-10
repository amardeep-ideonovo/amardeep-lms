import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AppConfig } from "@lms/types";

import { api } from "./api";
import { DEFAULT_APP_CONFIG } from "./theme";

const CONFIG_KEY = "lms.appconfig";

type ConfigState = {
  config: AppConfig;
  loading: boolean; // true until the first cache/network resolution
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
        ? localStorage.getItem(CONFIG_KEY)
        : null
      : await SecureStore.getItemAsync(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as AppConfig) : null;
  } catch {
    return null;
  }
}

async function writeCache(config: AppConfig): Promise<void> {
  try {
    const raw = JSON.stringify(config);
    if (isWeb) {
      if (typeof localStorage !== "undefined") localStorage.setItem(CONFIG_KEY, raw);
    } else {
      await SecureStore.setItemAsync(CONFIG_KEY, raw);
    }
  } catch {
    // best-effort cache; never block on it
  }
}

// How long a first launch (no cache yet) may hold the splash gate waiting for
// the config fetch. A black-holing network (captive portal, dead VPN) never
// errors, so without this cap the app would spin until the OS socket timeout.
const GATE_CAP_MS = 4000;

// Loads the admin's app-customization config. The first-paint gate releases at
// the EARLIEST of: cache read (last-known branding is correct enough), fetch
// settled, or GATE_CAP_MS. The fetch always continues in the background and
// re-themes reactively when it lands; a failure keeps cached/default branding.
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const cap = setTimeout(() => {
      if (alive) setLoading(false);
    }, GATE_CAP_MS);
    (async () => {
      const cached = await readCache();
      if (alive && cached) {
        setConfig(cached);
        setLoading(false); // don't hold first paint for the network round-trip
      }
      try {
        const fresh = await api.appConfig();
        if (alive) {
          setConfig(fresh);
          void writeCache(fresh);
        }
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
  }, []);

  const value = useMemo<ConfigState>(() => ({ config, loading }), [config, loading]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useAppConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useAppConfig must be used within ConfigProvider");
  return ctx;
}
