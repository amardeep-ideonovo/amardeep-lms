"use client";

import { useEffect, useState } from "react";
import { getFleetSnapshot, getFleetState, subscribeFleet } from "./provisioner";
import type { FleetState } from "./types";

/**
 * Loads the fleet state through the async mock API (~150ms latency — pages
 * show skeletons while null), then stays live by subscribing to store
 * mutations. Swapping the mock for a real fleet API keeps this hook's
 * shape: initial fetch + push/poll refresh.
 */
export function useFleet(): FleetState | null {
  const [snap, setSnap] = useState<FleetState | null>(null);

  useEffect(() => {
    let alive = true;
    getFleetState().then((s) => {
      if (alive) setSnap(s);
    });
    const unsub = subscribeFleet(() => {
      if (alive) setSnap(getFleetSnapshot());
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return snap;
}
