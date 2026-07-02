// Typed fetch client for the member web app.
// Talks to the NestJS API; auth via member JWT stored in localStorage.
import type {
  AuthUser,
  BillingConfigDTO,
  CertificateVerifyDTO,
  ClaimCertificateInput,
  CompleteLessonResponse,
  CouponPreviewDTO,
  CouponValidateInput,
  CheckoutLevelDTO,
  ClassPublicDTO,
  ClassTileDTO,
  CourseCard,
  MyCertificateDTO,
  InvoiceDTO,
  PayPalActivateInput,
  PayPalPrepareInput,
  PayPalPrepareResult,
  SubscribeInput,
  SubscribeResult,
  SubscriptionDetailDTO,
  DashboardResponse,
  FormPublicDTO,
  FormSubmitResult,
  LessonDTO,
  LevelDTO,
  LiveSessionBarDTO,
  LiveJoinCredentialsDTO,
  LiveZoomEmbedDTO,
  LoginResponse,
  MyClassCoursesDTO,
  MySubscriptionDTO,
  PageListItem,
  PagePublicDTO,
  PopupContext,
  PopupEventType,
  PopupPublicDTO,
  PostDetailDTO,
  PostListItem,
  PublicClassListItem,
  ResolvedMenu,
  ResolvedHeader,
  AppConfig,
  FooterConfig,
  FooterSubscribeResult,
  ChangePasswordInput,
  SignupInput,
  UpdateProfileInput,
} from "@lms/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3000";

const TOKEN_KEY = "lms_member_token";
const ME_CACHE_KEY = "lms_member_me";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ME_CACHE_KEY);
}

// Last-known member profile, cached so the nav avatar paints instantly on
// refresh (no flicker) before the live /auth/me round-trip resolves.
export function getCachedMe(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setCachedMe(u: AuthUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (u) window.localStorage.setItem(ME_CACHE_KEY, JSON.stringify(u));
    else window.localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type Options = {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach Bearer token (default true)
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {};

  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = (data && (data.message || data.error)) || message;
      if (Array.isArray(message)) message = message.join(", ");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  // Some endpoints may return empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- Endpoints (mirror packages/types ROUTES) ----------
export const api = {
  // auth
  login: (email: string, password: string) =>
    request<LoginResponse<AuthUser>>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    }),
  signup: (input: SignupInput) =>
    request<LoginResponse<AuthUser>>("/auth/signup", {
      method: "POST",
      body: input,
      auth: false,
    }),
  me: () => request<AuthUser>("/auth/me"),
  updateMe: (input: UpdateProfileInput) =>
    request<AuthUser>("/auth/me", { method: "PATCH", body: input }),
  // Member profile photo upload (multipart; the cropper hands us a JPEG blob).
  uploadAvatar: async (file: Blob): Promise<AuthUser> => {
    const token = getToken();
    const fd = new FormData();
    fd.append("file", file, "avatar.jpg");
    const res = await fetch(`${API_BASE}/auth/me/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const d = await res.json();
        message = (d && (d.message || d.error)) || message;
        if (Array.isArray(message)) message = message.join(", ");
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message);
    }
    return res.json();
  },
  changePassword: (input: ChangePasswordInput) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST",
      body: input,
    }),

  // member dashboard
  dashboard: () => request<DashboardResponse>("/dashboard"),

  // classes (member): published class tiles for the dashboard, and a class's
  // courses (only returned when the member owns the class).
  myClasses: () => request<ClassTileDTO[]>("/levels/my-classes"),

  // live sessions
  liveCurrent: () => request<LiveSessionBarDTO[]>("/live/current"),
  liveSession: (id: string) =>
    request<LiveSessionBarDTO>(`/live/${encodeURIComponent(id)}`),
  liveCredentials: (id: string) =>
    request<LiveJoinCredentialsDTO>(
      `/live/${encodeURIComponent(id)}/credentials`,
    ),
  liveZoomEmbed: (id: string) =>
    request<LiveZoomEmbedDTO>(`/live/${encodeURIComponent(id)}/zoom`),
  myClassCourses: (slugOrId: string) =>
    request<MyClassCoursesDTO>(
      `/levels/${encodeURIComponent(slugOrId)}/my-courses`,
    ),

  // lms
  courses: () => request<CourseCard[]>("/courses"),
  courseLessons: (courseId: string) =>
    request<LessonDTO[]>(`/courses/${courseId}/lessons`),
  lesson: (lessonId: string) => request<LessonDTO>(`/lessons/${lessonId}`),
  // Completing the final lesson of a class returns fresh certificate state so
  // the "Get certificate" button can appear without a refetch.
  completeLesson: (lessonId: string) =>
    request<CompleteLessonResponse>(`/lessons/${lessonId}/complete`, {
      method: "POST",
    }),

  // certificates (class completion)
  claimCertificate: (input: ClaimCertificateInput) =>
    request<MyCertificateDTO>("/certificates/claim", {
      method: "POST",
      body: input,
    }),
  myCertificates: () => request<MyCertificateDTO[]>("/certificates/mine"),
  verifyCertificate: (serial: string) =>
    request<CertificateVerifyDTO>(
      `/certificates/verify/${encodeURIComponent(serial)}`,
      { auth: false },
    ),
  // Same authed blob-download pattern as lesson notes.
  downloadCertificate: async (cert: { downloadUrl: string; serial: string; className: string }) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}${cert.downloadUrl}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (!res.ok)
      throw new ApiError(res.status, `Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Certificate ${cert.serial} - ${cert.className}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Download a lesson note. The endpoint is access-checked on the server; we
  // fetch it with the member's token and save the blob via a temp <a download>.
  downloadNote: async (note: { downloadUrl: string; originalName: string }) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}${note.downloadUrl}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (!res.ok)
      throw new ApiError(res.status, `Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = note.originalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // levels (for the subscribe flow)
  levels: () => request<LevelDTO[]>("/levels"),

  // navigation menus (resolved + visibility-filtered server-side; optional auth)
  resolveMenu: (location: string) =>
    request<ResolvedMenu | null>(`/menus/location/${location}`),
  resolveMenuById: (id: string) =>
    request<ResolvedMenu | null>(`/menus/${id}/resolved`),
  // Public checkout resolution (slug or id) — works logged-out.
  checkoutLevel: (slugOrId: string) =>
    request<CheckoutLevelDTO>(
      `/levels/checkout/${encodeURIComponent(slugOrId)}`,
      { auth: false },
    ),

  // billing
  checkout: (priceId: string) =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: { priceId },
    }),
  portal: () => request<{ url: string }>("/billing/portal"),
  mySubscriptions: () =>
    request<MySubscriptionDTO[]>("/billing/subscriptions"),

  // Embedded checkout (Stripe Elements). `config` is public; the others need auth.
  billingConfig: () =>
    request<BillingConfigDTO>("/billing/config", { auth: false }),
  subscribe: (input: SubscribeInput) =>
    request<SubscribeResult>("/billing/subscribe", {
      method: "POST",
      body: input,
    }),
  // Reconcile the member's own subscriptions inline after a successful payment
  // (so a purchase reflects without waiting on the Stripe webhook).
  syncSubscriptions: () =>
    request<{ ok: true }>("/billing/sync", { method: "POST" }),
  validateCoupon: (input: CouponValidateInput) =>
    request<CouponPreviewDTO>("/billing/coupon/validate", {
      method: "POST",
      body: input,
    }),
  // Enriched subscriptions (actual price/interval) + the member's payment history.
  mySubscriptionDetails: () =>
    request<SubscriptionDetailDTO[]>("/billing/subscription-details"),
  myInvoices: () => request<InvoiceDTO[]>("/billing/invoices"),
  // Member self-service: cancel own subscription at period end.
  cancelMyMembership: (subId: string) =>
    request<SubscriptionDetailDTO[]>(`/billing/subscriptions/${subId}/cancel`, {
      method: "POST",
    }),

  // PayPal checkout (active when the admin selects the paypal provider).
  paypalPrepare: (input: PayPalPrepareInput) =>
    request<PayPalPrepareResult>("/billing/paypal/prepare", {
      method: "POST",
      body: input,
    }),
  paypalActivate: (input: PayPalActivateInput) =>
    request<SubscriptionDetailDTO[]>("/billing/paypal/activate", {
      method: "POST",
      body: input,
    }),
};

// ---------- Site header (PUBLIC) ----------
// SSR'd in the root layout. Returns null on any failure so the layout never
// 500s — <Nav> then falls back to the default header look.
export async function fetchSiteHeader(
  path?: string,
): Promise<ResolvedHeader | null> {
  try {
    const qs = path ? `?path=${encodeURIComponent(path)}` : "";
    // SSR (no path) -> guest default, no token. Client (with path) -> attach
    // the member token so audience/level rules resolve for this visitor.
    return await request<ResolvedHeader>(`/site/header${qs}`, {
      auth: !!path,
    });
  } catch {
    return null;
  }
}

// ---------- Header nav menu (PUBLIC) ----------
// SSR'd in the root layout alongside the header so <Nav> paints the configured
// menu on first load instead of flashing the built-in fallback. Items are
// public/token-independent; null on failure (Nav falls back).
export async function fetchHeaderMenu(
  menuId?: string | null,
): Promise<ResolvedMenu | null> {
  try {
    const path = menuId ? `/menus/${menuId}/resolved` : `/menus/location/HEADER`;
    return await request<ResolvedMenu>(path, { auth: false });
  } catch {
    return null;
  }
}

// ---------- App config / brand (PUBLIC) ----------
// The single, cross-platform brand source (also drives the mobile app). SSR'd
// in the root layout so <Nav> shows the configured brand name (e.g. "Spotlight
// Academy") instead of the built-in "LMS" fallback. null on failure.
export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    return await request<AppConfig>("/app/config", { auth: false });
  } catch {
    return null;
  }
}

// ---------- Site footer (PUBLIC) ----------
// SSR'd in the root layout; null on failure so the layout never 500s.
export async function fetchFooter(): Promise<FooterConfig | null> {
  try {
    return await request<FooterConfig>("/site/footer", { auth: false });
  } catch {
    return null;
  }
}

// Built-in footer email opt-in -> in-house audience (server-side). Never throws;
// a failure (bad email / unconfigured) comes back as { ok:false, message }.
export async function footerSubscribe(
  email: string,
): Promise<FooterSubscribeResult> {
  try {
    return await request<FooterSubscribeResult>("/site/footer/subscribe", {
      method: "POST",
      body: { email },
      auth: false,
    });
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "Couldn’t subscribe. Try again.";
    return { ok: false, status: "error", message };
  }
}

// ---------- Blog (PUBLIC) ----------
// No token: usable from Server Components for SSR/SEO. Only PUBLISHED posts
// are returned by the API; an unknown/draft slug yields 404 -> null here.
export function fetchPublishedPosts(): Promise<PostListItem[]> {
  return request<PostListItem[]>("/blog/posts", { auth: false });
}

export async function fetchPublishedPost(
  slug: string
): Promise<PostDetailDTO | null> {
  try {
    return await request<PostDetailDTO>(
      `/blog/posts/${encodeURIComponent(slug)}`,
      { auth: false }
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ---------- Pages (PUBLIC CMS / Puck) ----------
// No token: usable from Server Components for SSR/SEO. Only PUBLISHED pages are
// returned by the API; an unknown/draft slug yields 404 -> null here.
// Published CMS pages (list) — drives the sitemap. PUBLISHED only.
export function fetchPublishedPages(): Promise<PageListItem[]> {
  return request<PageListItem[]>("/pages", { auth: false });
}

export async function fetchPublishedPage(
  slug: string
): Promise<PagePublicDTO | null> {
  try {
    return await request<PagePublicDTO>(`/pages/${encodeURIComponent(slug)}`, {
      auth: false,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ---------- Classes (PUBLIC landing pages) ----------
// No token: server-rendered for SEO. An unknown slug/id yields 404 -> null.
export function fetchPublicClasses(): Promise<PublicClassListItem[]> {
  return request<PublicClassListItem[]>("/levels/public", { auth: false });
}

export async function fetchClassPage(
  slugOrId: string
): Promise<ClassPublicDTO | null> {
  try {
    return await request<ClassPublicDTO>(
      `/levels/page/${encodeURIComponent(slugOrId)}`,
      { auth: false }
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ---------- Forms (PUBLIC, audience-linked) ----------
// Used client-side by <FormEmbed>. Only ACTIVE forms are returned.
export async function fetchPublicForm(
  id: string
): Promise<FormPublicDTO | null> {
  try {
    return await request<FormPublicDTO>(`/forms/${encodeURIComponent(id)}`, {
      auth: false,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function submitForm(
  id: string,
  values: Record<string, string | number | boolean>
): Promise<FormSubmitResult> {
  return request<FormSubmitResult>(`/forms/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: { values },
    auth: false,
  });
}

// ---------- Popups (PUBLIC, Puck overlay) ----------
// Used client-side by <PopupHost>. The server filters by context, so we just
// render what we get. A failure must never break the host page → return [].
export async function fetchActivePopups(
  ctx: PopupContext
): Promise<PopupPublicDTO[]> {
  const qs =
    ctx.type === "page"
      ? `context=page&pageId=${encodeURIComponent(ctx.pageId)}`
      : `context=${ctx.type}`;
  try {
    return await request<PopupPublicDTO[]>(`/popups/active?${qs}`, {
      auth: false,
    });
  } catch {
    return [];
  }
}

// Fire-and-forget analytics ping (view / click / dismiss). Never awaited and
// never throws — a tracking failure must not affect the popup UX. keepalive
// lets a dismiss-on-navigation ping still flush.
export function recordPopupEvent(id: string, type: PopupEventType): void {
  try {
    void fetch(`${API_BASE}/popups/${encodeURIComponent(id)}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export { API_BASE };
