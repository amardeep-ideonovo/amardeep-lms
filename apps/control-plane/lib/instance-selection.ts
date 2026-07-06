"use client";

// Which of the client's instances the portal is looking at — shared by the
// overview, every section page and the shell topbar ("Open admin"). Persisted
// per browser so the selection survives navigation and reloads.

import { useEffect, useState } from "react";
import type { Instance } from "./types";

const KEY = "lms.ops.portal.selectedInstance";

let current: string | null | undefined; // undefined = not read from storage yet
const listeners = new Set<() => void>();

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getSelectedInstanceId(): string | null {
  if (current === undefined) current = readStored();
  return current;
}

export function setSelectedInstanceId(id: string): void {
  current = id;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      // best-effort
    }
  }
  listeners.forEach((fn) => fn());
}

/**
 * Resolves the selected instance against the client's owned set — falls back
 * to the first instance when nothing (or something stale) is stored.
 */
export function useSelectedInstance(
  instances: Instance[]
): [Instance | undefined, (id: string) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const id = getSelectedInstanceId();
  const selected = instances.find((i) => i.id === id) ?? instances[0];
  return [selected, setSelectedInstanceId];
}
