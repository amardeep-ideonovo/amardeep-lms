// TanStack Query wiring for the app.
//
// TanStack Query IS the app's data-fetching layer: screens read server state
// through the hooks in queries.ts, all backed by the ONE shared cache this
// module provides — so the same request made by several screens (my-classes is
// fetched by Home, Classes AND Certificates) is fetched once, paints from cache
// on the next visit, and revalidates in the background.
//
// Two isolation boundaries this cache MUST respect — both are load-bearing on a
// shared device, and both are handled here rather than left to each screen:
//
//   1. Academy switch (a shared build rebinding to a different instance). The
//      InstanceGate already remounts the entire app tree via `key={API_BASE_URL}`
//      (see instance-gate.tsx). Because QueryProvider lives INSIDE that subtree,
//      a switch tears it down and builds a brand-new empty cache — nothing to do
//      here beyond sitting in the right place in the tree.
//
//   2. Member switch on the SAME instance (sign out, a different member signs
//      in). API_BASE_URL is unchanged, so the tree does NOT remount and the
//      cache would otherwise carry the previous member's classes/profile into
//      the new session. QueryAuthReset clears the cache whenever the auth token
//      identity changes — the query-cache analogue of the token-cache epoch in
//      config.ts/api.ts.
import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError } from "./api";
import { useAuth } from "./auth";

// How long a query's data is considered fresh (no background refetch on mount /
// focus). The DEFAULT is deliberately short and fail-safe: anything ownership-,
// progress- or profile-bearing must reflect a server-side change quickly, and a
// query that forgets to pick a tier inherits the safe one.
export const STALE = {
  // Ownership / progress / profile — revalidate within seconds.
  entitlement: 15_000,
  // Time-sensitive live-session windows — always revalidate on mount/focus.
  live: 0,
} as const;

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.entitlement,
        // How long an unused entry survives for an instant stale-while-revalidate
        // paint on return. 5 min covers navigating away and back.
        gcTime: 5 * 60_000,
        retry: (count, error) => {
          // A client error is terminal: 401 already triggers sign-out (see
          // api.ts), 403 = locked, 404 = gone — retrying only delays the truth.
          // Transient network (ApiError status 0) and 5xx retry twice.
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            return false;
          }
          return count < 2;
        },
        // Refetch a stale query when the app returns to the foreground. Uses the
        // focusManager wired to AppState below (react-query's own default listens
        // on `window` focus, which does not exist in React Native).
        refetchOnWindowFocus: true,
        // onlineManager stays at its React Native default (always online — there
        // is no `window` online/offline event to listen on), so this is inert
        // until an offline-aware transport is added. Kept true so it "just works"
        // if one ever is. No NetInfo dependency is pulled in for this.
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}

// Bridge React Native's AppState to react-query's focusManager so foregrounding
// the app revalidates stale queries. Returns the cleanup so the effect that owns
// it can tear the subscription down; setEventListener also disposes the previous
// listener, so a remount (academy switch) re-binds cleanly.
function bindAppStateToFocus(): void {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener(
      "change",
      (status: AppStateStatus) => {
        // 'active' → focused; 'background'/'inactive' → not. Web has no AppState
        // focus semantics worth forwarding, so leave its default behavior.
        if (Platform.OS !== "web") handleFocus(status === "active");
      },
    );
    return () => sub.remove();
  });
}

// Creates ONE QueryClient for the lifetime of this mount and provides it. Placed
// inside InstanceGate (see App.tsx), so an academy switch remounts this and the
// new client starts with an empty cache — the isolation boundary #1 above.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  useEffect(() => {
    bindAppStateToFocus();
  }, []);
  // The `as never` bridges a purely TYPE-level duplicate-@types/react gap, not a
  // runtime one. react-query hoists to the repo root, where it resolves
  // @types/react 18 — the version the React-18 web/admin/control-plane apps pin —
  // whereas this app is React 19 (Expo 56), whose ReactNode additionally allows
  // `bigint` and is therefore wider than the provider's 18-typed children prop.
  // There is exactly ONE react at runtime (this app's), so the values are the
  // same objects; the cast only reconciles the two @types copies at this single
  // interop point. (A tsconfig `paths` remap can't fix it — Metro honors paths
  // for real resolution too, so remapping `react` breaks the bundle.)
  return (
    <QueryClientProvider client={client}>
      {children as never}
    </QueryClientProvider>
  );
}

// Clears the whole query cache whenever the signed-in member changes — sign-out,
// or a different member signing in on the SAME instance (which does not remount
// the tree). Sits under AuthProvider (for the token) and under QueryClientProvider
// (for the client). This is isolation boundary #2 above.
export function QueryAuthReset({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  // `undefined` = not yet observed; token itself is `string | null`. Skipping the
  // first observation avoids clearing an (already empty) cache on boot.
  const prev = useRef<string | null | undefined>(undefined);

  // Cleared DURING RENDER, deliberately NOT in an effect. This component is an
  // ANCESTOR of the authed screens, and React flushes passive effects
  // child-first: signing in flips the token and mounts the screens in ONE
  // commit, so an effect here would run only AFTER those screens had already
  // created and started their queries — and clearing then destroys those
  // in-flight fetches (query-core's remove() cancels silently, so the observer
  // is left pending with no replacement request until some incidental
  // re-render). A parent renders before its children, so doing it here
  // guarantees the cache is empty *before* any screen of the new session can
  // read from or populate it. `clear()` is idempotent, so a double-invoked or
  // discarded render is harmless.
  if (prev.current !== undefined && prev.current !== token) {
    queryClient.clear();
  }
  prev.current = token;

  return <>{children}</>;
}
