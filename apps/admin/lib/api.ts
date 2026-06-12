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
  LessonDTO,
  LessonNoteDTO,
  LevelCategoryDTO,
  LevelDTO,
  LoginResponse,
  MailchimpAudienceDTO,
  MailchimpMergeFieldDTO,
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
} from "@lms/types";
import { withBase } from "./base-path";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3000";

// Public API origin for asset URLs the browser loads directly (media previews,
// certificate fonts in the template editor's @font-face rules).
export const API_BASE_URL = BASE_URL;

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
  const res = await fetch(`${BASE_URL}${path}`, {
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
};
