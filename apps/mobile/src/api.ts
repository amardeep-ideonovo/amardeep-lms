import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type {
  AppConfig,
  AuthUser,
  ChangePasswordInput,
  ClaimCertificateInput,
  ClassPublicDTO,
  ClassTileDTO,
  CompleteLessonResponse,
  CourseCard,
  DashboardResponse,
  MyCertificateDTO,
  FormPublicDTO,
  FormSubmitResult,
  InvoiceDTO,
  LessonDTO,
  LessonNoteDTO,
  LevelDTO,
  LiveCurrentDTO,
  LiveJoinCredentialsDTO,
  LiveSessionBarDTO,
  LoginResponse,
  MyClassCoursesDTO,
  PagePublicDTO,
  PopupContext,
  PopupEventType,
  PopupPublicDTO,
  PostDetailDTO,
  PostListItem,
  ResolvedMenu,
  SignupInput,
  SubscriptionDetailDTO,
  UpdateProfileInput,
} from "@lms/types";

import { File, UploadType } from "expo-file-system";
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

  // app customization (public — drives the app's branding/theme; fetched at launch)
  appConfig: () => request<AppConfig>("/app/config", { auth: false }),

  dashboard: () => request<DashboardResponse>("/dashboard"),

  // classes (member dashboard tiles + landing pages)
  myClasses: () => request<ClassTileDTO[]>("/levels/my-classes"),
  myClassCourses: (slugOrId: string) =>
    request<MyClassCoursesDTO>(
      `/levels/${encodeURIComponent(slugOrId)}/my-courses`,
    ),
  // public marketing data for a class landing page (no auth)
  classPage: (slugOrId: string) =>
    request<ClassPublicDTO>(`/levels/page/${encodeURIComponent(slugOrId)}`, {
      auth: false,
    }),

  // live sessions (member-facing; server-gated by entitlement + join window).
  // The join URL/passcode come from liveCredentials only inside the window; the
  // app opens the meeting in the native Zoom / Google Meet app via Linking.
  liveCurrent: () => request<LiveCurrentDTO>("/live/current"),
  liveSession: (id: string) =>
    request<LiveSessionBarDTO>(`/live/${encodeURIComponent(id)}`),
  liveCredentials: (id: string) =>
    request<LiveJoinCredentialsDTO>(
      `/live/${encodeURIComponent(id)}/credentials`,
    ),

  // account self-service (profile + password; purchases stay on the web)
  me: () => request<AuthUser>("/auth/me"),
  updateMe: (input: UpdateProfileInput) =>
    request<AuthUser>("/auth/me", { method: "PATCH", body: input }),
  // Member profile photo upload. RN multipart: FormData with the picked file's
  // local URI (already square-cropped by the image picker's editor). The boundary
  // header is set by fetch automatically, so we only attach Authorization.
  uploadAvatar: async (uri: string, mimeType?: string): Promise<AuthUser> => {
    const token = await getToken();
    const type = mimeType || "image/jpeg";
    // expo-file-system's multipart upload streams the file from its URI — RN's
    // FormData/fetch rejects the classic { uri } file part ("Unsupported
    // FormDataPart implementation") on this SDK, so use the native uploader.
    let result: { status: number; body: string };
    try {
      result = await new File(uri).upload(`${API_BASE_URL}/auth/me/avatar`, {
        httpMethod: "POST",
        uploadType: UploadType.MULTIPART,
        fieldName: "file",
        mimeType: type,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      throw new ApiError(
        0,
        "Network error. Check your connection and try again.",
      );
    }
    if (result.status < 200 || result.status >= 300) {
      if (result.status === 401) onUnauthorized?.();
      let message = `Request failed (${result.status})`;
      try {
        const d = JSON.parse(result.body);
        if (d?.message)
          message = Array.isArray(d.message) ? d.message.join(", ") : d.message;
      } catch {
        // non-JSON error body; keep default
      }
      throw new ApiError(result.status, message);
    }
    return JSON.parse(result.body) as AuthUser;
  },
  changePassword: (input: ChangePasswordInput) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST",
      body: input,
    }),

  // billing — read + self-cancel + Stripe portal link (NO purchasing in-app)
  levels: () => request<LevelDTO[]>("/levels"),
  mySubscriptionDetails: () =>
    request<SubscriptionDetailDTO[]>("/billing/subscription-details"),
  myInvoices: () => request<InvoiceDTO[]>("/billing/invoices"),
  cancelMyMembership: (subId: string) =>
    request<SubscriptionDetailDTO[]>(
      `/billing/subscriptions/${encodeURIComponent(subId)}/cancel`,
      { method: "POST" },
    ),
  portal: () => request<{ url: string }>("/billing/portal"),

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

  // forms (public, audience-linked — embedded via the Puck "Form" block).
  // getPublic 404s for inactive/missing forms; the embed treats that as "render
  // nothing".
  publicForm: (id: string) =>
    request<FormPublicDTO>(`/forms/${encodeURIComponent(id)}`, { auth: false }),
  submitForm: (id: string, values: Record<string, string | number | boolean>) =>
    request<FormSubmitResult>(`/forms/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: { values },
      auth: false,
    }),

  // navigation menus (embedded via the Puck "Menu" block). The server resolves
  // hrefs + filters by visibility; auth is OPTIONAL there, so the default
  // Bearer header just unlocks AUTHED/LEVEL items for signed-in members.
  resolvedMenu: (id: string) =>
    request<ResolvedMenu | null>(`/menus/${encodeURIComponent(id)}/resolved`),

  // popups (public — only ACTIVE; server filters by context). The caller
  // catches failures so a popup hiccup never breaks the host screen.
  activePopups: (ctx: PopupContext) => {
    const qs =
      ctx.type === "page"
        ? `context=page&pageId=${encodeURIComponent(ctx.pageId)}`
        : `context=${ctx.type}`;
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

// Same contract for certificate PDFs: the download route accepts ?token=, so
// the device browser can open/save the file without native file modules.
export async function certificateDownloadUrl(cert: {
  downloadUrl: string;
}): Promise<string> {
  const token = await getToken();
  const sep = cert.downloadUrl.includes("?") ? "&" : "?";
  return `${API_BASE_URL}${cert.downloadUrl}${
    token ? `${sep}token=${encodeURIComponent(token)}` : ""
  }`;
}
