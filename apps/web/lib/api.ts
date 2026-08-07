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
  MemberDashboardDTO,
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
  ResetPasswordInput,
  SignupInput,
  UpdateProfileInput,
} from "@lms/types";

// API origin resolved at RUNTIME (not baked at build) so one prebuilt image can
// serve any provisioned instance:
//   • browser → window.__ENV__.apiUrl (from /env.js, set before hydration)
//   • SSR     → API_URL_INTERNAL (in-network) then RUNTIME_API_URL (public)
//   • else    → build-time NEXT_PUBLIC_API_URL, then localhost
function apiBase(): string {
  if (typeof window !== "undefined") {
    const env = (window as unknown as { __ENV__?: { apiUrl?: string } }).__ENV__;
    return (
      env?.apiUrl ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
  }
  return (
    process.env.API_URL_INTERNAL ||
    process.env.RUNTIME_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

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

// Default TTL (seconds) for PUBLIC, token-independent responses that opt into
// caching. Applied to the site header/footer/menu/app-config fetches the root
// layout makes on EVERY route, so a burst of renders shares one API round-trip
// per resource instead of one each. Kept short so an admin's branding/nav edit
// still shows within ~30s (matches the mobile config-poll cadence). This is
// NEVER applied to a request that carries a member token (see request()).
export const PUBLIC_TTL_SECONDS = 30;

type Options = {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach Bearer token (default true)
  // Seconds to cache a PUBLIC response in Next's shared Data Cache. Honored only
  // when NO member token is attached — otherwise request() forces no-store, so a
  // per-member response can never be served to another visitor from the cache.
  revalidate?: number;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, auth = true, revalidate } = opts;
  const headers: Record<string, string> = {};

  if (body !== undefined) headers["Content-Type"] = "application/json";

  let tokenAttached = false;
  if (auth) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      tokenAttached = true;
    }
  }

  // TTL-cache ONLY public responses. If a member token is attached, force
  // no-store — a member's response must never land in the shared Data Cache
  // where another visitor could be served it. This invariant holds regardless
  // of what the caller passes for `revalidate`. Otherwise, an explicit
  // `revalidate` caches the (public) response for that many seconds; without it
  // we keep the previous no-store (always-fresh) default.
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

  const res = await fetch(`${apiBase()}${path}`, init);

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
    const res = await fetch(`${apiBase()}/auth/me/avatar`, {
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
  // The API bumps tokenVersion (revoking other sessions) and returns a fresh
  // token for THIS session — store it so the current session isn't logged out.
  changePassword: async (input: ChangePasswordInput) => {
    const res = await request<{ ok: true; token: string }>(
      "/auth/change-password",
      { method: "POST", body: input },
    );
    setToken(res.token);
    return res;
  },
  // Self-serve password reset (both public). forgotPassword always resolves
  // { ok: true } — the API never reveals whether the email has an account.
  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: false,
    }),
  resetPassword: (input: ResetPasswordInput) =>
    request<{ ok: true }>("/auth/reset-password", {
      method: "POST",
      body: input,
      auth: false,
    }),

  // member dashboard
  dashboard: () => request<DashboardResponse>("/dashboard"),

  // classes (member): published class tiles for the dashboard, and a class's
  // courses (only returned when the member owns the class).
  myClasses: () => request<ClassTileDTO[]>("/levels/my-classes"),
  // Tiles + per-class progress + the next lesson to resume, in ONE call. The
  // member screens use this instead of my-classes plus a per-class fan-out.
  myDashboard: () => request<MemberDashboardDTO>("/levels/my-dashboard"),

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
  // Playback heartbeat: marks the lesson "started" on the first call and saves
  // the resume position. Fire-and-forget from the player.
  recordLessonProgress: (lessonId: string, positionSeconds: number) =>
    request<{ ok: true }>(`/lessons/${lessonId}/progress`, {
      method: "POST",
      body: { positionSeconds },
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
    const res = await fetch(`${apiBase()}${cert.downloadUrl}`, {
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
    const res = await fetch(`${apiBase()}${note.downloadUrl}`, {
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

  // One-off course purchase (Stripe mode=payment). `courseCheckout` returns the
  // hosted-checkout URL to redirect to; `confirmCoursePurchase` grants inline on
  // return (the success URL carries ?session_id=…) without waiting on a webhook.
  courseCheckout: (courseId: string) =>
    request<{ url: string }>("/billing/course/checkout", {
      method: "POST",
      body: { courseId },
    }),
  confirmCoursePurchase: (sessionId: string) =>
    request<{ granted: boolean }>("/billing/course/confirm", {
      method: "POST",
      body: { sessionId },
    }),

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
  const isServer = typeof window === "undefined";
  try {
    const qs = path ? `?path=${encodeURIComponent(path)}` : "";
    // Pass the path so the API runs matchHeader() (honors "hide on section/page")
    // instead of the exclude-blind guest default — the SSR paint then already
    // reflects the hide, so a hidden header never flashes on refresh.
    // Server (SSR): no member token exists (getToken is localStorage-only), so it
    //   resolves as guest; the path-keyed public response is TTL-cached.
    // Client: attach the member token so audience/level rules resolve for THIS
    //   visitor, and never cache it (per-visitor, token-bearing).
    return await request<ResolvedHeader>(`/site/header${qs}`, {
      auth: !isServer && !!path,
      ...(!isServer && path ? {} : { revalidate: PUBLIC_TTL_SECONDS }),
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
    return await request<ResolvedMenu>(path, {
      auth: false,
      revalidate: PUBLIC_TTL_SECONDS,
    });
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
    return await request<AppConfig>("/app/config", {
      auth: false,
      revalidate: PUBLIC_TTL_SECONDS,
    });
  } catch {
    return null;
  }
}

// ---------- Site footer (PUBLIC) ----------
// SSR'd in the root layout; null on failure so the layout never 500s.
export async function fetchFooter(): Promise<FooterConfig | null> {
  try {
    return await request<FooterConfig>("/site/footer", {
      auth: false,
      revalidate: PUBLIC_TTL_SECONDS,
    });
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
    // Opt into caching (drops request()'s default no-store) so the browser
    // honors the endpoint's Cache-Control and reuses one response across the
    // client-side navigations that refetch popups — instead of a fresh
    // full-Puck-doc fetch per navigation. Public, token-independent data.
    return await request<PopupPublicDTO[]>(`/popups/active?${qs}`, {
      auth: false,
      revalidate: 60,
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
    void fetch(`${apiBase()}/popups/${encodeURIComponent(id)}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export { apiBase };
