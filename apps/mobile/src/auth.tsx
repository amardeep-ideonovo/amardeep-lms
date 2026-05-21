import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { clearToken, getToken, setToken } from "./api";

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

  useEffect(() => {
    getToken()
      .then(setTokenState)
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (next: string) => {
    await setToken(next);
    setTokenState(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setTokenState(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ token, loading, signIn, signOut }),
    [token, loading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
