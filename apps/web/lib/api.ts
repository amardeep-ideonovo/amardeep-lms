// Typed fetch client for the member web app.
// Talks to the NestJS API; auth via member JWT stored in localStorage.
import type {
  AuthUser,
  DashboardResponse,
  LessonDTO,
  LevelDTO,
  LoginResponse,
  PostDetailDTO,
  PostListItem,
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
  me: () => request<AuthUser>("/auth/me"),

  // member dashboard
  dashboard: () => request<DashboardResponse>("/dashboard"),

  // lms
  courseLessons: (courseId: string) =>
    request<LessonDTO[]>(`/courses/${courseId}/lessons`),
  lesson: (lessonId: string) => request<LessonDTO>(`/lessons/${lessonId}`),
  completeLesson: (lessonId: string) =>
    request<LessonDTO | void>(`/lessons/${lessonId}/complete`, {
      method: "POST",
    }),

  // levels (for the subscribe flow)
  levels: () => request<LevelDTO[]>("/levels"),

  // billing
  checkout: (priceId: string) =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: { priceId },
    }),
  portal: () => request<{ url: string }>("/billing/portal"),
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

export { API_BASE };
