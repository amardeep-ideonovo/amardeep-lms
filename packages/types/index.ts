// Shared types + API contract across api / admin / web / mobile.
// This is the single source of truth all four apps build against.

// ---------- Enums (mirror Prisma) ----------
export type LevelType = "PAID" | "FREE" | "MANUAL";
export type UserLevelSource = "STRIPE" | "MANUAL";
export type UserLevelStatus =
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED"
  | "PAUSED"; // billing paused — access suspended but resumable
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
  name: string | null; // display name (admin-editable); email is the login id
  avatarUrl: string | null; // profile photo URL (served from /media)
  role: AdminRole;
  permissions: AdminPermissions; // empty / ignored for SUPER_ADMIN (implicit full access)
  prefs: AdminPrefs; // per-admin UI preferences (custom sidebar order, etc.)
}

// Per-admin UI preferences. Personal, NOT access-controlling — every admin
// (including super admins) manages their own. `menuOrder` is the sidebar nav
// ordering by stable nav key; missing/unknown keys are reconciled client-side.
export interface AdminPrefs {
  menuOrder?: string[];
}

// ---------- Admin RBAC (per-section CRUD permissions) ----------
export const ADMIN_ACTIONS = ["create", "read", "edit", "delete"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

// Single source of truth for admin sections. Adding a new admin area? Add it
// here and it flows to the backend permission guard + the permission-matrix UI.
export const ADMIN_SECTIONS = [
  { key: "classes", label: "Classes" },
  { key: "coupons", label: "Coupons" },
  { key: "members", label: "Members" },
  { key: "subscriptions", label: "Subscriptions", readOnly: true },
  { key: "courses", label: "Courses" },
  { key: "gallery", label: "Gallery" },
  { key: "blog", label: "Blog" },
  { key: "pages", label: "Pages" },
  { key: "popups", label: "Popups" },
  { key: "forms", label: "Forms" },
  { key: "menus", label: "Navigation" },
  { key: "settings", label: "Settings" },
  // Read-only: the Reports tab only generates/downloads exports (no create/edit/delete).
  { key: "reports", label: "Reports", readOnly: true },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]["key"];

export type AdminPermissions = Partial<
  Record<AdminSection, Partial<Record<AdminAction, boolean>>>
>;

export interface AdminDTO {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: AdminRole;
  permissions: AdminPermissions;
  createdAt: string; // ISO
}
export interface CreateAdminInput {
  email: string;
  password: string;
  superAdmin?: boolean; // promote to SUPER_ADMIN (full access) instead of permission-scoped
  permissions?: AdminPermissions;
}
export interface UpdateAdminInput {
  superAdmin?: boolean;
  permissions?: AdminPermissions;
}
// Self-service: an admin updates their OWN UI preferences (not another admin's).
export interface UpdateAdminPrefsInput {
  menuOrder?: string[];
}
// Self-service: an admin updates their OWN profile (display name; clear photo).
// Send name: "" to clear the display name.
export interface UpdateAdminProfileInput {
  name?: string;
  removeAvatar?: boolean;
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
  // Installment plan: bill this many times, then the member keeps the level for
  // life. null = an ongoing subscription that bills until canceled.
  installments: number | null;
}
// Admin-only grouping for classes (membership levels). Mirrors the blog's
// PostCategory, but never shown to members.
export interface LevelCategoryDTO {
  id: string;
  name: string;
  order: number;
}
// One "Skills You'll Learn" card on a class landing page.
export interface SkillDTO {
  title: string;
  imageUrl: string | null;
}
export interface LevelDTO {
  id: string;
  name: string;
  slug: string | null; // pretty checkout URL key (/checkout/<slug>); null = use raw id
  published: boolean; // show as a class tile on the member dashboard
  type: LevelType;
  mailchimpTags: string[]; // tags applied within the audience on grant
  mailchimpAudienceId: string | null; // Mailchimp list this level subscribes members to
  mailchimpAudienceName: string | null; // cached name for display
  stripeProductId: string | null;
  prices: PriceDTO[];
  categories: LevelCategoryDTO[]; // admin-only grouping ("Classes" categories)
  // ----- MasterClass-style landing-page fields -----
  imageUrl: string | null; // hero/cover image
  description: string | null;
  trailerUrl: string | null; // Vimeo/MP4 or Gallery video URL
  featuredCourseId: string | null; // course whose lessons are the curriculum
  skills: SkillDTO[];
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

// Public class landing page (GET /levels/page/:slugOrId) — MasterClass-style.
// Curriculum = the featured course's lessons (titles/durations/thumbnails only;
// no playback for logged-out visitors).
export interface ClassPublicLessonDTO {
  title: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  order: number;
}
export interface ClassPublicDTO {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  description: string | null;
  trailerUrl: string | null;
  categories: LevelCategoryDTO[];
  skills: SkillDTO[];
  lessons: ClassPublicLessonDTO[];
  lessonCount: number;
  totalDurationSeconds: number;
  prices: PriceDTO[];
}
// Minimal public class list (sitemap + cross-linking).
export interface PublicClassListItem {
  id: string;
  name: string;
  slug: string | null;
}

export interface SkillInput {
  title: string;
  imageUrl?: string;
}
export interface CreateLevelInput {
  name: string;
  slug?: string; // optional pretty checkout URL slug (slugified server-side)
  published?: boolean; // show as a class tile on the member dashboard
  type: LevelType;
  mailchimpTags?: string[];
  mailchimpAudienceId?: string;
  mailchimpAudienceName?: string;
  categoryIds?: string[]; // admin-only class categories to assign
  imageUrl?: string; // hero/cover image (Gallery URL)
  description?: string;
  trailerUrl?: string; // Vimeo/MP4 or Gallery video URL
  featuredCourseId?: string; // course supplying the curriculum
  skills?: SkillInput[];
  prices?: {
    interval: "month" | "year";
    amount: number;
    currency?: string;
    installments?: number; // bill N times then lifetime; omit for an ongoing sub
  }[];
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
  paused: boolean; // true while billing is paused (access suspended, resumable)
  installmentsTotal: number | null; // installment plan size (null = ongoing subscription)
  installmentsPaid: number | null; // installments paid so far (null = ongoing)
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
  // Permanent (lifetime) grants — completed installment plans the member keeps
  // forever. These have no live subscription, so they don't appear above.
  lifetimeLevels: { levelId: string; levelName: string }[];
}

// Admin cancel mode for a member's subscription: end access now, or let the paid
// period run out (no renewal) then auto-cancel. Cancellation is final (no resume).
export type SubscriptionCancelMode = "immediate" | "period_end";

// One row of the admin Subscriptions tab — every Stripe subscription (active +
// historical) joined to the local member + level, with an order count and last
// order date derived from invoices. Read live from Stripe.
export interface SubscriptionRowDTO {
  id: string; // stripe subscription id (row key)
  memberId: string | null; // local user id (links to the member billing page); null if no local user
  memberName: string; // "First Last" (falls back to email / Stripe name)
  memberEmail: string | null;
  levelId: string | null;
  levelName: string; // joined level name(s) for the subscription's items
  status: string; // raw stripe status: active | trialing | past_due | canceled | unpaid | incomplete…
  paused: boolean; // billing paused (surfaced as "On hold")
  cancelAtPeriodEnd: boolean;
  amount: number | null; // minor units (the actual subscribed price; null if unmapped)
  currency: string;
  interval: string | null; // "month" | "year"
  startDate: string | null; // ISO
  nextPayment: string | null; // ISO — next renewal charge (null when cancelling/paused/ended)
  lastOrderDate: string | null; // ISO — most recent invoice for this subscription
  endDate: string | null; // ISO — when it ended / is scheduled to end
  orders: number; // count of (non-draft) invoices for this subscription
  installmentsTotal: number | null; // installment plan size (null = ongoing); paid count = `orders`
}

export interface MemberRow {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  registeredAt: string; // ISO
  levels: {
    id: string;
    name: string;
    source: UserLevelSource; // MANUAL grants are removable here; STRIPE is managed via billing
    status: UserLevelStatus;
    lifetime: boolean; // permanent grant (completed installment plan)
  }[];
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
  durationSeconds?: number | null; // lesson length (admin-entered); drives curriculum totals
  order: number;
  completed?: boolean;
  notes?: LessonNoteDTO[]; // downloadable attachments (present on detail views)
}
export interface DashboardResponse {
  categories: { category: CategoryDTO; courses: CourseCard[] }[];
}

// One class tile on the member dashboard (GET /levels/my-classes). Members see
// every PUBLISHED class; `owned` marks the ones their active membership unlocks.
// Tiles link to /classes/<slug ?? id>.
export interface ClassTileDTO {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  owned: boolean;
  categories: LevelCategoryDTO[];
}

// GET /levels/:slugOrId/my-courses (member, auth). A class's courses — returned
// ONLY when the member owns the class (active membership); otherwise owned:false
// and an empty list, so the public class page shows just its marketing + CTA.
export interface MyClassCoursesDTO {
  owned: boolean;
  courses: CourseCard[];
}

// ---------- Course / lesson admin inputs ----------
export interface CreateCourseInput {
  title: string;
  description?: string;
  thumbnailUrl?: string;
  coverImageUrl?: string;
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
  durationSeconds?: number; // seconds (parsed from the admin's mm:ss input)
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
  updatedAt: string; // ISO — surfaced for Article schema `dateModified`
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
// ---------- Media Library (Gallery) ----------
export type MediaKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "archive"
  | "other";

// A managed media asset. `url` is the absolute, public, embeddable URL.
export interface MediaDTO {
  id: string;
  url: string; // absolute public URL — copy/embed anywhere
  key: string; // storage object key (stored filename)
  originalName: string; // filename as uploaded
  mimeType: string;
  kind: MediaKind;
  size: number; // bytes
  width: number | null; // images only
  height: number | null;
  title: string | null;
  altText: string | null;
  caption: string | null;
  description: string | null;
  uploadedBy: { email: string } | null;
  createdAt: string; // ISO
}
export interface MediaListDTO {
  items: MediaDTO[];
  total: number;
  page: number;
  pageSize: number;
}
// Editable metadata (attachment details panel).
export interface UpdateMediaInput {
  title?: string;
  altText?: string;
  caption?: string;
  description?: string;
}

// ---------- Admin in-app notifications ----------
// Server-emitted feed of billing/subscription events shown to admins via the
// bell in the admin app. Read state is per-admin: `read` reflects the requesting
// admin, and `unreadCount` is that admin's own unread total across the feed.
export type AdminNotificationType =
  | "SUBSCRIPTION_CREATED"
  | "SUBSCRIPTION_CANCELED"
  | "SUBSCRIPTION_CANCEL_SCHEDULED"
  | "SUBSCRIPTION_PAUSED"
  | "SUBSCRIPTION_RESUMED"
  | "PAYMENT_FAILED"
  | "PAYMENT_SUCCEEDED"
  | "INSTALLMENT_PLAN_COMPLETED";

export type AdminNotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AdminNotificationDTO {
  id: string;
  type: AdminNotificationType;
  severity: AdminNotificationSeverity;
  title: string; // short headline
  body: string; // one-line detail (member email + plan + amount)
  userId: string | null; // local User.id — deep-link to /members/<userId> when present
  createdAt: string; // ISO
  read: boolean; // per-requesting-admin read state
}

export interface AdminNotificationListDTO {
  items: AdminNotificationDTO[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number; // requesting admin's unread total across the whole feed (not just this page)
}

// ---------- Admin global search (topbar) ----------
export type AdminSearchType =
  | "member"
  | "class"
  | "course"
  | "blog"
  | "page"
  | "popup"
  | "form"
  | "media"
  | "coupon";
export interface AdminSearchItem {
  type: AdminSearchType;
  id: string;
  title: string;
  subtitle?: string;
  href: string; // admin route to navigate to on select
}
export interface AdminSearchGroup {
  type: AdminSearchType;
  label: string; // e.g. "Members"
  items: AdminSearchItem[];
}
export interface AdminSearchResponse {
  query: string;
  groups: AdminSearchGroup[]; // only sections the requesting admin may read
}

// ---------- Navigation menus (WordPress-style) ----------
export const MENU_LOCATIONS = ["HEADER", "FOOTER", "MOBILE"] as const;
export type MenuLocation = (typeof MENU_LOCATIONS)[number];

export const MENU_ITEM_TYPES = [
  "PAGE",
  "CLASS",
  "CLASS_INDEX",
  "COURSE",
  "COURSE_INDEX",
  "BLOG_INDEX",
  "BLOG_POST",
  "ROUTE",
  "CUSTOM",
] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

export const MENU_ITEM_VISIBILITIES = [
  "ALL",
  "GUEST",
  "AUTHED",
  "LEVEL",
] as const;
export type MenuItemVisibility = (typeof MENU_ITEM_VISIBILITIES)[number];

// Admin-facing item (full target ids + options, nested tree) — for editing.
export interface MenuItemDTO {
  id: string;
  parentId: string | null;
  order: number;
  label: string;
  type: MenuItemType;
  url: string | null;
  pageId: string | null;
  levelId: string | null;
  courseId: string | null;
  postId: string | null;
  openNewTab: boolean;
  visibility: MenuItemVisibility;
  visibilityLevelId: string | null;
  children: MenuItemDTO[];
}
export interface MenuDTO {
  id: string;
  name: string;
  location: MenuLocation | null;
  items: MenuItemDTO[]; // top-level items, each with nested children
  createdAt: string; // ISO
}
export interface MenuListItem {
  id: string;
  name: string;
  location: MenuLocation | null;
  itemCount: number;
}

// Public resolved item for rendering: href computed, gated items already removed.
export interface ResolvedMenuItem {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  children: ResolvedMenuItem[];
}
export interface ResolvedMenu {
  id: string;
  name: string;
  location: MenuLocation | null;
  items: ResolvedMenuItem[];
}

export interface CreateMenuInput {
  name: string;
  location?: MenuLocation | null;
}
export interface UpdateMenuInput {
  name?: string;
  location?: MenuLocation | null;
}
export interface MenuItemInput {
  label: string;
  type: MenuItemType;
  url?: string | null;
  pageId?: string | null;
  levelId?: string | null;
  courseId?: string | null;
  postId?: string | null;
  openNewTab?: boolean;
  visibility?: MenuItemVisibility;
  visibilityLevelId?: string | null;
  parentId?: string | null;
}
export type CreateMenuItemInput = MenuItemInput;
export type UpdateMenuItemInput = Partial<MenuItemInput>;

// Persist a drag/nest reorder: the full flattened tree as {id, parentId, order}.
export interface MenuReorderNode {
  id: string;
  parentId?: string | null;
  order: number;
}
export interface ReorderMenuItemsInput {
  items: MenuReorderNode[];
}

// ---------- Site Header builder ----------
// Admin-authored config for the public web header. CTA targets reuse MenuItemType
// + the menu href-resolution, so a CTA to a Page resolves like a menu item would.
export const HEADER_LAYOUTS = ["TWO_COL", "THREE_COL"] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];
export const HEADER_WIDTHS = ["BOXED", "FULL"] as const; // content width; bg is full-bleed
export type HeaderWidth = (typeof HEADER_WIDTHS)[number];

export interface HeaderCtaLink {
  type: MenuItemType;
  url?: string | null;
  pageId?: string | null;
  levelId?: string | null;
  courseId?: string | null;
  postId?: string | null;
  openNewTab?: boolean;
}
export interface HeaderCta {
  id: string; // stable client-generated id (list keys/reorder)
  label: string;
  bgColor: string; // #rrggbb
  textColor: string; // #rrggbb
  paddingX: number; // px
  paddingY: number; // px
  borderRadius: number; // px
  link: HeaderCtaLink;
}
export interface HeaderConfig {
  layout: HeaderLayout;
  width: HeaderWidth;
  maxWidth?: number | null; // content max-width px (BOXED); null -> theme default
  bgColor: string; // #rrggbb (full-bleed)
  paddingX: number; // px
  paddingY: number; // px
  logoUrl?: string | null; // image; null -> text brand (site name)
  menuId?: string | null; // chosen Navigation menu (col 2); null -> HEADER location fallback
  linkColor: string; // menu link (inactive) color (#rrggbb)
  menuActiveColor?: string | null; // active link color (#rrggbb)
  ctas: HeaderCta[]; // col 3 (THREE_COL only)
}
// Public, render-ready (CTA hrefs resolved server-side; CTAs are not visibility-gated).
export interface ResolvedHeaderCta {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  bgColor: string;
  textColor: string;
  paddingX: number;
  paddingY: number;
  borderRadius: number;
}
export interface ResolvedHeader {
  layout: HeaderLayout;
  width: HeaderWidth;
  maxWidth: number | null;
  bgColor: string;
  paddingX: number;
  paddingY: number;
  logoUrl: string | null;
  menuId: string | null; // Nav client-resolves items via resolveMenuById
  linkColor: string;
  menuActiveColor: string | null;
  ctas: ResolvedHeaderCta[];
}
// ----- placement rules: which header shows, where, and for whom -----
export const HEADER_AUDIENCES = ["ALL", "AUTHED", "GUEST", "LEVEL"] as const;
export type HeaderAudience = (typeof HEADER_AUDIENCES)[number];
export const HEADER_SECTIONS = [
  "HOME",
  "DASHBOARD",
  "BLOG",
  "PRICING",
  "CLASSES",
  "COURSES",
] as const;
export type HeaderSection = (typeof HEADER_SECTIONS)[number];
export const HEADER_PAGE_MODES = ["ALL", "INCLUDE"] as const;
export type HeaderPageMode = (typeof HEADER_PAGE_MODES)[number];

export interface HeaderConditions {
  audience: HeaderAudience; // ALL | AUTHED | GUEST | LEVEL
  audienceLevelId?: string | null; // when audience === "LEVEL"
  pageMode: HeaderPageMode; // ALL pages, or only the included targets
  includePageIds: string[]; // CMS pages to include (INCLUDE)
  includeSections: HeaderSection[]; // built-in sections to include (INCLUDE)
  excludePageIds: string[]; // always hide on these CMS pages
  excludeSections: HeaderSection[]; // always hide on these sections
}

// One configured header: style/content (config) + placement (conditions).
export interface HeaderDTO {
  id: string;
  name: string;
  enabled: boolean;
  priority: number; // higher wins when multiple match
  config: HeaderConfig;
  conditions: HeaderConditions;
  updatedAt: string; // ISO
}
export interface HeaderSummary {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  audience: HeaderAudience;
  pageMode: HeaderPageMode;
}
export interface CreateHeaderInput {
  name: string;
}
export interface UpdateHeaderInput {
  name?: string;
  enabled?: boolean;
  config?: HeaderConfig;
  conditions?: HeaderConditions;
}
export interface ReorderHeadersInput {
  ids: string[]; // new order, highest priority first
}

// ---------- Site Footer (single global, 3 columns + bottom bar) ----------
export interface FooterBottomLink {
  id: string;
  label: string;
  url: string;
}
export interface FooterEmail {
  heading: string;
  text?: string | null;
  placeholder: string;
  buttonText: string;
  audienceId?: string | null; // Mailchimp audience
  audienceName?: string | null;
  doubleOptIn: boolean;
  successMessage: string;
}
export interface FooterConfig {
  enabled: boolean;
  bgColor: string; // #rrggbb
  textColor: string;
  headingColor: string;
  linkColor: string;
  paddingY: number; // px
  // col 1: logo
  logoUrl?: string | null;
  tagline?: string | null;
  // col 2: menu
  menuHeading: string;
  menuId?: string | null; // null -> FOOTER-location menu
  // col 3: email opt-in (built-in -> Mailchimp)
  email: FooterEmail;
  // bottom bar
  copyright: string; // supports the {year} token
  bottomLinks: FooterBottomLink[];
}
export interface UpdateFooterInput {
  footer: FooterConfig;
}
export interface FooterSubscribeInput {
  email: string;
}
export interface FooterSubscribeResult {
  ok: boolean;
  status: string; // subscribed | pending | existing | skipped | error
  message: string;
}

export const ROUTES = {
  // auth
  memberLogin: "POST /auth/login", // body {email,password} -> LoginResponse<AuthUser>
  memberSignup: "POST /auth/signup", // body SignupInput -> LoginResponse<AuthUser>
  adminLogin: "POST /auth/admin/login", // -> LoginResponse<AuthAdmin>
  me: "GET /auth/me",
  updateMe: "PATCH /auth/me", // body UpdateProfileInput -> AuthUser (member self-service)
  changePassword: "POST /auth/change-password", // body ChangePasswordInput -> { ok: true }
  adminChangeOwnPassword: "POST /auth/admin/change-password", // admin self; body ChangePasswordInput -> { ok: true }
  adminUpdateMyPrefs: "PATCH /auth/admin/prefs", // admin self; body UpdateAdminPrefsInput -> AuthAdmin
  adminUpdateProfile: "PATCH /auth/admin/profile", // admin self; body UpdateAdminProfileInput -> AuthAdmin
  adminUploadAvatar: "POST /auth/admin/avatar", // admin self; multipart file -> AuthAdmin

  // admin: levels
  listLevels: "GET /levels",
  createLevel: "POST /levels",
  updateLevel: "PATCH /levels/:id",
  deleteLevel: "DELETE /levels/:id",
  checkoutLevel: "GET /levels/checkout/:slugOrId", // public — resolve a level for checkout by slug or id
  classPage: "GET /levels/page/:slugOrId", // public — full class landing-page data
  listPublicClasses: "GET /levels/public", // public — minimal class list (sitemap/links)
  myClasses: "GET /levels/my-classes", // member — published class tiles for the dashboard (owned flag)
  myClassCourses: "GET /levels/:slugOrId/my-courses", // member — a class's courses, only if owned
  // admin: class (level) categories
  listLevelCategories: "GET /levels/categories",
  createLevelCategory: "POST /levels/categories", // body {name, order?}
  deleteLevelCategory: "DELETE /levels/categories/:id",

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

  // admin: subscriptions (read-only list, live from Stripe)
  adminListSubscriptions: "GET /admin/subscriptions", // -> SubscriptionRowDTO[]

  // admin: reports (binary .xlsx downloads; RequirePermission('reports','read'))
  adminReportMembers: "GET /admin/reports/members.xlsx", // -> xlsx (members directory)
  adminReportSubscriptions: "GET /admin/reports/subscriptions.xlsx", // -> xlsx (Stripe subs + revenue)
  adminReportEngagement: "GET /admin/reports/engagement.xlsx", // -> xlsx (course progress per member)
  adminReportAll: "GET /admin/reports/all.xlsx", // -> xlsx (3-sheet workbook)

  // admin: admin accounts + RBAC (SUPER_ADMIN only)
  adminListAdmins: "GET /admin/admins", // -> AdminDTO[]
  adminCreateAdmin: "POST /admin/admins", // body CreateAdminInput -> AdminDTO
  adminUpdateAdmin: "PATCH /admin/admins/:id", // body UpdateAdminInput -> AdminDTO
  adminResetAdminPassword: "POST /admin/admins/:id/password", // body { password } -> { ok: true }
  adminDeleteAdmin: "DELETE /admin/admins/:id", // -> { ok: true }

  // admin: global search (topbar) — permission-scoped to the admin's sections
  adminSearch: "GET /admin/search", // ?q= -> AdminSearchResponse

  // admin: navigation menus
  adminListMenus: "GET /admin/menus", // -> MenuListItem[]
  adminCreateMenu: "POST /admin/menus", // body CreateMenuInput -> MenuDTO
  adminGetMenu: "GET /admin/menus/:id", // -> MenuDTO (nested items)
  adminUpdateMenu: "PATCH /admin/menus/:id", // body UpdateMenuInput -> MenuDTO
  adminDeleteMenu: "DELETE /admin/menus/:id", // -> { ok: true }
  adminAddMenuItem: "POST /admin/menus/:id/items", // body CreateMenuItemInput -> MenuDTO
  adminUpdateMenuItem: "PATCH /admin/menus/items/:itemId", // body UpdateMenuItemInput -> MenuDTO
  adminDeleteMenuItem: "DELETE /admin/menus/items/:itemId", // -> MenuDTO
  adminReorderMenuItems: "PUT /admin/menus/:id/order", // body ReorderMenuItemsInput -> MenuDTO
  // public: resolved menus for the web (visibility-filtered server-side)
  menuByLocation: "GET /menus/location/:location", // -> ResolvedMenu | null
  menuById: "GET /menus/:id/resolved", // embed-in-page -> ResolvedMenu | null

  // site headers (multiple, conditional) — admin CRUD (RBAC `menus`) + public match
  adminListHeaders: "GET /admin/site/headers", // -> HeaderSummary[]
  adminCreateHeader: "POST /admin/site/headers", // body CreateHeaderInput -> HeaderDTO
  adminGetHeader: "GET /admin/site/headers/:id", // -> HeaderDTO
  adminUpdateHeader: "PUT /admin/site/headers/:id", // body UpdateHeaderInput -> HeaderDTO
  adminDeleteHeader: "DELETE /admin/site/headers/:id", // -> { ok: true }
  adminReorderHeaders: "PUT /admin/site/headers/order", // body ReorderHeadersInput -> HeaderSummary[]
  siteHeader: "GET /site/header", // public ?path= -> matched ResolvedHeader | null (auth-aware)
  // site footer (single global) — admin (RBAC `menus`) + public config + subscribe
  adminGetFooter: "GET /admin/site/footer", // -> FooterConfig (default-merged)
  adminUpdateFooter: "PUT /admin/site/footer", // body UpdateFooterInput -> FooterConfig
  siteFooter: "GET /site/footer", // public -> FooterConfig
  siteFooterSubscribe: "POST /site/footer/subscribe", // public, body FooterSubscribeInput -> FooterSubscribeResult

  // admin: in-app notifications (per-admin read state)
  adminListNotifications: "GET /admin/notifications", // ?page&pageSize -> AdminNotificationListDTO
  adminNotificationsUnreadCount: "GET /admin/notifications/unread-count", // -> { count: number }
  adminMarkNotificationRead: "POST /admin/notifications/:id/read", // -> { ok: true }
  adminMarkAllNotificationsRead: "POST /admin/notifications/read-all", // -> { ok: true }

  // admin: media library (gallery) — files served at public, embeddable URLs
  adminListMedia: "GET /admin/media", // ?q&kind&page&pageSize -> MediaListDTO
  adminUploadMedia: "POST /admin/media", // multipart {file} -> MediaDTO
  adminGetMedia: "GET /admin/media/:id", // -> MediaDTO
  adminUpdateMedia: "PATCH /admin/media/:id", // body UpdateMediaInput -> MediaDTO
  adminDeleteMedia: "DELETE /admin/media/:id", // -> { ok: true }

  // lms
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
  syncMySubscriptions: "POST /billing/sync", // member: reconcile own subs inline post-payment -> { ok: true }
  validateCoupon: "POST /billing/coupon/validate", // body CouponValidateInput -> CouponPreviewDTO
  mySubscriptionDetails: "GET /billing/subscription-details", // -> SubscriptionDetailDTO[]
  myInvoices: "GET /billing/invoices", // -> InvoiceDTO[] (member's own payment history)
  cancelMyMembership: "POST /billing/subscriptions/:subId/cancel", // member: cancel own sub at period end -> SubscriptionDetailDTO[]
  adminMemberBilling: "GET /billing/members/:id", // admin -> MemberBillingDTO
  adminPauseMemberSub: "POST /billing/members/:id/subscriptions/:subId/pause", // admin -> MemberBillingDTO
  adminResumeMemberSub: "POST /billing/members/:id/subscriptions/:subId/resume", // admin -> MemberBillingDTO
  adminCancelMemberSub: "POST /billing/members/:id/subscriptions/:subId/cancel", // admin; body {mode} -> MemberBillingDTO

  // admin settings (secrets are write-only; GET returns masked/last4 only)
  getStripeSettings: "GET /admin/settings/stripe",
  putStripeSettings: "PUT /admin/settings/stripe", // body {secretKey?, webhookSecret?, publishableKey?}
  deleteStripeSettings: "DELETE /admin/settings/stripe", // clears all Stripe creds
  getMailchimpSettings: "GET /admin/settings/mailchimp",
  putMailchimpSettings: "PUT /admin/settings/mailchimp",
  deleteMailchimpSettings: "DELETE /admin/settings/mailchimp", // clears all Mailchimp creds
} as const;
