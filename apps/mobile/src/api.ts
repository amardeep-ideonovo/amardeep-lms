import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type {
  AuthUser,
  CourseCard,
  DashboardResponse,
  LessonDTO,
  LessonNoteDTO,
  LoginResponse,
  PagePublicDTO,
  PopupContext,
  PopupEventType,
  PopupPublicDTO,
  PostDetailDTO,
  PostListItem,
  SignupInput,
} from "@lms/types";

import { API_BASE_URL } from "./config";

const TOKEN_KEY = "lms.auth.token";

// ---------- token storage ----------
// SecureStore is native-only; on web (incl. the Expo-web preview) fall back to
// localStorage so the same auth flow runs across platforms.
const isWeb = Platform.OS === "web";

export async function getToken(): Promise<string | null> {
  if (isWeb) {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(TOKEN_KEY)
      : null;
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function setToken(token: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function clearToken(): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---------- error type so screens can branch on status (e.g. 403 locked) ----------
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------- 401 handler ----------
// The auth layer registers a callback here so a server-rejected token (expired,
// or signed by a since-rotated JWT secret) drops the stale token and returns the
// member to Login, instead of dead-ending on an "Unauthorized" retry loop.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach Bearer header (default true)
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.");
  }

  if (!res.ok) {
    // A rejected token on an authed request means the session is dead — let the
    // auth layer sign out so the user lands on Login rather than retrying a 401.
    if (res.status === 401 && auth) onUnauthorized?.();
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) {
        message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      }
    } catch {
      // non-JSON error body; keep default message
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- endpoints (mirror packages/types ROUTES) ----------
export const api = {
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

  dashboard: () => request<DashboardResponse>("/dashboard"),

  courses: () => request<CourseCard[]>("/courses"),

  courseLessons: (courseId: string) =>
    request<LessonDTO[]>(`/courses/${courseId}/lessons`),

  lesson: (lessonId: string) => request<LessonDTO>(`/lessons/${lessonId}`),

  completeLesson: (lessonId: string) =>
    request<void>(`/lessons/${lessonId}/complete`, { method: "POST" }),

  // blog (public — no auth needed; visible to logged-in members)
  posts: () => request<PostListItem[]>("/blog/posts", { auth: false }),
  post: (slug: string) =>
    request<PostDetailDTO>(`/blog/posts/${encodeURIComponent(slug)}`, {
      auth: false,
    }),

  // pages (public CMS — built with the admin visual editor; no auth needed)
  page: (slug: string) =>
    request<PagePublicDTO>(`/pages/${encodeURIComponent(slug)}`, {
      auth: false,
    }),

  // popups (public — only ACTIVE; server filters by context). The caller
  // catches failures so a popup hiccup never breaks the host screen.
  activePopups: (ctx: PopupContext) => {
    const qs =
      ctx.type === "page"
        ? `context=page&pageId=${encodeURIComponent(ctx.pageId)}`
        : "context=dashboard";
    return request<PopupPublicDTO[]>(`/popups/active?${qs}`, { auth: false });
  },

  // Fire-and-forget analytics ping (view / dismiss). Never thrown.
  recordPopupEvent: (id: string, type: PopupEventType): void => {
    request<{ ok: true }>(`/popups/${encodeURIComponent(id)}/event`, {
      method: "POST",
      body: { type },
      auth: false,
    }).catch(() => {});
  },
};

// Build the (access-checked) download URL for a lesson note. The file is
// streamed by an authenticated route; on mobile we open it in the device
// browser via Linking, passing the member's token as a query param (this is
// the one route that accepts ?token=). No native file modules required.
export async function noteDownloadUrl(note: LessonNoteDTO): Promise<string> {
  const token = await getToken();
  const sep = note.downloadUrl.includes("?") ? "&" : "?";
  return `${API_BASE_URL}${note.downloadUrl}${
    token ? `${sep}token=${encodeURIComponent(token)}` : ""
  }`;
}
