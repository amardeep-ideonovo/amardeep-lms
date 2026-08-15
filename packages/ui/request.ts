// The one JSON request core behind web's and admin's `lib/api.ts`
// (docs/coding-standards.md D5 — the two apps had drifted into different
// request() signatures with separate ApiError classes). Each app keeps its
// public surface (web: request(path, opts) with Data-Cache revalidate; admin:
// request(method, path, body) with 401→login redirect) as a thin wrapper over
// createRequest(); the fetch/auth/cache/error mechanics live here once.
//
// Invariants this file owns:
//   • `revalidate` (Next Data-Cache TTL) is honored ONLY when no bearer token
//     was attached — a member's response must never land in the shared cache
//     where another visitor could be served it. Token attached → no-store,
//     regardless of what the caller passed.
//   • 401 fires cfg.onUnauthorized (admin: clear token + redirect to login)
//     BEFORE the error is thrown, matching admin's pre-extraction behavior.
//   • Error message = body.message → body.error → cfg.fallbackMessage(res),
//     arrays joined with ", " (the API's class-validator errors).

import { ApiError, ERROR_CODES, type ErrorCode } from "@lms/types";

export type RequestConfig = {
  /** Resolved per call — runtime env (window.__ENV__) can change after load. */
  baseUrl: () => string;
  getToken: () => string | null;
  /** Called on any 401 before the ApiError is thrown. */
  onUnauthorized?: (res: Response) => void;
  /** Message when the error body has none. Default: `Request failed (status)`. */
  fallbackMessage?: (res: Response) => string;
};

export type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Attach the bearer token (default true). */
  auth?: boolean;
  /** Next Data-Cache TTL seconds — public responses only (see header). */
  revalidate?: number;
};

export function createRequest(cfg: RequestConfig) {
  return async function request<T>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const { method = "GET", body, auth = true, revalidate } = opts;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let tokenAttached = false;
    if (auth) {
      const token = cfg.getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        tokenAttached = true;
      }
    }

    const init: RequestInit & { next?: { revalidate?: number } } = {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };
    if (revalidate !== undefined && !tokenAttached) {
      init.next = { revalidate };
    } else {
      init.cache = "no-store";
    }

    const res = await fetch(`${cfg.baseUrl()}${path}`, init);

    if (res.status === 401) cfg.onUnauthorized?.(res);

    if (!res.ok) {
      let message =
        cfg.fallbackMessage?.(res) ?? `Request failed (${res.status})`;
      let code: ErrorCode = "UNSPECIFIED";
      try {
        const data: unknown = await res.json();
        if (data && typeof data === "object") {
          const raw =
            (data as { message?: unknown }).message ??
            (data as { error?: unknown }).error;
          if (Array.isArray(raw)) message = raw.join(", ");
          else if (raw != null && raw !== "") message = String(raw);
          // D6: the API stamps every error body with a machine-readable code.
          const rawCode = (data as { code?: unknown }).code;
          if (
            typeof rawCode === "string" &&
            (ERROR_CODES as readonly string[]).includes(rawCode)
          ) {
            code = rawCode as ErrorCode;
          }
        }
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message, code);
    }

    if (res.status === 204) return undefined as T;
    // Some endpoints return an empty body.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
}
