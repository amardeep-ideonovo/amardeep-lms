"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { AdminAction, AdminSection, AuthAdmin } from "@lms/types";
import { api, getToken } from "@/lib/api";

interface AdminAuthValue {
  me: AuthAdmin | null;
  loading: boolean;
  isSuperAdmin: boolean;
  can: (section: AdminSection, action: AdminAction) => boolean;
  refresh: () => void;
}

const Ctx = createContext<AdminAuthValue>({
  me: null,
  loading: true,
  isSuperAdmin: false,
  can: () => false,
  refresh: () => {},
});

// Loads the current admin (role + per-section permissions) once and exposes
// `can(section, action)` + `isSuperAdmin` to gate UI. The backend is the real
// enforcer — this only controls what's shown.
export function AdminAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [me, setMe] = useState<AuthAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .me()
      .then((m) => setMe(m))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (pathname === "/login") {
      setLoading(false);
      return;
    }
    refresh();
  }, [pathname, refresh]);

  const isSuperAdmin = me?.role === "SUPER_ADMIN";

  const can = useCallback(
    (section: AdminSection, action: AdminAction): boolean => {
      if (!me) return false;
      if (me.role === "SUPER_ADMIN") return true;
      return me.permissions?.[section]?.[action] === true;
    },
    [me],
  );

  return (
    <Ctx.Provider value={{ me, loading, isSuperAdmin, can, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminAuth(): AdminAuthValue {
  return useContext(Ctx);
}
