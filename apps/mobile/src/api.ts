import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type {
  AuthUser,
  DashboardResponse,
  LessonDTO,
  LoginResponse,
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

  dashboard: () => request<DashboardResponse>("/dashboard"),

  courseLessons: (courseId: string) =>
    request<LessonDTO[]>(`/courses/${courseId}/lessons`),

  lesson: (lessonId: string) => request<LessonDTO>(`/lessons/${lessonId}`),

  completeLesson: (lessonId: string) =>
    request<void>(`/lessons/${lessonId}/complete`, { method: "POST" }),
};
