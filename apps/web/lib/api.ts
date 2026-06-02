// Typed fetch client for the member web app.
// Talks to the NestJS API; auth via member JWT stored in localStorage.
import type {
  AuthUser,
  BillingConfigDTO,
  CouponPreviewDTO,
  CouponValidateInput,
  CheckoutLevelDTO,
  CourseCard,
  InvoiceDTO,
  SubscribeInput,
  SubscribeResult,
  SubscriptionDetailDTO,
  DashboardResponse,
  FormPublicDTO,
  FormSubmitResult,
  LessonDTO,
  LevelDTO,
  LoginResponse,
  MySubscriptionDTO,
  PageListItem,
  PagePublicDTO,
  PopupContext,
  PopupEventType,
  PopupPublicDTO,
  PostDetailDTO,
  PostListItem,
  ChangePasswordInput,
  SignupInput,
  UpdateProfileInput,
} from "@lms/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3000";

const TOKEN_KEY = "lms_member_token";

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
  changePassword: (input: ChangePasswordInput) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST",
      body: input,
    }),

  // member dashboard
  dashboard: () => request<DashboardResponse>("/dashboard"),

  // lms
  courses: () => request<CourseCard[]>("/courses"),
  courseLessons: (courseId: string) =>
    request<LessonDTO[]>(`/courses/${courseId}/lessons`),
  lesson: (lessonId: string) => request<LessonDTO>(`/lessons/${lessonId}`),
  completeLesson: (lessonId: string) =>
    request<LessonDTO | void>(`/lessons/${lessonId}/complete`, {
      method: "POST",
    }),

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
  validateCoupon: (input: CouponValidateInput) =>
    request<CouponPreviewDTO>("/billing/coupon/validate", {
      method: "POST",
      body: input,
    }),
  // Enriched subscriptions (actual price/interval) + the member's payment history.
  mySubscriptionDetails: () =>
    request<SubscriptionDetailDTO[]>("/billing/subscription-details"),
  myInvoices: () => request<InvoiceDTO[]>("/billing/invoices"),
};

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

// ---------- Forms (PUBLIC, Mailchimp-linked) ----------
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
      : "context=dashboard";
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
