"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type { AdminAction, AdminSection, AuthAdmin } from "@lms/types";
import { api, getToken } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import {
  OPTIMISTIC_NETWORK_MODE,
  mutationErrorMessage,
  useMountedRef,
} from "@/lib/mutations";

interface AdminAuthValue {
  me: AuthAdmin | null;
  loading: boolean;
  isSuperAdmin: boolean;
  can: (section: AdminSection, action: AdminAction) => boolean;
  refresh: () => void;
  // The admin's saved sidebar ordering (stable nav keys). [] = use defaults.
  menuOrder: string[];
  // Persist a new sidebar order for THIS admin (optimistic + server write).
  saveMenuOrder: (order: string[]) => Promise<void>;
  // Replace the cached `me` (after a profile/avatar update returns a fresh one).
  applyAdmin: (admin: AuthAdmin) => void;
}

const Ctx = createContext<AdminAuthValue>({
  me: null,
  loading: true,
  isSuperAdmin: false,
  can: () => false,
  refresh: () => {},
  menuOrder: [],
  saveMenuOrder: async () => {},
  applyAdmin: () => {},
});

// A sidebar-order save. `box` is the run's snapshot slot, filled inside
// mutationFn — i.e. at the run's TURN in its scope queue — NOT in onMutate:
// v5 runs onMutate at trigger time even for a scope-queued mutation, so
// snapshotting there would capture the save still in flight. Filling the box
// at the turn keeps the rule the ref below documents.
type MenuOrderVars = {
  order: string[];
  ticket: number;
  box: { snapshot?: string[] };
};

// Loads the current admin (role + per-section permissions) once and exposes
// `can(section, action)` + `isSuperAdmin` to gate UI. The backend is the real
// enforcer — this only controls what's shown.
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<AuthAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const mounted = useMountedRef();
  // The saved order, readable at run time — the optimistic snapshot has to be
  // the order as it is when the write actually starts, not when the callback
  // was created.
  const savedOrderRef = useRef<string[]>([]);
  // Newest ticket for the (single) menu-order scope: only the newest WAITING
  // save survives its wait — every save persists the whole order, so a
  // superseded intermediate is dead weight. A save already executing is never
  // superseded, only one still waiting its turn.
  const orderTicket = useRef(0);

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

  const menuOrder = me?.prefs?.menuOrder ?? [];
  savedOrderRef.current = menuOrder;

  // Optimistically apply the new order, then persist. On failure, put the
  // previous order back, tell the admin, and re-fetch the authoritative state
  // so the UI never drifts from the server. Still rejects, so a caller that
  // wants to react to the failure itself can.
  const applyMenuOrder = useCallback((order: string[]) => {
    setMe((prev) =>
      prev ? { ...prev, prefs: { ...prev.prefs, menuOrder: order } } : prev,
    );
  }, []);

  // The save write (docs/coding-standards.md D4: useMutation is the
  // serialization + rollback engine here). The old queue key
  // (`admin:menu-order`) becomes a v5 mutation scope: same-id mutations run in
  // series, so overlapping saves can never revert on top of each other.
  const menuOrderMutation = useMutation({
    scope: { id: "admin:menu-order" },
    networkMode: OPTIMISTIC_NETWORK_MODE,
    // The snapshot box IS the context handed to onError; mutationFn fills it
    // at the run's turn (see the MenuOrderVars comment).
    onMutate: ({ box }: MenuOrderVars) => box,
    mutationFn: async ({ order, ticket, box }: MenuOrderVars) => {
      // Superseded while waiting (a newer save queued up), or the provider
      // unmounted before this run's turn: never start.
      if (ticket !== orderTicket.current || !mounted.current) return null;
      box.snapshot = savedOrderRef.current;
      applyMenuOrder(order);
      return api.updateMyPrefs({ menuOrder: order });
    },
    // The server is always the winner: commit its authoritative admin (null =
    // a superseded run that never started).
    onSuccess: (updated) => {
      if (updated && mounted.current) setMe(updated);
    },
    onError: (error, vars, box) => {
      if (!mounted.current) return;
      if (box?.snapshot) applyMenuOrder(box.snapshot);
      refresh();
      toast(mutationErrorMessage(error, "Couldn’t save your sidebar order."), {
        action: {
          label: "Retry",
          // Same order, but a fresh ticket + box: the retry is a NEW run (it
          // must not be skipped as superseded, and it takes its own snapshot).
          onAction: () => {
            const ticket = ++orderTicket.current;
            menuOrderMutation.mutate({ ...vars, ticket, box: {} });
          },
        },
      });
    },
  });
  const { mutateAsync: saveMenuOrderAsync } = menuOrderMutation;

  const saveMenuOrder = useCallback(
    async (order: string[]) => {
      // This call is now the newest intent; anything still waiting is
      // superseded. Rejects on failure (after the rollback above); a
      // superseded save resolves silently, like the old queue did.
      const ticket = ++orderTicket.current;
      await saveMenuOrderAsync({ order, ticket, box: {} });
    },
    [saveMenuOrderAsync],
  );

  const applyAdmin = useCallback((admin: AuthAdmin) => setMe(admin), []);

  return (
    <Ctx.Provider
      value={{
        me,
        loading,
        isSuperAdmin,
        can,
        refresh,
        menuOrder,
        saveMenuOrder,
        applyAdmin,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAdminAuth(): AdminAuthValue {
  return useContext(Ctx);
}
