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

// Loads the admin's app-customization config: seeds from cache for an instant
// branded first paint, then refreshes from the API in the background. A network
// failure keeps the cached (or default) branding — launch is never blocked on it.
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCache();
      if (alive && cached) setConfig(cached);
      try {
        const fresh = await api.appConfig();
        if (alive) {
          setConfig(fresh);
          void writeCache(fresh);
        }
      } catch {
        // offline / API down — keep the cached or default config
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
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
