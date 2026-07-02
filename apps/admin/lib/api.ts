// Typed fetch client for the admin app. Wraps the REST contract in @lms/types.
import type {
  AdminCertificateListDTO,
  AdminDTO,
  AdminNotificationListDTO,
  AdminSearchResponse,
  AuthAdmin,
  CertificateTemplateDTO,
  CreateCertificateTemplateInput,
  UpdateCertificateTemplateInput,
  CouponDTO,
  CreateAdminInput,
  UpdateAdminInput,
  UpdateAdminPrefsInput,
  UpdateAdminProfileInput,
  MenuListItem,
  MenuDTO,
  CreateMenuInput,
  UpdateMenuInput,
  CreateMenuItemInput,
  UpdateMenuItemInput,
  ReorderMenuItemsInput,
  HeaderDTO,
  HeaderSummary,
  CreateHeaderInput,
  UpdateHeaderInput,
  ReorderHeadersInput,
  FooterConfig,
  UpdateFooterInput,
  AppConfig,
  UpdateAppConfigInput,
  AudienceDTO,
  AudienceFieldDTO,
  ContactDTO,
  ContactListDTO,
  SegmentDTO,
  ContactStatus,
  CreateAudienceInput,
  UpdateAudienceInput,
  UpsertAudienceFieldInput,
  CreateContactInput,
  UpdateContactInput,
  CreateSegmentInput,
  UpdateSegmentInput,
  EmailSettingsInput,
  EmailSettingsMasked,
  EmailTemplateDTO,
  CreateEmailTemplateInput,
  UpdateEmailTemplateInput,
  RenderPreviewResult,
  EmailSendResultDTO,
  EmailLogListDTO,
  CampaignDTO,
  CampaignInput,
  AutomationDTO,
  AutomationInput,
  CourseCard,
  CreateCouponInput,
  CreateCourseInput,
  CreateFormInput,
  CreateLessonInput,
  CreateLevelInput,
  CreatePageInput,
  CreatePostInput,
  FormAdminRow,
  FormSubmissionDTO,
  AdminLiveSessionDTO,
  AdminLiveRevealDTO,
  LiveSessionInput,
  UpdateLiveSessionInput,
  LessonDTO,
  LessonNoteDTO,
  LevelCategoryDTO,
  LevelDTO,
  LoginResponse,
  MediaDTO,
  MediaListDTO,
  MemberBillingDTO,
  MemberRow,
  PageAdminRow,
  PageListItem,
  PopupAdminRow,
  PopupListItem,
  PostAdminRow,
  PostCategoryDTO,
  SubscriptionRowDTO,
  SubscriptionCancelMode,
  CreatePopupInput,
  UpdateCourseInput,
  UpdateFormInput,
  UpdateLessonInput,
  UpdateMediaInput,
  UpdateMemberInput,
  UpdatePageInput,
  UpdatePopupInput,
  UpdatePostInput,
  ChatChannelDTO,
  ChatChannelDetailDTO,
  ChatDmDTO,
  ChatMessageDTO,
  CreateChatChannelInput,
  OpenDmInput,
  UpdateChatChannelInput,
  SendMessageInput,
  ChatReactionToggleInput,
  UnreadSummaryDTO,
  ChatListDTO,
  ChatListItemDTO,
  CreateChatListInput,
  CreateChatListItemInput,
  UpdateChatListItemInput,
  ChatListFieldDTO,
  ChatListItemCommentDTO,
  CreateListFieldInput,
  UpdateListFieldInput,
  ReorderListFieldsInput,
  UpdateListItemValuesInput,
  CreateListItemCommentInput,
  ChatWorkflowDTO,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  UpdateListItemCommentInput,
  ChatCanvasDTO,
  CreateCanvasInput,
  UpdateCanvasInput,
} from "@lms/types";
import { withBase } from "./base-path";
import { apiUrl } from "./runtime-env";

// API base is resolved per call at runtime via apiUrl() — see ./runtime-env.
// (One prebuilt admin image, many instances: the origin comes from the
// container's env at request time, not baked into the bundle.)

// Public API origin for asset URLs the browser loads directly (media previews,
// certificate fonts in the template editor's @font-face rules). Resolved once
// at module load — /env.js has set window.__ENV__ before the bundle runs.
export const API_BASE_URL = apiUrl();

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

  const res = await fetch(`${apiUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 401 && typeof window !== "undefined") {
    clearToken();
    if (window.location.pathname !== withBase("/login"))
      window.location.href = `${withBase("/login")}?session=expired`;
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
  const res = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    clearToken();
    if (window.location.pathname !== withBase("/login"))
      window.location.href = `${withBase("/login")}?session=expired`;
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

async function uploadFiles(
  path: string,
  files: File[]
): Promise<LessonNoteDTO[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return (await multipartFetch(path, fd)).json();
}

// Media Library upload: one file (any allowed type) -> the created MediaDTO.
async function uploadMediaFile(path: string, file: File): Promise<MediaDTO> {
  const fd = new FormData();
  fd.append("file", file);
  return (await multipartFetch(path, fd)).json();
}

// Authenticated download: fetch the (access-checked) file as a blob and save it
// via a temporary <a download>. Used for lesson notes.
async function downloadBlob(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${apiUrl()}${path}`, {
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

// Date stamp (YYYY-MM-DD) appended to downloaded report filenames. The client owns
// the saved filename (downloadBlob sets <a download>), so the server's default name
// is irrelevant.
function reportStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// Optional filters for report exports (date range + class). Omitted = all data.
export type ReportFilter = { from?: string; to?: string; levelId?: string };

function reportQuery(f?: ReportFilter): string {
  if (!f) return "";
  const qs = new URLSearchParams();
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.levelId) qs.set("levelId", f.levelId);
  const s = qs.toString();
  return s ? `?${s}` : "";
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
export interface ZoomSettings {
  sdkKey?: string;
  sdkSecret?: string;
}
export interface ZoomSettingsMasked {
  sdkKey: string | null; // public (ships to the browser to join) — shown in full
  sdkSecretLast4: string | null;
}
// Email sender settings live in @lms/types (write-only secrets: SMTP pass +
// Resend API key). Re-exported so admin components import the contract from one
// place. `provider` selects the pluggable sender ("smtp" | "resend").
export type { EmailSettingsInput, EmailSettingsMasked } from "@lms/types";
export interface PayPalSettings {
  clientId?: string;
  clientSecret?: string;
  webhookId?: string;
  mode?: "sandbox" | "live";
}
export interface PayPalSettingsMasked {
  clientId: string | null; // public — shown in full
  clientSecretLast4: string | null;
  webhookId: string | null;
  mode: "sandbox" | "live" | null;
}
// Active processor for NEW checkouts; `warning` surfaces a missing webhook id.
export interface PaymentProviderSetting {
  provider: "stripe" | "paypal";
  warning?: string | null;
}

// ---------- API surface (one helper per ROUTE used) ----------
export const api = {
  // auth
  adminLogin: (email: string, password: string) =>
    request<LoginResponse<AuthAdmin>>("POST", "/auth/admin/login", {
      email,
      password,
    }),
  me: () => request<AuthAdmin>("GET", "/auth/me"),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("POST", "/auth/admin/change-password", {
      currentPassword,
      newPassword,
    }),
  // Admin self-service UI prefs (e.g. custom sidebar order). Returns the
  // refreshed AuthAdmin so the caller can update its cached `me` in place.
  updateMyPrefs: (input: UpdateAdminPrefsInput) =>
    request<AuthAdmin>("PATCH", "/auth/admin/prefs", input),
  // global admin search (topbar); results are permission-scoped server-side
  search: (q: string) =>
    request<AdminSearchResponse>(
      "GET",
      `/admin/search?q=${encodeURIComponent(q)}`,
    ),
  // admin self-service profile: update name / remove photo, upload photo
  updateProfile: (input: UpdateAdminProfileInput) =>
    request<AuthAdmin>("PATCH", "/auth/admin/profile", input),
  uploadAvatar: async (file: File): Promise<AuthAdmin> => {
    const fd = new FormData();
    fd.append("file", file);
    return (await multipartFetch("/auth/admin/avatar", fd)).json();
  },

  // navigation menus
  listMenus: () => request<MenuListItem[]>("GET", "/admin/menus"),
  getMenu: (id: string) => request<MenuDTO>("GET", `/admin/menus/${id}`),
  createMenu: (input: CreateMenuInput) =>
    request<MenuDTO>("POST", "/admin/menus", input),
  updateMenu: (id: string, input: UpdateMenuInput) =>
    request<MenuDTO>("PATCH", `/admin/menus/${id}`, input),
  deleteMenu: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/menus/${id}`),
  addMenuItem: (menuId: string, input: CreateMenuItemInput) =>
    request<MenuDTO>("POST", `/admin/menus/${menuId}/items`, input),
  updateMenuItem: (itemId: string, input: UpdateMenuItemInput) =>
    request<MenuDTO>("PATCH", `/admin/menus/items/${itemId}`, input),
  deleteMenuItem: (itemId: string) =>
    request<MenuDTO>("DELETE", `/admin/menus/items/${itemId}`),
  reorderMenuItems: (menuId: string, input: ReorderMenuItemsInput) =>
    request<MenuDTO>("PUT", `/admin/menus/${menuId}/order`, input),

  // site header builder (gated by the `menus` permission)
  // site headers (multiple, conditional)
  listHeaders: () => request<HeaderSummary[]>("GET", "/admin/site/headers"),
  getHeader: (id: string) =>
    request<HeaderDTO>("GET", `/admin/site/headers/${id}`),
  createHeader: (input: CreateHeaderInput) =>
    request<HeaderDTO>("POST", "/admin/site/headers", input),
  updateHeader: (id: string, input: UpdateHeaderInput) =>
    request<HeaderDTO>("PUT", `/admin/site/headers/${id}`, input),
  deleteHeader: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/site/headers/${id}`),
  reorderHeaders: (input: ReorderHeadersInput) =>
    request<HeaderSummary[]>("PUT", "/admin/site/headers/order", input),
  // site footer (single global)
  getFooter: () => request<FooterConfig>("GET", "/admin/site/footer"),
  updateFooter: (input: UpdateFooterInput) =>
    request<FooterConfig>("PUT", "/admin/site/footer", input),

  // mobile app customization (single global)
  getAppConfig: () => request<AppConfig>("GET", "/admin/app/config"),
  updateAppConfig: (input: UpdateAppConfigInput) =>
    request<AppConfig>("PUT", "/admin/app/config", input),

  // admin accounts + RBAC (super admin only)
  listAdmins: () => request<AdminDTO[]>("GET", "/admin/admins"),
  createAdmin: (input: CreateAdminInput) =>
    request<AdminDTO>("POST", "/admin/admins", input),
  updateAdmin: (id: string, input: UpdateAdminInput) =>
    request<AdminDTO>("PATCH", `/admin/admins/${id}`, input),
  resetAdminPassword: (id: string, password: string) =>
    request<{ ok: true }>("POST", `/admin/admins/${id}/password`, { password }),
  deleteAdmin: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/admins/${id}`),

  // levels
  listLevels: () => request<LevelDTO[]>("GET", "/levels"),
  createLevel: (input: CreateLevelInput) =>
    request<LevelDTO>("POST", "/levels", input),
  updateLevel: (id: string, input: Partial<CreateLevelInput>) =>
    request<LevelDTO>("PATCH", `/levels/${id}`, input),
  deleteLevel: (id: string) => request<void>("DELETE", `/levels/${id}`),
  listLevelCategories: () =>
    request<LevelCategoryDTO[]>("GET", "/levels/categories"),
  createLevelCategory: (name: string, order?: number) =>
    request<LevelCategoryDTO>("POST", "/levels/categories", { name, order }),
  deleteLevelCategory: (id: string) =>
    request<void>("DELETE", `/levels/categories/${id}`),

  // members
  listMembers: () => request<MemberRow[]>("GET", "/members"),
  getMember: (memberId: string) =>
    request<MemberRow>("GET", `/members/${memberId}`),
  updateMember: (memberId: string, input: UpdateMemberInput) =>
    request<MemberRow>("PATCH", `/members/${memberId}`, input),
  addMemberLevel: (memberId: string, levelId: string) =>
    request<void>("POST", `/members/${memberId}/levels`, { levelId }),
  removeMemberLevel: (memberId: string, levelId: string) =>
    request<void>("DELETE", `/members/${memberId}/levels/${levelId}`),
  // Admin override: set a member's password without their current one.
  setMemberPassword: (memberId: string, newPassword: string) =>
    request<{ ok: true }>("POST", `/members/${memberId}/password`, {
      newPassword,
    }),
  // per-member billing detail + one-click subscription actions
  memberBilling: (memberId: string) =>
    request<MemberBillingDTO>("GET", `/billing/members/${memberId}`),
  pauseMemberSub: (memberId: string, subId: string) =>
    request<MemberBillingDTO>(
      "POST",
      `/billing/members/${memberId}/subscriptions/${subId}/pause`,
    ),
  resumeMemberSub: (memberId: string, subId: string) =>
    request<MemberBillingDTO>(
      "POST",
      `/billing/members/${memberId}/subscriptions/${subId}/resume`,
    ),
  cancelMemberSub: (
    memberId: string,
    subId: string,
    mode: SubscriptionCancelMode,
  ) =>
    request<MemberBillingDTO>(
      "POST",
      `/billing/members/${memberId}/subscriptions/${subId}/cancel`,
      { mode },
    ),

  // subscriptions (admin Subscriptions tab; live from Stripe, read-only)
  listSubscriptions: () =>
    request<SubscriptionRowDTO[]>("GET", "/admin/subscriptions"),

  // reports (admin Reports tab; on-demand Excel .xlsx downloads via downloadBlob)
  downloadMembersReport: (f?: ReportFilter) =>
    downloadBlob(
      `/admin/reports/members.xlsx${reportQuery(f)}`,
      `members-${reportStamp()}.xlsx`,
    ),
  downloadSubscriptionsReport: (f?: ReportFilter) =>
    downloadBlob(
      `/admin/reports/subscriptions.xlsx${reportQuery(f)}`,
      `subscriptions-${reportStamp()}.xlsx`,
    ),
  downloadEngagementReport: (f?: ReportFilter) =>
    downloadBlob(
      `/admin/reports/engagement.xlsx${reportQuery(f)}`,
      `course-engagement-${reportStamp()}.xlsx`,
    ),
  downloadAllReports: (f?: ReportFilter) =>
    downloadBlob(
      `/admin/reports/all.xlsx${reportQuery(f)}`,
      `lms-reports-${reportStamp()}.xlsx`,
    ),

  // in-app notifications (per-admin read state)
  listNotifications: (params?: { page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    const s = qs.toString();
    return request<AdminNotificationListDTO>(
      "GET",
      `/admin/notifications${s ? `?${s}` : ""}`,
    );
  },
  notificationsUnreadCount: () =>
    request<{ count: number }>("GET", "/admin/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    request<{ ok: true }>("POST", `/admin/notifications/${id}/read`),
  markAllNotificationsRead: () =>
    request<{ ok: true }>("POST", "/admin/notifications/read-all"),

  // coupons (Stripe-backed; admin-only)
  listCoupons: () => request<CouponDTO[]>("GET", "/admin/coupons"),
  createCoupon: (input: CreateCouponInput) =>
    request<CouponDTO>("POST", "/admin/coupons", input),
  deactivateCoupon: (id: string) =>
    request<CouponDTO>("POST", `/admin/coupons/${id}/deactivate`),
  activateCoupon: (id: string) =>
    request<CouponDTO>("POST", `/admin/coupons/${id}/activate`),
  deleteCoupon: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/coupons/${id}`),

  // media library (gallery; files served at public, embeddable URLs)
  listMedia: (params?: {
    q?: string;
    kind?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.kind && params.kind !== "all") qs.set("kind", params.kind);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    const s = qs.toString();
    return request<MediaListDTO>("GET", `/admin/media${s ? `?${s}` : ""}`);
  },
  getMedia: (id: string) => request<MediaDTO>("GET", `/admin/media/${id}`),
  uploadMedia: (file: File) => uploadMediaFile("/admin/media", file),
  updateMedia: (id: string, input: UpdateMediaInput) =>
    request<MediaDTO>("PATCH", `/admin/media/${id}`, input),
  deleteMedia: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/media/${id}`),

  // lms
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
  getZoomSettings: () =>
    request<ZoomSettingsMasked>("GET", "/admin/settings/zoom"),
  putZoomSettings: (input: ZoomSettings) =>
    request<ZoomSettingsMasked>("PUT", "/admin/settings/zoom", input),
  clearZoomSettings: () =>
    request<ZoomSettingsMasked>("DELETE", "/admin/settings/zoom"),
  getEmailSettings: () =>
    request<EmailSettingsMasked>("GET", "/admin/settings/email"),
  putEmailSettings: (input: EmailSettingsInput) =>
    request<EmailSettingsMasked>("PUT", "/admin/settings/email", input),
  deleteEmailSettings: () =>
    request<EmailSettingsMasked>("DELETE", "/admin/settings/email"),
  getPayPalSettings: () =>
    request<PayPalSettingsMasked>("GET", "/admin/settings/paypal"),
  putPayPalSettings: (input: PayPalSettings) =>
    request<PayPalSettingsMasked>("PUT", "/admin/settings/paypal", input),
  clearPayPalSettings: () =>
    request<PayPalSettingsMasked>("DELETE", "/admin/settings/paypal"),
  getPaymentProvider: () =>
    request<PaymentProviderSetting>("GET", "/admin/settings/payment-provider"),
  putPaymentProvider: (provider: "stripe" | "paypal") =>
    request<PaymentProviderSetting>("PUT", "/admin/settings/payment-provider", {
      provider,
    }),

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

  // popups (Puck overlay — same editor as pages, plus style + visibility)
  listPopups: () => request<PopupListItem[]>("GET", "/admin/popups"),
  getPopup: (id: string) =>
    request<PopupAdminRow>("GET", `/admin/popups/${id}`),
  createPopup: (input: CreatePopupInput) =>
    request<PopupAdminRow>("POST", "/admin/popups", input),
  updatePopup: (id: string, input: UpdatePopupInput) =>
    request<PopupAdminRow>("PATCH", `/admin/popups/${id}`, input),
  deletePopup: (id: string) => request<void>("DELETE", `/admin/popups/${id}`),

  // forms (in-house Audience-linked; submissions subscribe into an Audience)
  listForms: () => request<FormAdminRow[]>("GET", "/admin/forms"),
  getForm: (id: string) => request<FormAdminRow>("GET", `/admin/forms/${id}`),
  createForm: (input: CreateFormInput) =>
    request<FormAdminRow>("POST", "/admin/forms", input),
  updateForm: (id: string, input: UpdateFormInput) =>
    request<FormAdminRow>("PATCH", `/admin/forms/${id}`, input),
  deleteForm: (id: string) => request<void>("DELETE", `/admin/forms/${id}`),

  // ----- live sessions -----
  listLiveSessions: () =>
    request<AdminLiveSessionDTO[]>("GET", "/admin/live-sessions"),
  getLiveSession: (id: string) =>
    request<AdminLiveSessionDTO>("GET", `/admin/live-sessions/${id}`),
  // Plaintext join URL for a test-join — separate call, edit permission.
  revealLiveSession: (id: string) =>
    request<AdminLiveRevealDTO>("GET", `/admin/live-sessions/${id}/reveal`),
  createLiveSession: (input: LiveSessionInput) =>
    request<AdminLiveSessionDTO>("POST", "/admin/live-sessions", input),
  updateLiveSession: (id: string, input: UpdateLiveSessionInput) =>
    request<AdminLiveSessionDTO>("PATCH", `/admin/live-sessions/${id}`, input),
  publishLiveSession: (id: string) =>
    request<AdminLiveSessionDTO>("POST", `/admin/live-sessions/${id}/publish`),
  deleteLiveSession: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/live-sessions/${id}`),
  listFormSubmissions: (id: string) =>
    request<FormSubmissionDTO[]>("GET", `/admin/forms/${id}/submissions`),
  // Merge tags for the form field-mapping editor come from the chosen audience's
  // in-house fields (GET /admin/audiences/:id/fields). EMAIL is implicit and not
  // returned by that list, so callers prepend it (see forms/page.tsx).
  listFormMergeFields: (audienceId: string) =>
    request<AudienceFieldDTO[]>(
      "GET",
      `/admin/audiences/${audienceId}/fields`
    ),

  // contacts / audiences (in-house list)
  listAudiences: () => request<AudienceDTO[]>("GET", "/admin/audiences"),
  createAudience: (input: CreateAudienceInput) =>
    request<AudienceDTO>("POST", "/admin/audiences", input),
  getAudience: (id: string) =>
    request<AudienceDTO>("GET", `/admin/audiences/${id}`),
  updateAudience: (id: string, input: UpdateAudienceInput) =>
    request<AudienceDTO>("PATCH", `/admin/audiences/${id}`, input),
  deleteAudience: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/audiences/${id}`),
  // audience fields (merge tags)
  listAudienceFields: (audienceId: string) =>
    request<AudienceFieldDTO[]>("GET", `/admin/audiences/${audienceId}/fields`),
  upsertAudienceField: (audienceId: string, input: UpsertAudienceFieldInput) =>
    request<AudienceFieldDTO>(
      "POST",
      `/admin/audiences/${audienceId}/fields`,
      input
    ),
  deleteAudienceField: (audienceId: string, tag: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/audiences/${audienceId}/fields/${encodeURIComponent(tag)}`
    ),
  // contacts (paginated; filter by status / tag / search)
  listContacts: (
    audienceId: string,
    params: {
      status?: ContactStatus;
      tag?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.tag) qs.set("tag", params.tag);
    if (params.q) qs.set("q", params.q);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const tail = qs.toString();
    return request<ContactListDTO>(
      "GET",
      `/admin/audiences/${audienceId}/contacts${tail ? `?${tail}` : ""}`
    );
  },
  createContact: (audienceId: string, input: CreateContactInput) =>
    request<ContactDTO>(
      "POST",
      `/admin/audiences/${audienceId}/contacts`,
      input
    ),
  updateContact: (id: string, input: UpdateContactInput) =>
    request<ContactDTO>("PATCH", `/admin/contacts/${id}`, input),
  deleteContact: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/contacts/${id}`),
  // segments (saved filters over an audience)
  listSegments: (audienceId: string) =>
    request<SegmentDTO[]>("GET", `/admin/audiences/${audienceId}/segments`),
  createSegment: (audienceId: string, input: CreateSegmentInput) =>
    request<SegmentDTO>(
      "POST",
      `/admin/audiences/${audienceId}/segments`,
      input
    ),
  updateSegment: (id: string, input: UpdateSegmentInput) =>
    request<SegmentDTO>("PATCH", `/admin/segments/${id}`, input),
  deleteSegment: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/segments/${id}`),

  // email templates (MJML + Handlebars)
  listEmailTemplates: () =>
    request<EmailTemplateDTO[]>("GET", "/admin/email/templates"),
  getEmailTemplate: (id: string) =>
    request<EmailTemplateDTO>("GET", `/admin/email/templates/${id}`),
  createEmailTemplate: (input: CreateEmailTemplateInput) =>
    request<EmailTemplateDTO>("POST", "/admin/email/templates", input),
  updateEmailTemplate: (id: string, input: UpdateEmailTemplateInput) =>
    request<EmailTemplateDTO>("PATCH", `/admin/email/templates/${id}`, input),
  deleteEmailTemplate: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/email/templates/${id}`),
  // ad-hoc render for the live editor preview (no saved row needed)
  previewEmailTemplate: (input: {
    subject: string;
    mjml: string;
    vars?: Record<string, unknown>;
  }) =>
    request<RenderPreviewResult>("POST", "/admin/email/templates/preview", input),
  // send a real test of a saved template (no dedupe) -> EmailLog status
  testSendEmailTemplate: (
    id: string,
    input: { to: string; vars?: Record<string, unknown> },
  ) =>
    request<EmailSendResultDTO>(
      "POST",
      `/admin/email/templates/${id}/test-send`,
      input,
    ),

  // campaigns (scheduled broadcasts)
  listCampaigns: () =>
    request<CampaignDTO[]>("GET", "/admin/email/campaigns"),
  getCampaign: (id: string) =>
    request<CampaignDTO>("GET", `/admin/email/campaigns/${id}`),
  createCampaign: (input: CampaignInput) =>
    request<CampaignDTO>("POST", "/admin/email/campaigns", input),
  updateCampaign: (id: string, input: CampaignInput) =>
    request<CampaignDTO>("PATCH", `/admin/email/campaigns/${id}`, input),
  deleteCampaign: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/email/campaigns/${id}`),
  scheduleCampaign: (id: string) =>
    request<CampaignDTO>("POST", `/admin/email/campaigns/${id}/schedule`),
  pauseCampaign: (id: string) =>
    request<CampaignDTO>("POST", `/admin/email/campaigns/${id}/pause`),

  // automations (event-triggered emails)
  listAutomations: () =>
    request<AutomationDTO[]>("GET", "/admin/email/automations"),
  createAutomation: (input: AutomationInput) =>
    request<AutomationDTO>("POST", "/admin/email/automations", input),
  updateAutomation: (id: string, input: AutomationInput) =>
    request<AutomationDTO>("PATCH", `/admin/email/automations/${id}`, input),
  deleteAutomation: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/email/automations/${id}`),

  // email logs (the send ledger; paginated, filter by status + free-text search)
  listEmailLogs: (
    params: { status?: string; q?: string; page?: number; pageSize?: number } = {}
  ) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const tail = qs.toString();
    return request<EmailLogListDTO>(
      "GET",
      `/admin/email/logs${tail ? `?${tail}` : ""}`
    );
  },

  // certificates (templates + issued)
  listCertificateTemplates: () =>
    request<CertificateTemplateDTO[]>("GET", "/admin/certificate-templates"),
  getCertificateTemplate: (id: string) =>
    request<CertificateTemplateDTO>("GET", `/admin/certificate-templates/${id}`),
  createCertificateTemplate: (input: CreateCertificateTemplateInput) =>
    request<CertificateTemplateDTO>("POST", "/admin/certificate-templates", input),
  updateCertificateTemplate: (id: string, input: UpdateCertificateTemplateInput) =>
    request<CertificateTemplateDTO>(
      "PATCH",
      `/admin/certificate-templates/${id}`,
      input
    ),
  deleteCertificateTemplate: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/certificate-templates/${id}`),
  listCertificates: (params: { q?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    const tail = qs.toString();
    return request<AdminCertificateListDTO>(
      "GET",
      `/admin/certificates${tail ? `?${tail}` : ""}`
    );
  },
  deleteCertificate: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/certificates/${id}`),
  downloadCertificate: (row: { id: string; serial: string; className: string }) =>
    downloadBlob(
      `/certificates/${row.id}/download`,
      `Certificate ${row.serial} - ${row.className}.pdf`
    ),

  // projects: internal team chat + task lists (admin-only, RBAC `projects`)
  // ---- channels ----
  listChannels: () =>
    request<ChatChannelDTO[]>("GET", "/admin/projects/channels"),
  createChannel: (input: CreateChatChannelInput) =>
    request<ChatChannelDetailDTO>("POST", "/admin/projects/channels", input),
  getChannel: (id: string) =>
    request<ChatChannelDetailDTO>("GET", `/admin/projects/channels/${id}`),
  updateChannel: (id: string, input: UpdateChatChannelInput) =>
    request<ChatChannelDetailDTO>(
      "PATCH",
      `/admin/projects/channels/${id}`,
      input
    ),
  joinChannel: (id: string) =>
    request<ChatChannelDetailDTO>(
      "POST",
      `/admin/projects/channels/${id}/join`
    ),
  leaveChannel: (id: string) =>
    request<{ ok: true }>("POST", `/admin/projects/channels/${id}/leave`),

  // ---- direct messages (DMs) ----
  // Open-or-get a DM with one or more OTHER admins (the actor is added
  // server-side). Deduped by a sorted-member key, so opening the same set twice
  // returns the existing channel. The returned channel loads in the same pane.
  openDm: (adminIds: string[]) =>
    request<ChatChannelDTO>("POST", "/admin/projects/dms", {
      adminIds,
    } satisfies OpenDmInput),
  listDms: () => request<ChatDmDTO[]>("GET", "/admin/projects/dms"),

  // ---- messages ----
  // Catch-up fetch: pass `afterSeq` to only pull messages newer than what we've
  // already rendered (drives the 4s append-poll). `limit` defaults to 50 server-side.
  listMessages: (channelId: string, afterSeq?: number, limit?: number) => {
    const qs = new URLSearchParams();
    if (afterSeq !== undefined) qs.set("afterSeq", String(afterSeq));
    if (limit !== undefined) qs.set("limit", String(limit));
    const tail = qs.toString();
    return request<ChatMessageDTO[]>(
      "GET",
      `/admin/projects/channels/${channelId}/messages${tail ? `?${tail}` : ""}`
    );
  },
  sendMessage: (
    channelId: string,
    input: SendMessageInput
  ): Promise<ChatMessageDTO> =>
    request<ChatMessageDTO>(
      "POST",
      `/admin/projects/channels/${channelId}/messages`,
      input
    ),
  editMessage: (messageId: string, body: string) =>
    request<ChatMessageDTO>("PATCH", `/admin/projects/messages/${messageId}`, {
      body,
    }),
  deleteMessage: (messageId: string) =>
    request<ChatMessageDTO>(
      "DELETE",
      `/admin/projects/messages/${messageId}`
    ),
  listReplies: (messageId: string) =>
    request<ChatMessageDTO[]>(
      "GET",
      `/admin/projects/messages/${messageId}/replies`
    ),
  toggleReaction: (messageId: string, emoji: string) =>
    request<ChatMessageDTO>(
      "POST",
      `/admin/projects/messages/${messageId}/reactions`,
      { emoji } satisfies ChatReactionToggleInput
    ),
  // `seq` omitted => server marks the channel read up to its current max seq.
  markRead: (channelId: string, seq?: number) =>
    request<{ ok: true }>(
      "POST",
      `/admin/projects/channels/${channelId}/read`,
      seq !== undefined ? { seq } : {}
    ),
  getUnread: () =>
    request<UnreadSummaryDTO>("GET", "/admin/projects/unread"),

  // ---- lists (task boards) ----
  listLists: (channelId?: string) =>
    request<ChatListDTO[]>(
      "GET",
      `/admin/projects/lists${
        channelId ? `?channelId=${encodeURIComponent(channelId)}` : ""
      }`
    ),
  createList: (input: CreateChatListInput) =>
    request<ChatListDTO>("POST", "/admin/projects/lists", input),
  createListItem: (listId: string, input: CreateChatListItemInput) =>
    request<ChatListItemDTO>(
      "POST",
      `/admin/projects/lists/${listId}/items`,
      input
    ),
  updateListItem: (itemId: string, input: UpdateChatListItemInput) =>
    request<ChatListItemDTO>(
      "PATCH",
      `/admin/projects/list-items/${itemId}`,
      input
    ),
  deleteListItem: (itemId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/projects/list-items/${itemId}`
    ),
  // Turn a chat message into a task in `listId`; title = the (truncated) body.
  messageToTask: (messageId: string, listId: string) =>
    request<ChatListItemDTO>(
      "POST",
      `/admin/projects/messages/${messageId}/to-task`,
      { listId }
    ),

  // ---- lists: custom fields (Slack-Lists columns) ----
  createField: (listId: string, input: CreateListFieldInput) =>
    request<ChatListFieldDTO>(
      "POST",
      `/admin/projects/lists/${listId}/fields`,
      input
    ),
  updateField: (fieldId: string, input: UpdateListFieldInput) =>
    request<ChatListFieldDTO>(
      "PATCH",
      `/admin/projects/list-fields/${fieldId}`,
      input
    ),
  deleteField: (fieldId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/projects/list-fields/${fieldId}`
    ),
  reorderFields: (listId: string, orderedFieldIds: string[]) =>
    request<ChatListFieldDTO[]>(
      "POST",
      `/admin/projects/lists/${listId}/fields/reorder`,
      { orderedFieldIds } satisfies ReorderListFieldsInput
    ),

  // ---- lists: item custom-field values (validated against each field's type) ----
  updateItemValues: (itemId: string, values: Record<string, unknown>) =>
    request<ChatListItemDTO>(
      "PATCH",
      `/admin/projects/list-items/${itemId}/values`,
      { values } satisfies UpdateListItemValuesInput
    ),

  // ---- lists: per-item comment thread (the 💬) ----
  listItemComments: (itemId: string) =>
    request<ChatListItemCommentDTO[]>(
      "GET",
      `/admin/projects/list-items/${itemId}/comments`
    ),
  createItemComment: (itemId: string, body: string) =>
    request<ChatListItemCommentDTO>(
      "POST",
      `/admin/projects/list-items/${itemId}/comments`,
      { body } satisfies CreateListItemCommentInput
    ),
  editItemComment: (commentId: string, body: string) =>
    request<ChatListItemCommentDTO>(
      "PATCH",
      `/admin/projects/list-item-comments/${commentId}`,
      { body } satisfies UpdateListItemCommentInput
    ),
  deleteItemComment: (commentId: string) =>
    request<{ ok: true }>(
      "DELETE",
      `/admin/projects/list-item-comments/${commentId}`
    ),

  // ---- workflows (auto-post a list event into a channel — the Image-1 flow) ----
  listWorkflows: (listId?: string) =>
    request<ChatWorkflowDTO[]>(
      "GET",
      `/admin/projects/workflows${
        listId ? `?listId=${encodeURIComponent(listId)}` : ""
      }`
    ),
  createWorkflow: (input: CreateWorkflowInput) =>
    request<ChatWorkflowDTO>("POST", "/admin/projects/workflows", input),
  updateWorkflow: (id: string, input: UpdateWorkflowInput) =>
    request<ChatWorkflowDTO>(
      "PATCH",
      `/admin/projects/workflows/${id}`,
      input
    ),
  deleteWorkflow: (id: string) =>
    request<{ ok: true }>("DELETE", `/admin/projects/workflows/${id}`),

  // ---- canvas docs (rich-text channel tabs — the "Web SOP" tab) ----
  // The channel detail (getChannel) already carries lists+canvases for the tab
  // bar; these load/edit a canvas's full content when its tab is selected.
  listCanvases: (channelId: string) =>
    request<ChatCanvasDTO[]>(
      "GET",
      `/admin/projects/channels/${channelId}/canvases`
    ),
  createCanvas: (channelId: string, input: CreateCanvasInput) =>
    request<ChatCanvasDTO>(
      "POST",
      `/admin/projects/channels/${channelId}/canvases`,
      input
    ),
  updateCanvas: (canvasId: string, input: UpdateCanvasInput) =>
    request<ChatCanvasDTO>(
      "PATCH",
      `/admin/projects/canvases/${canvasId}`,
      input
    ),
  deleteCanvas: (canvasId: string) =>
    request<{ ok: true }>("DELETE", `/admin/projects/canvases/${canvasId}`),

  // NOTE: the admin roster used for @mention resolution + author/assignee display
  // names comes from the existing `listAdmins()` method (GET /admin/admins). That
  // endpoint is SuperAdminGuard-protected, so it 403s for non-super admins — the
  // Projects pages treat a rejection as "names unavailable" and degrade gracefully
  // (render @text, pass mentionedAdminIds: []).
};
