// Typed fetch client for the admin app. Wraps the REST contract in @lms/types.
import type {
  AuthAdmin,
  CategoryDTO,
  CourseCard,
  CreateLevelInput,
  CreatePostInput,
  LessonDTO,
  LevelDTO,
  LoginResponse,
  MemberRow,
  PostAdminRow,
  PostCategoryDTO,
  UpdatePostInput,
} from "@lms/types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3000";

const TOKEN_KEY = "lms.admin.token";

// ---------- token helpers (localStorage, client-only) ----------
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

// ---------- core request ----------
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function request<T>(
  method: Method,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 401 && typeof window !== "undefined") {
    clearToken();
    if (window.location.pathname !== "/login") window.location.href = "/login";
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) {
        message = Array.isArray(data.message)
          ? data.message.join(", ")
          : String(data.message);
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- settings DTOs (not in @lms/types; secrets are write-only) ----------
export interface StripeSettings {
  secretKey?: string;
  webhookSecret?: string;
  publishableKey?: string;
}
export interface StripeSettingsMasked {
  secretKeyLast4: string | null;
  webhookSecretLast4: string | null;
  publishableKey: string | null;
}
export interface MailchimpSettings {
  apiKey?: string;
  serverPrefix?: string;
  audienceId?: string;
}
export interface MailchimpSettingsMasked {
  apiKeyLast4: string | null;
  serverPrefix: string | null;
  audienceId: string | null;
}

// ---------- API surface (one helper per ROUTE used) ----------
export const api = {
  // auth
  adminLogin: (email: string, password: string) =>
    request<LoginResponse<AuthAdmin>>("POST", "/auth/admin/login", {
      email,
      password,
    }),

  // levels
  listLevels: () => request<LevelDTO[]>("GET", "/levels"),
  createLevel: (input: CreateLevelInput) =>
    request<LevelDTO>("POST", "/levels", input),
  updateLevel: (id: string, input: Partial<CreateLevelInput>) =>
    request<LevelDTO>("PATCH", `/levels/${id}`, input),
  deleteLevel: (id: string) => request<void>("DELETE", `/levels/${id}`),

  // members
  listMembers: () => request<MemberRow[]>("GET", "/members"),
  addMemberLevel: (memberId: string, levelId: string) =>
    request<void>("POST", `/members/${memberId}/levels`, { levelId }),
  removeMemberLevel: (memberId: string, levelId: string) =>
    request<void>("DELETE", `/members/${memberId}/levels/${levelId}`),

  // lms
  listCategories: () => request<CategoryDTO[]>("GET", "/categories"),
  createCategory: (name: string, order?: number) =>
    request<CategoryDTO>("POST", "/categories", { name, order }),
  listCourses: () => request<CourseCard[]>("GET", "/courses"),
  createCourse: (input: {
    title: string;
    description?: string;
    categoryId?: string;
    levelIds: string[];
  }) => request<CourseCard>("POST", "/courses", input),
  updateCourse: (
    id: string,
    input: Partial<{
      title: string;
      description: string;
      categoryId: string | null;
      levelIds: string[];
    }>
  ) => request<CourseCard>("PATCH", `/courses/${id}`, input),
  listCourseLessons: (courseId: string) =>
    request<LessonDTO[]>("GET", `/courses/${courseId}/lessons`),
  createLesson: (
    courseId: string,
    input: {
      title: string;
      content?: string;
      videoUrl?: string;
      muxAssetId?: string;
    }
  ) => request<LessonDTO>("POST", `/courses/${courseId}/lessons`, input),

  // settings
  getStripeSettings: () =>
    request<StripeSettingsMasked>("GET", "/admin/settings/stripe"),
  putStripeSettings: (input: StripeSettings) =>
    request<StripeSettingsMasked>("PUT", "/admin/settings/stripe", input),
  getMailchimpSettings: () =>
    request<MailchimpSettingsMasked>("GET", "/admin/settings/mailchimp"),
  putMailchimpSettings: (input: MailchimpSettings) =>
    request<MailchimpSettingsMasked>(
      "PUT",
      "/admin/settings/mailchimp",
      input
    ),

  // blog
  listPosts: () => request<PostAdminRow[]>("GET", "/admin/blog/posts"),
  createPost: (input: CreatePostInput) =>
    request<PostAdminRow>("POST", "/admin/blog/posts", input),
  updatePost: (id: string, input: UpdatePostInput) =>
    request<PostAdminRow>("PATCH", `/admin/blog/posts/${id}`, input),
  deletePost: (id: string) => request<void>("DELETE", `/admin/blog/posts/${id}`),
  listPostCategories: () =>
    request<PostCategoryDTO[]>("GET", "/blog/categories"),
  createPostCategory: (name: string, order?: number) =>
    request<PostCategoryDTO>("POST", "/admin/blog/categories", { name, order }),
  deletePostCategory: (id: string) =>
    request<void>("DELETE", `/admin/blog/categories/${id}`),

  // Multipart upload (can't go through `request`, which forces JSON).
  uploadImage: async (
    file: File
  ): Promise<{ url: string; filename: string }> => {
    const token = getToken();
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${BASE_URL}/admin/blog/upload`, {
      method: "POST",
      // No Content-Type: the browser sets the multipart boundary itself.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (res.status === 401 && typeof window !== "undefined") {
      clearToken();
      if (window.location.pathname !== "/login")
        window.location.href = "/login";
    }
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;
      try {
        const data = await res.json();
        if (data?.message)
          message = Array.isArray(data.message)
            ? data.message.join(", ")
            : String(data.message);
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message);
    }
    return res.json();
  },
};
