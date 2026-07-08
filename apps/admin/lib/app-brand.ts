"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "./runtime-env";

// Per-instance brand for the admin chrome (login card + sidebar), read from the
// same public GET /app/config that themes the member web + mobile apps — so one
// prebuilt admin image brands itself per instance at runtime, like runtime-env.
//
// Resolves to null when the instance never customized its AppConfig: the API
// default-merges the placeholder title "LMS" (DEFAULT_APP_CONFIG in
// apps/api/src/site/app-config.service.ts), and a placeholder must read as
// "unset" so call sites fall back to something neutral instead of showing it.
const PLACEHOLDER_TITLE = "LMS";

// Fetch once per page load, shared by every caller (login card and sidebar can
// mount in the same load); cached for client-side navigations after that.
let cached: string | null | undefined;
let inflight: Promise<string | null> | null = null;

async function fetchBrand(): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl()}/app/config`);
    if (!res.ok) return null;
    const config = (await res.json()) as { title?: unknown };
    const title = typeof config.title === "string" ? config.title.trim() : "";
    return title && title !== PLACEHOLDER_TITLE ? title : null;
  } catch {
    return null;
  }
}

/**
 * The instance's configured app title, or null while loading and when the
 * title is unset/unreachable — render a neutral fallback for null.
 */
export function useAppBrand(): string | null {
  const [brand, setBrand] = useState<string | null>(cached ?? null);

  useEffect(() => {
    if (cached !== undefined) {
      setBrand(cached);
      return;
    }
    let alive = true;
    if (!inflight) {
      inflight = fetchBrand().then((title) => {
        cached = title;
        return title;
      });
    }
    void inflight.then((title) => {
      if (alive) setBrand(title);
    });
    return () => {
      alive = false;
    };
  }, []);

  return brand;
}
