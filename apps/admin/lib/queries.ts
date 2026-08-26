"use client";

// Typed query hooks over the api client (lib/api.ts) for the admin app
// (docs/coding-standards.md D4). Mirrors apps/mobile/src/queries.ts: an entry
// lives here when the read is shared by several surfaces — the three retired
// module-level `cached`+`inflight` singletons (app brand, forms list, menus
// list) are now the hooks below — while a page-local read (blog, coupons)
// keeps its useQuery call in the page but MUST take its key from `qk`.
//
// Every query key lives in the single `qk` object so a cache read, an
// invalidation and a write can never drift on a hand-typed string. Keys are
// plain arrays; when a parameterized key is added (none yet), prefix it with a
// stable segment — ["thing", id] as const — so a broad invalidate (all
// "thing" entries) matches by prefix.
//
// Permission gating: admin list reads are RBAC-gated in the UI, so pages gate
// the automatic fetch with `enabled: !authLoading && can(section, "read")` and
// a denied section never fires the request. ⚠ `enabled` only gates the
// AUTOMATIC fetch — `refetch()` bypasses it in react-query v5. Prefer
// `queryClient.invalidateQueries({ queryKey: qk.x })`, which respects
// `enabled`, over calling refetch() directly.

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { apiUrl } from "./runtime-env";
import { STALE } from "./query";

export const qk = {
  appBrand: ["appBrand"] as const,
  forms: ["forms"] as const,
  menus: ["menus"] as const,
  blogPosts: ["blogPosts"] as const,
  blogCategories: ["blogCategories"] as const,
  blogTags: ["blogTags"] as const,
  coupons: ["coupons"] as const,
  levels: ["levels"] as const,
  // Member helpdesk (page-local useQuery reads take their key from here).
  helpdeskConversations: (status: string, unreadOnly: boolean) =>
    ["helpdeskConversations", status, unreadOnly ? "unread" : "all"] as const,
  helpdeskStats: ["helpdeskStats"] as const,
  helpdeskArticles: ["helpdeskArticles"] as const,
};

// ---------- app brand (was lib/app-brand.ts's module cache) ----------
// Per-instance brand for the admin chrome (login card + sidebar), read from the
// same public GET /app/config that themes the member web + mobile apps — so one
// prebuilt admin image brands itself per instance at runtime, like runtime-env.
//
// The product default title is now "Spotlight Academy" (a real brand, shown
// as-is). This sentinel is the LEGACY default "LMS": if an older instance still
// stores that literal title, treat it as "unset" so the admin chrome renders a
// neutral fallback instead of the retired placeholder.
const PLACEHOLDER_TITLE = "LMS";

// Raw fetch, not the api client: /app/config is public (no auth header, no
// 401 redirect wanted on the login page) and every failure maps to null
// (neutral chrome), never a thrown error — so this query has no error state.
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
 *
 * Returns the plain value rather than the query result: fetchBrand never
 * throws, and callers only ever branch on null (the old app-brand.ts
 * contract, preserved so the chrome reads it as a simple value).
 */
export function useAppBrand(): string | null {
  const { data } = useQuery({
    queryKey: qk.appBrand,
    queryFn: fetchBrand,
    staleTime: STALE.brand,
  });
  return data ?? null;
}

// ---- Puck picker lists (were the FormPickerField/MenuPickerField caches) ----
// All forms, for the Form block's picker. Several Form blocks (and the page +
// popup editors) can mount at once — the shared cache collapses them to one
// request. Best-effort: consumers render `data ?? []`, so loading and load
// errors alike show an empty dropdown, exactly as the old catch-to-[] did.
export function useFormsList() {
  return useQuery({ queryKey: qk.forms, queryFn: () => api.listForms() });
}

// All menus, for the Menu block's picker. Same shape and same best-effort
// contract as useFormsList.
export function useMenusList() {
  return useQuery({ queryKey: qk.menus, queryFn: () => api.listMenus() });
}
