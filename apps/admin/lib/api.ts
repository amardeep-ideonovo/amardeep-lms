// Typed fetch client for the admin app. Wraps the REST contract in @lms/types.
import type {
  AuthAdmin,
  CategoryDTO,
  CourseCard,
  CreateCourseInput,
  CreateFormInput,
  CreateLessonInput,
  CreateLevelInput,
  CreatePageInput,
  CreatePostInput,
  FormAdminRow,
  FormSubmissionDTO,
  LessonDTO,
  LessonNoteDTO,
  LevelDTO,
  LoginResponse,
  MailchimpAudienceDTO,
  MailchimpMergeFieldDTO,
  MemberRow,
  PageAdminRow,
  PageListItem,
  PopupAdminRow,
  PopupListItem,
  PostAdminRow,
  PostCategoryDTO,
  CreatePopupInput,
  UpdateCourseInput,
  UpdateFormInput,
  UpdateLessonInput,
  UpdateMemberInput,
  UpdatePageInput,
  UpdatePopupInput,
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

// ---------- multipart upload + authenticated download helpers ----------
// Multipart can't go through `request` (which forces JSON). The browser sets
// the multipart boundary itself, so we must NOT set Content-Type.
async function multipartFetch(path: string, fd: FormData): Promise<Response> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    clearToken();
    if (window.location.pathname !== "/login") window.location.href = "/login";
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
  return res;
}

async function uploadFile(
  path: string,
  file: File
): Promise<{ url: string; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return (await multipartFetch(path, fd)).json();
}

async function uploadFiles(
  path: string,
  files: File[]
): Promise<LessonNoteDTO[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return (await multipartFetch(path, fd)).json();
}

// Authenticated download: fetch the (access-checked) file as a blob and save it
// via a temporary <a download>. Used for lesson notes.
async function downloadBlob(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  updateMember: (memberId: string, input: UpdateMemberInput) =>
    request<MemberRow>("PATCH", `/members/${memberId}`, input),
  addMemberLevel: (memberId: string, levelId: string) =>
    request<void>("POST", `/members/${memberId}/levels`, { levelId }),
  removeMemberLevel: (memberId: string, levelId: string) =>
    request<void>("DELETE", `/members/${memberId}/levels/${levelId}`),

  // lms
  listCategories: () => request<CategoryDTO[]>("GET", "/categories"),
  createCategory: (name: string, order?: number, thumbnailUrl?: string) =>
    request<CategoryDTO>("POST", "/categories", { name, order, thumbnailUrl }),
  deleteCategory: (id: string) => request<void>("DELETE", `/categories/${id}`),
  uploadCategoryImage: (file: File) => uploadFile("/categories/upload", file),
  listCourses: () => request<CourseCard[]>("GET", "/courses"),
  createCourse: (input: CreateCourseInput) =>
    request<CourseCard>("POST", "/courses", input),
  updateCourse: (id: string, input: UpdateCourseInput) =>
    request<CourseCard>("PATCH", `/courses/${id}`, input),
  deleteCourse: (id: string) => request<void>("DELETE", `/courses/${id}`),
  listCourseLessons: (courseId: string) =>
    request<LessonDTO[]>("GET", `/courses/${courseId}/lessons`),
  createLesson: (courseId: string, input: CreateLessonInput) =>
    request<LessonDTO>("POST", `/courses/${courseId}/lessons`, input),
  updateLesson: (id: string, input: UpdateLessonInput) =>
    request<LessonDTO>("PATCH", `/lessons/${id}`, input),
  deleteLesson: (id: string) => request<void>("DELETE", `/lessons/${id}`),
  // lesson notes (downloadable attachments)
  uploadLessonNotes: (lessonId: string, files: File[]) =>
    uploadFiles(`/lessons/${lessonId}/notes`, files),
  renameLessonNote: (lessonId: string, noteId: string, originalName: string) =>
    request<LessonNoteDTO>("PATCH", `/lessons/${lessonId}/notes/${noteId}`, {
      originalName,
    }),
  deleteLessonNote: (lessonId: string, noteId: string) =>
    request<void>("DELETE", `/lessons/${lessonId}/notes/${noteId}`),
  downloadNote: (note: { downloadUrl: string; originalName: string }) =>
    downloadBlob(note.downloadUrl, note.originalName),

  // settings
  getStripeSettings: () =>
    request<StripeSettingsMasked>("GET", "/admin/settings/stripe"),
  putStripeSettings: (input: StripeSettings) =>
    request<StripeSettingsMasked>("PUT", "/admin/settings/stripe", input),
  clearStripeSettings: () =>
    request<StripeSettingsMasked>("DELETE", "/admin/settings/stripe"),
  getMailchimpSettings: () =>
    request<MailchimpSettingsMasked>("GET", "/admin/settings/mailchimp"),
  putMailchimpSettings: (input: MailchimpSettings) =>
    request<MailchimpSettingsMasked>(
      "PUT",
      "/admin/settings/mailchimp",
      input
    ),
  clearMailchimpSettings: () =>
    request<MailchimpSettingsMasked>("DELETE", "/admin/settings/mailchimp"),

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

  // pages (CMS / Puck visual builder)
  listPages: () => request<PageListItem[]>("GET", "/admin/pages"),
  getPage: (id: string) => request<PageAdminRow>("GET", `/admin/pages/${id}`),
  createPage: (input: CreatePageInput) =>
    request<PageAdminRow>("POST", "/admin/pages", input),
  updatePage: (id: string, input: UpdatePageInput) =>
    request<PageAdminRow>("PATCH", `/admin/pages/${id}`, input),
  deletePage: (id: string) => request<void>("DELETE", `/admin/pages/${id}`),
  uploadPageImage: (file: File) => uploadFile("/admin/pages/upload", file),

  // popups (Puck overlay — same editor as pages, plus style + visibility)
  listPopups: () => request<PopupListItem[]>("GET", "/admin/popups"),
  getPopup: (id: string) =>
    request<PopupAdminRow>("GET", `/admin/popups/${id}`),
  createPopup: (input: CreatePopupInput) =>
    request<PopupAdminRow>("POST", "/admin/popups", input),
  updatePopup: (id: string, input: UpdatePopupInput) =>
    request<PopupAdminRow>("PATCH", `/admin/popups/${id}`, input),
  deletePopup: (id: string) => request<void>("DELETE", `/admin/popups/${id}`),

  // forms (Mailchimp-linked)
  listForms: () => request<FormAdminRow[]>("GET", "/admin/forms"),
  getForm: (id: string) => request<FormAdminRow>("GET", `/admin/forms/${id}`),
  createForm: (input: CreateFormInput) =>
    request<FormAdminRow>("POST", "/admin/forms", input),
  updateForm: (id: string, input: UpdateFormInput) =>
    request<FormAdminRow>("PATCH", `/admin/forms/${id}`, input),
  deleteForm: (id: string) => request<void>("DELETE", `/admin/forms/${id}`),
  listFormSubmissions: (id: string) =>
    request<FormSubmissionDTO[]>("GET", `/admin/forms/${id}/submissions`),
  listMailchimpAudiences: () =>
    request<MailchimpAudienceDTO[]>("GET", "/admin/mailchimp/audiences"),
  getMailchimpMergeFields: (audienceId: string) =>
    request<MailchimpMergeFieldDTO[]>(
      "GET",
      `/admin/mailchimp/audiences/${audienceId}/merge-fields`
    ),

  // Multipart uploads (see helpers above). The browser sets the boundary.
  uploadImage: (file: File) => uploadFile("/admin/blog/upload", file),
  uploadCourseImage: (file: File) => uploadFile("/courses/upload", file),
  uploadLessonImage: (file: File) => uploadFile("/lessons/upload", file),
};
