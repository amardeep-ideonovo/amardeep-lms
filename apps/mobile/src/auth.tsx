import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { clearToken, getToken, setToken, setUnauthorizedHandler } from "./api";
import {
  registerPushForCurrentInstance,
  unregisterPushForCurrentInstance,
} from "./push";

type AuthState = {
  token: string | null;
  loading: boolean; // true while we read the stored token at startup
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Re-entrancy guard: a 401 during the sign-out DELETE routes back through
  // setUnauthorizedHandler -> signOut; without this it could loop.
  const signingOut = useRef(false);

  useEffect(() => {
    getToken()
      .then((tok) => {
        setTokenState(tok);
        // Cold start with a live session — refresh this device's push token
        // against the restored academy (no-op unless permission was granted).
        if (tok) void registerPushForCurrentInstance();
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (next: string) => {
    await setToken(next);
    setTokenState(next);
    // Register for push after login (best-effort; only if already permitted).
    void registerPushForCurrentInstance();
  }, []);

  const signOut = useCallback(async () => {
    // Guard re-entry: the DELETE below can itself 401 (already-revoked token),
    // which fires the global unauthorized handler -> signOut again. Without this
    // the two would loop.
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      // AWAIT the de-register BEFORE clearing the token — it needs the bearer,
      // and unregisterPushForCurrentInstance yields on getExpoPushTokenAsync, so
      // a fire-and-forget call races clearToken and goes out unauthenticated
      // (server 401 -> token never removed -> shared-device leak). It's
      // best-effort and never throws, so awaiting can't fail sign-out. Also
      // covers the 401-revoke path, which routes through signOut.
      await unregisterPushForCurrentInstance();
      await clearToken();
      setTokenState(null);
    } finally {
      signingOut.current = false;
    }
  }, []);

  // When the API rejects our token (401), drop it and bounce back to Login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo<AuthState>(
    () => ({ token, loading, signIn, signOut }),
    [token, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
