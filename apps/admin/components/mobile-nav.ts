"use client";

import { useSyncExternalStore } from "react";

// Tiny shared store for the mobile sidebar drawer, so the Topbar (the hamburger
// button) and the Sidebar (the drawer + scrim) can coordinate without threading
// a context through the root layout. Module-level; resets to closed on a full
// reload. Only matters below the ≤900px drawer breakpoint — on desktop the
// sidebar is always visible and the `open` flag has no visual effect.
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const mobileNav = {
  toggle() {
    open = !open;
    emit();
  },
  close() {
    if (open) {
      open = false;
      emit();
    }
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileNavOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false, // SSR + first client paint: always closed (no hydration flip)
  );
}
