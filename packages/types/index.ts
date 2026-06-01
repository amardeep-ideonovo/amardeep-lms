// Shared types + API contract across api / admin / web / mobile.
// This is the single source of truth all four apps build against.

// ---------- Enums (mirror Prisma) ----------
export type LevelType = "PAID" | "FREE" | "MANUAL";
export type UserLevelSource = "STRIPE" | "MANUAL";
export type UserLevelStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "EDITOR";

// ---------- DTOs ----------
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}
export interface AuthAdmin {
  id: string;
  email: string;
  role: AdminRole;
}
export interface LoginResponse<T = AuthUser> {
  token: string;
  user: T;
}

// Public signup — used by /auth/signup (web + mobile signup screens).
// `inviteCode` is required only if SIGNUP_INVITE_CODE is set on the API.
export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  inviteCode?: string;
}

// Member self-service profile edit (PATCH /auth/me). Email is intentionally
// omitted — members cannot change their own email (admin-only).
export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  username?: string;
}

// Member changes their own password (current password required to authorize).
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface PriceDTO {
  id: string;
  stripePriceId: string;
  interval: "month" | "year";
  amount: number; // cents
  currency: string;
}
export interface LevelDTO {
  id: string;
  name: string;
  slug: string | null; // pretty checkout URL key (/checkout/<slug>); null = use raw id
  type: LevelType;
  mailchimpTags: string[]; // tags applied within the audience on grant
  mailchimpAudienceId: string | null; // Mailchimp list this level subscribes members to
  mailchimpAudienceName: string | null; // cached name for display
  stripeProductId: string | null;
  prices: PriceDTO[];
  // Distinct members currently holding this level (ACTIVE). Only populated for
  // admin requests; 0 for member-facing calls so subscriber counts aren't leaked.
  memberCount: number;
}

// Public, unauthenticated checkout resolution (GET /levels/checkout/:slugOrId) —
// only what the checkout page needs (no member counts or marketing config).
export interface CheckoutLevelDTO {
  id: string;
  name: string;
  slug: string | null;
  prices: PriceDTO[];
}

export interface CreateLevelInput {
  name: string;
  slug?: string; // optional pretty checkout URL slug (slugified server-side)
  type: LevelType;
  mailchimpTags?: string[];
  mailchimpAudienceId?: string;
  mailchimpAudienceName?: string;
  prices?: { interval: "month" | "year"; amount: number; currency?: string }[];
}

// A member's own live paid subscription, surfaced to the web app so the
// pricing/checkout UI can flag a plan they already pay for and route them to
// the customer portal instead of starting a duplicate checkout.
export interface MySubscriptionDTO {
  levelId: string;
  status: Extract<UserLevelStatus, "ACTIVE" | "PAST_DUE">;
}

// ---------- Checkout / Stripe Elements (member) ----------
// Public config the checkout page needs to mount Stripe Elements. When
// `publishableKey` is null, Stripe isn't configured on this environment and the
// web app falls back to a mock payment path (UI stays fully testable).
export interface BillingConfigDTO {
  publishableKey: string | null;
}
// Start an embedded (Elements) subscription. `couponCode` is an optional Stripe
// promotion code applied to the subscription.
export interface SubscribeInput {
  priceId: string; // our Stripe price id (price_…)
  couponCode?: string;
}
// Result of POST /billing/subscribe. `clientSecret` confirms the first invoice's
// PaymentIntent on the client via Stripe.js. The web layer substitutes a
// "mock" status when Stripe isn't configured so the UI can simulate success.
export interface SubscribeResult {
  status: "requires_payment" | "active" | "mock";
  clientSecret: string | null;
  subscriptionId: string | null;
}
export interface CouponValidateInput {
  code: string;
  priceId: string;
}
// Preview of a validated coupon / promotion code against a price.
export interface CouponPreviewDTO {
  valid: boolean;
  code: string;
  label: string | null; // e.g. "20% off" / "$50.00 off"
  amountOff: number | null; // minor units off the first charge (computed)
  percentOff: number | null;
  message: string | null; // reason when invalid
}

// Admin coupon management (Stripe promotion code + its coupon). `id` is the
// Stripe promotion code id; redemption counts + status are read live from Stripe.
export interface CouponDTO {
  id: string;
  code: string;
  active: boolean;
  discountType: "percent" | "amount";
  percentOff: number | null;
  amountOff: number | null; // minor units
  currency: string | null;
  duration: "once" | "repeating" | "forever";
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: string | null; // ISO
  levelId: string | null; // set when restricted to a single level
  levelName: string | null;
  createdAt: string; // ISO
}
export interface CreateCouponInput {
  code: string;
  discountType: "percent" | "amount";
  percentOff?: number; // 1–100 when discountType="percent"
  amountOff?: number; // minor units when discountType="amount"
  currency?: string; // for amount coupons (default usd)
  duration: "once" | "repeating" | "forever";
  durationInMonths?: number; // required when duration="repeating"
  maxRedemptions?: number;
  expiresAt?: string; // ISO date
  levelId?: string; // restrict to one level
}

// ---------- Subscription detail + payment history (member self + admin) ----------
// A live subscription's real terms — the actual price the member is on (fixes
// "showing /month when they bought /year"), plus status + pause/cancel flags.
export interface SubscriptionDetailDTO {
  stripeSubId: string;
  levelId: string;
  levelName: string;
  status: string; // stripe sub status: active | past_due | paused | trialing | …
  interval: string; // "month" | "year" (the subscribed price's interval)
  amount: number; // minor units (the actual subscribed price)
  currency: string;
  currentPeriodEnd: string | null; // ISO — when the paid period ends / renews
  cancelAtPeriodEnd: boolean; // true once "Cancel" was used (reversible)
  paused: boolean; // true while billing is paused (access retained)
}
// One row of payment history (a Stripe invoice).
export interface InvoiceDTO {
  id: string;
  number: string | null;
  created: string; // ISO
  amountPaid: number; // minor units
  amountDue: number; // minor units
  currency: string;
  status: string; // paid | open | void | uncollectible | draft
  description: string | null; // first line item / plan
  hostedInvoiceUrl: string | null; // Stripe-hosted receipt
  invoicePdf: string | null;
}
// Admin per-member billing bundle (subscriptions + payment history).
export interface MemberBillingDTO {
  member: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  subscriptions: SubscriptionDetailDTO[];
  invoices: InvoiceDTO[];
}

export interface MemberRow {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  registeredAt: string; // ISO
  levels: { id: string; name: string; status: UserLevelStatus }[];
  // Paid-subscription summary for the admin list (derived from STRIPE grants;
  // null when the member has never had a paid subscription).
  subscription: {
    active: boolean;
    status: UserLevelStatus;
    planName: string;
  } | null;
}
// Admin-editable member profile fields (Members tab). Changing `email` also
// re-points the member's login, Stripe receipts, and Mailchimp contact.
export interface UpdateMemberInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  thumbnailUrl: string | null; // tile image on the member dashboard
  order: number;
}
export interface CourseCard {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null; // squared thumbnail (cards)
  coverImageUrl: string | null; // wide cover/hero (course page)
  categoryId: string | null;
  levelIds: string[]; // assigned access levels (drives the admin edit form)
  locked: boolean; // computed from the viewer's active levels
  lessonCount: number; // total lessons in the course
  completedCount: number; // lessons the viewer has completed (0 for admin/no context)
}
// Downloadable lesson attachment (PDFs, docs, …). The file itself is never
// public — `downloadUrl` points at an access-checked API route the client
// fetches with the member's token.
export interface LessonNoteDTO {
  id: string;
  lessonId: string;
  originalName: string; // shown to the member; used as the saved filename
  mimeType: string;
  size: number; // bytes
  order: number;
  downloadUrl: string; // API path: GET /lessons/:id/notes/:noteId/download (auth required)
}
export interface LessonDTO {
  id: string;
  courseId: string;
  title: string;
  content: string | null;
  thumbnailUrl?: string | null; // lesson thumbnail
  muxPlaybackToken?: string; // signed; present only when the viewer has access
  videoUrl?: string | null; // direct video URL (sample/dev or non-Mux source)
  order: number;
  completed?: boolean;
  notes?: LessonNoteDTO[]; // downloadable attachments (present on detail views)
}
export interface DashboardResponse {
  categories: { category: CategoryDTO; courses: CourseCard[] }[];
}

// ---------- Course / lesson admin inputs ----------
export interface CreateCourseInput {
  title: string;
  description?: string;
  thumbnailUrl?: string;
  coverImageUrl?: string;
  categoryId?: string;
  levelIds?: string[];
  order?: number;
}
export type UpdateCourseInput = Partial<CreateCourseInput>;

export interface CreateLessonInput {
  title: string;
  content?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  muxAssetId?: string;
  order?: number;
}
export type UpdateLessonInput = Partial<CreateLessonInput>;

// ---------- Blog ----------
// Public marketing/news content. PUBLISHED posts are readable without login;
// DRAFTs are admin-only. Content is sanitized HTML (rich text).
export type PostStatus = "DRAFT" | "PUBLISHED";

export interface PostCategoryDTO {
  id: string;
  name: string;
  slug: string;
  order: number;
}
export interface PostAuthorDTO {
  id: string;
  name: string; // display name (no credentials ever exposed)
}
// Public list card.
export interface PostListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  categories: PostCategoryDTO[];
  tags: string[];
  author: PostAuthorDTO | null;
  publishedAt: string | null; // ISO
}
// Public detail = card + sanitized HTML body.
export interface PostDetailDTO extends PostListItem {
  content: string;
}
// Admin row: includes drafts, raw status, and timestamps.
export interface PostAdminRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImageUrl: string | null;
  status: PostStatus;
  categoryIds: string[];
  categories: PostCategoryDTO[];
  tags: string[];
  author: PostAuthorDTO | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CreatePostInput {
  title: string;
  excerpt?: string;
  content?: string; // HTML (sanitized server-side)
  coverImageUrl?: string;
  categoryIds?: string[];
  tags?: string[];
  status?: PostStatus; // default DRAFT
}
export type UpdatePostInput = Partial<CreatePostInput>;
export interface CreatePostCategoryInput {
  name: string;
  order?: number;
}

// ---------- Pages (CMS / Puck) ----------
// Visual page-builder content authored in the admin with Puck and rendered on
// the public site by the shared @lms/puck block components. PUBLISHED pages are
// readable without login; DRAFTs are admin-only. `data` is the Puck document
// (an opaque JSON envelope here — concrete block prop shapes live in @lms/puck).
// Any embedded rich-text HTML is sanitized server-side on write.
export type PageStatus = "DRAFT" | "PUBLISHED";

export interface PageAuthorDTO {
  id: string;
  name: string; // display name (no credentials ever exposed)
}
// One placed block inside a Puck document.
export interface PuckComponentData {
  type: string;
  props: Record<string, unknown> & { id?: string };
}
// The Puck document envelope persisted in Page.data and fed to <Puck>/<Render>.
export interface PuckDocument {
  root: { props?: Record<string, unknown> };
  content: PuckComponentData[];
  zones?: Record<string, PuckComponentData[]>;
}
// Public render payload (only PUBLISHED pages reach this).
export interface PagePublicDTO {
  id: string; // used to target popups at specific pages
  slug: string;
  title: string;
  data: PuckDocument;
  publishedAt: string | null; // ISO
}
// Admin list row (table view — omits the heavy document body).
export interface PageListItem {
  id: string;
  slug: string;
  title: string;
  status: PageStatus;
  publishedAt: string | null;
  updatedAt: string;
}
// Full admin record the editor loads by id.
export interface PageAdminRow extends PageListItem {
  data: PuckDocument;
  author: PageAuthorDTO | null;
  createdAt: string;
}
export interface CreatePageInput {
  title: string;
  slug?: string; // optional custom slug; otherwise derived from the title
  data?: PuckDocument;
  status?: PageStatus; // default DRAFT
}
export type UpdatePageInput = Partial<CreatePageInput>;

// ---------- Mailchimp-linked Forms ----------
// Admin-authored forms (configurable field builder) whose submissions subscribe
// people to a chosen Mailchimp audience. The Mailchimp API key/server prefix are
// the one-time encrypted Settings; each form picks its own audience.
export type FormStatus = "ACTIVE" | "INACTIVE";

export type FormFieldType =
  | "text"
  | "email"
  | "textarea"
  | "phone"
  | "number"
  | "checkbox"
  | "select";

// One configurable field. `mergeTag` maps the value to a Mailchimp merge field;
// the field whose mergeTag is "EMAIL" is treated as the subscriber email.
export interface FormFieldDef {
  id: string; // stable client id (for the builder + React keys)
  type: FormFieldType;
  label: string;
  name: string; // key under which the value is stored in submission data
  required: boolean;
  placeholder?: string;
  options?: string[]; // for "select"
  mergeTag?: string; // Mailchimp merge tag (EMAIL, FNAME, …) or empty for local-only
}

// Live Mailchimp data (admin only).
export interface MailchimpAudienceDTO {
  id: string;
  name: string;
  memberCount?: number;
}
export interface MailchimpMergeFieldDTO {
  tag: string; // EMAIL, FNAME, PHONE, …
  name: string; // display label
  type: string; // text, number, address, …
  required: boolean;
}

// Public render payload (only ACTIVE forms are exposed).
export interface FormPublicDTO {
  id: string;
  name: string;
  fields: FormFieldDef[];
  successMessage: string | null;
  redirectUrl: string | null;
}
// Admin record: full config + counts.
export interface FormAdminRow {
  id: string;
  name: string;
  fields: FormFieldDef[];
  mailchimpAudienceId: string | null;
  mailchimpAudienceName: string | null;
  doubleOptIn: boolean;
  updateExisting: boolean;
  tags: string[];
  successMessage: string | null;
  redirectUrl: string | null;
  status: FormStatus;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface CreateFormInput {
  name: string;
  fields?: FormFieldDef[];
  mailchimpAudienceId?: string;
  mailchimpAudienceName?: string;
  doubleOptIn?: boolean; // default false (No)
  updateExisting?: boolean; // default true (Yes)
  tags?: string[];
  successMessage?: string;
  redirectUrl?: string;
  status?: FormStatus;
}
export type UpdateFormInput = Partial<CreateFormInput>;

// Public submit.
export interface FormSubmitInput {
  values: Record<string, string | number | boolean>;
}
export interface FormSubmitResult {
  ok: boolean;
  mailchimpStatus: string | null; // subscribed | pending | existing | failed | skipped
  redirectUrl: string | null;
  message: string | null;
}

// A stored submission (admin entries viewer). `data` holds every submitted
// field value keyed by the field's `name`.
export interface FormSubmissionDTO {
  id: string;
  email: string | null;
  data: Record<string, string | number | boolean>;
  mailchimpStatus: string | null;
  createdAt: string; // ISO
}

// ---------- Popups (Puck overlay) ----------
// Popups reuse the SAME visual editor (Puck) as Pages — `data` is a PuckDocument
// rendered by the shared @lms/puck blocks inside a styled, positioned overlay.
// On top of the content they carry presentation settings + visibility targeting
// (where to show: the member dashboard and/or specific CMS pages). Only ACTIVE
// popups are returned by the public targeting endpoint.
export type PopupStatus = "ACTIVE" | "INACTIVE";

// On-screen placement of the popup box.
export type PopupPosition =
  | "CENTER"
  | "TOP"
  | "BOTTOM"
  | "TOP_LEFT"
  | "TOP_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_RIGHT";

// How a popup targets CMS pages (independent of the dashboard toggle).
//   NONE    — not shown on any CMS page
//   ALL     — shown on every CMS page
//   INCLUDE — shown only on the pages listed in pageIds
//   EXCLUDE — shown on every CMS page except those listed in pageIds
export type PopupPageMode = "NONE" | "ALL" | "INCLUDE" | "EXCLUDE";

// Presentation settings sent to the renderer.
export interface PopupStyleDTO {
  width: string; // CSS length (e.g. "480px", "90%", "auto")
  height: string;
  background: string; // CSS color of the popup box
  position: PopupPosition;
  borderColor: string;
  borderRadius: number; // px
  padding: number; // px
}

// Public render payload (only ACTIVE popups are exposed). Visibility fields are
// NOT included — the server already filtered by context.
export interface PopupPublicDTO {
  id: string;
  name: string;
  data: PuckDocument;
  style: PopupStyleDTO;
}

// Admin list row (table view — omits the heavy document body).
export interface PopupListItem {
  id: string;
  name: string;
  status: PopupStatus;
  position: PopupPosition;
  showOnDashboard: boolean;
  pageMode: PopupPageMode;
  pageCount: number; // number of targeted page ids (for INCLUDE/EXCLUDE)
  views: number;
  clicks: number;
  dismissals: number;
  updatedAt: string;
}

// Full admin record the editor loads by id (flattened style + visibility).
export interface PopupAdminRow {
  id: string;
  name: string;
  data: PuckDocument;
  status: PopupStatus;
  width: string;
  height: string;
  background: string;
  position: PopupPosition;
  borderColor: string;
  borderRadius: number;
  padding: number;
  showOnDashboard: boolean;
  pageMode: PopupPageMode;
  pageIds: string[];
  views: number;
  clicks: number;
  dismissals: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePopupInput {
  name: string;
  data?: PuckDocument;
  status?: PopupStatus; // default INACTIVE
  width?: string;
  height?: string;
  background?: string;
  position?: PopupPosition;
  borderColor?: string;
  borderRadius?: number;
  padding?: number;
  showOnDashboard?: boolean;
  pageMode?: PopupPageMode;
  pageIds?: string[];
}
export type UpdatePopupInput = Partial<CreatePopupInput>;

// Context the public renderer asks about. Dashboard has no id; a CMS page
// passes its page id so INCLUDE/EXCLUDE targeting can be evaluated.
export type PopupContext =
  | { type: "dashboard" }
  | { type: "page"; pageId: string };

// Analytics events the renderer reports (fire-and-forget, public).
export type PopupEventType = "view" | "click" | "dismiss";

// ---------- REST contract ----------
// Base: process.env API URL. All authed routes use `Authorization: Bearer <token>`.
export const ROUTES = {
  // auth
  memberLogin: "POST /auth/login", // body {email,password} -> LoginResponse<AuthUser>
  memberSignup: "POST /auth/signup", // body SignupInput -> LoginResponse<AuthUser>
  adminLogin: "POST /auth/admin/login", // -> LoginResponse<AuthAdmin>
  me: "GET /auth/me",
  updateMe: "PATCH /auth/me", // body UpdateProfileInput -> AuthUser (member self-service)
  changePassword: "POST /auth/change-password", // body ChangePasswordInput -> { ok: true }

  // admin: levels
  listLevels: "GET /levels",
  createLevel: "POST /levels",
  updateLevel: "PATCH /levels/:id",
  deleteLevel: "DELETE /levels/:id",
  checkoutLevel: "GET /levels/checkout/:slugOrId", // public — resolve a level for checkout by slug or id

  // admin: members
  listMembers: "GET /members", // -> MemberRow[]
  updateMember: "PATCH /members/:id", // body UpdateMemberInput -> MemberRow
  addMemberLevel: "POST /members/:id/levels", // body {levelId}
  removeMemberLevel: "DELETE /members/:id/levels/:levelId",
  adminSetMemberPassword: "POST /members/:id/password", // admin override — set a member's password (no current pw)

  // admin: coupons (Stripe-backed; create/list/deactivate)
  adminListCoupons: "GET /admin/coupons", // -> CouponDTO[]
  adminCreateCoupon: "POST /admin/coupons", // body CreateCouponInput -> CouponDTO
  adminDeactivateCoupon: "POST /admin/coupons/:id/deactivate", // -> CouponDTO
  adminActivateCoupon: "POST /admin/coupons/:id/activate", // -> CouponDTO
  adminDeleteCoupon: "DELETE /admin/coupons/:id", // -> { ok: true } (deletes the Stripe coupon)

  // lms
  listCategories: "GET /categories",
  createCategory: "POST /categories", // body {name, order?, thumbnailUrl?}
  deleteCategory: "DELETE /categories/:id", // uncategorizes its courses
  uploadCategoryImage: "POST /categories/upload", // multipart {file} -> {url}
  listCourses: "GET /courses", // admin: all; member: includes locked flag
  createCourse: "POST /courses", // body CreateCourseInput
  updateCourse: "PATCH /courses/:id", // body UpdateCourseInput
  deleteCourse: "DELETE /courses/:id", // cascades lessons/levels/notes
  uploadCourseImage: "POST /courses/upload", // multipart {file} -> {url}; for thumbnail or cover
  listCourseLessons: "GET /courses/:id/lessons",
  createLesson: "POST /courses/:id/lessons", // body CreateLessonInput
  updateLesson: "PATCH /lessons/:id", // body UpdateLessonInput
  deleteLesson: "DELETE /lessons/:id",
  uploadLessonImage: "POST /lessons/upload", // multipart {file} -> {url}; lesson thumbnail
  getLesson: "GET /lessons/:id", // 403 if viewer lacks access; includes notes[]
  completeLesson: "POST /lessons/:id/complete",
  // lesson notes (downloadable attachments)
  uploadLessonNotes: "POST /lessons/:id/notes", // admin; multipart {files[]} -> LessonNoteDTO[]
  updateLessonNote: "PATCH /lessons/:id/notes/:noteId", // admin; rename {originalName}
  deleteLessonNote: "DELETE /lessons/:id/notes/:noteId", // admin
  downloadLessonNote: "GET /lessons/:id/notes/:noteId/download", // member (access-checked); accepts ?token=

  // member dashboard
  dashboard: "GET /dashboard", // -> DashboardResponse

  // blog — PUBLIC (no auth): only PUBLISHED posts are visible
  listPublishedPosts: "GET /blog/posts", // -> PostListItem[]
  getPublishedPost: "GET /blog/posts/:slug", // -> PostDetailDTO (404 if draft/missing)
  listPostCategories: "GET /blog/categories", // -> PostCategoryDTO[]

  // blog — ADMIN (full CRUD, includes drafts)
  adminListPosts: "GET /admin/blog/posts", // -> PostAdminRow[]
  adminCreatePost: "POST /admin/blog/posts", // body CreatePostInput -> PostAdminRow
  adminUpdatePost: "PATCH /admin/blog/posts/:id", // body UpdatePostInput -> PostAdminRow
  adminDeletePost: "DELETE /admin/blog/posts/:id",
  adminCreatePostCategory: "POST /admin/blog/categories", // body CreatePostCategoryInput
  adminDeletePostCategory: "DELETE /admin/blog/categories/:id", // posts become uncategorized

  // pages — PUBLIC (no auth): only PUBLISHED pages are visible
  listPublishedPages: "GET /pages", // -> PageListItem[]
  getPublishedPage: "GET /pages/:slug", // -> PagePublicDTO (404 if draft/missing)

  // pages — ADMIN (full CRUD, includes drafts; editor loads one by id)
  adminListPages: "GET /admin/pages", // -> PageListItem[]
  adminGetPage: "GET /admin/pages/:id", // -> PageAdminRow
  adminCreatePage: "POST /admin/pages", // body CreatePageInput -> PageAdminRow
  adminUpdatePage: "PATCH /admin/pages/:id", // body UpdatePageInput -> PageAdminRow
  adminDeletePage: "DELETE /admin/pages/:id",
  adminUploadPageImage: "POST /admin/pages/upload", // multipart {file} -> {url}

  // forms (Mailchimp-linked) — ADMIN
  adminListForms: "GET /admin/forms", // -> FormAdminRow[]
  adminGetForm: "GET /admin/forms/:id", // -> FormAdminRow
  adminCreateForm: "POST /admin/forms", // body CreateFormInput -> FormAdminRow
  adminUpdateForm: "PATCH /admin/forms/:id", // body UpdateFormInput -> FormAdminRow
  adminDeleteForm: "DELETE /admin/forms/:id",
  adminListFormSubmissions: "GET /admin/forms/:id/submissions", // -> FormSubmissionDTO[]
  adminListMailchimpAudiences: "GET /admin/mailchimp/audiences", // -> MailchimpAudienceDTO[] (live)
  adminListMailchimpMergeFields: "GET /admin/mailchimp/audiences/:id/merge-fields", // -> MailchimpMergeFieldDTO[]

  // forms — PUBLIC (no auth): only ACTIVE forms
  getPublicForm: "GET /forms/:id", // -> FormPublicDTO (404 if inactive/missing)
  submitForm: "POST /forms/:id/submit", // body FormSubmitInput -> FormSubmitResult

  // popups — PUBLIC (no auth): only ACTIVE popups, filtered by context
  // ?context=dashboard | ?context=page&pageId=<id>  -> PopupPublicDTO[]
  listActivePopups: "GET /popups/active",
  recordPopupEvent: "POST /popups/:id/event", // body { type: PopupEventType } (fire-and-forget)

  // popups — ADMIN (full CRUD; editor loads one by id)
  adminListPopups: "GET /admin/popups", // -> PopupListItem[]
  adminGetPopup: "GET /admin/popups/:id", // -> PopupAdminRow
  adminCreatePopup: "POST /admin/popups", // body CreatePopupInput -> PopupAdminRow
  adminUpdatePopup: "PATCH /admin/popups/:id", // body UpdatePopupInput -> PopupAdminRow
  adminDeletePopup: "DELETE /admin/popups/:id",

  // billing (member)
  checkout: "POST /billing/checkout", // body {priceId} -> {url}
  portal: "GET /billing/portal", // -> {url} (Stripe Customer Portal)
  mySubscriptions: "GET /billing/subscriptions", // -> MySubscriptionDTO[] (member's active paid levels)
  stripeWebhook: "POST /billing/webhook",
  billingConfig: "GET /billing/config", // -> BillingConfigDTO (public; Stripe Elements publishable key)
  subscribe: "POST /billing/subscribe", // body SubscribeInput -> SubscribeResult (Elements clientSecret)
  validateCoupon: "POST /billing/coupon/validate", // body CouponValidateInput -> CouponPreviewDTO
  mySubscriptionDetails: "GET /billing/subscription-details", // -> SubscriptionDetailDTO[]
  myInvoices: "GET /billing/invoices", // -> InvoiceDTO[] (member's own payment history)
  adminMemberBilling: "GET /billing/members/:id", // admin -> MemberBillingDTO
  adminPauseMemberSub: "POST /billing/members/:id/pause", // admin -> MemberBillingDTO
  adminResumeMemberSub: "POST /billing/members/:id/resume", // admin -> MemberBillingDTO
  adminCancelMemberSub: "POST /billing/members/:id/cancel", // admin (at period end) -> MemberBillingDTO

  // admin settings (secrets are write-only; GET returns masked/last4 only)
  getStripeSettings: "GET /admin/settings/stripe",
  putStripeSettings: "PUT /admin/settings/stripe", // body {secretKey?, webhookSecret?, publishableKey?}
  deleteStripeSettings: "DELETE /admin/settings/stripe", // clears all Stripe creds
  getMailchimpSettings: "GET /admin/settings/mailchimp",
  putMailchimpSettings: "PUT /admin/settings/mailchimp",
  deleteMailchimpSettings: "DELETE /admin/settings/mailchimp", // clears all Mailchimp creds
} as const;
