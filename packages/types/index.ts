// Shared types + API contract across api / admin / web / mobile.
// This is the single source of truth all four apps build against.

// ---------- Enums (mirror Prisma) ----------
export type LevelType = "PAID" | "FREE" | "MANUAL";
export type UserLevelSource = "STRIPE" | "MANUAL" | "PAYPAL";
// Payment processor a subscription lives on. The admin-selected ACTIVE provider
// (PUT /admin/settings/payment-provider) governs NEW checkouts only — existing
// subscriptions keep billing on the provider that created them.
export type PaymentProviderId = "stripe" | "paypal";
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
  avatarUrl: string | null; // profile photo URL (served from /media); null if unset
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
  { key: "contacts", label: "Contacts" },
  { key: "email", label: "Email" },
  { key: "menus", label: "Navigation" },
  { key: "settings", label: "Settings" },
  { key: "appCustomization", label: "App Customization" },
  // Read-only: the Reports tab only generates/downloads exports (no create/edit/delete).
  { key: "reports", label: "Reports", readOnly: true },
  { key: "certificates", label: "Certificates" },
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
  removeAvatar?: boolean; // clear the profile photo (mutually exclusive with an upload)
}

// Member changes their own password (current password required to authorize).
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface PriceDTO {
  id: string; // local Price id — the provider-neutral checkout identifier
  stripePriceId: string | null; // price_… (null until provisioned under Stripe)
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
  audienceTags: string[]; // tag names applied within the in-house audience on grant
  audienceId: string | null; // in-house Audience this class captures granted members into (null = default "Members" audience)
  audienceName: string | null; // display name resolved from the linked Audience (null when unlinked → default at grant time)
  stripeProductId: string | null;
  prices: PriceDTO[];
  categories: LevelCategoryDTO[]; // admin-only grouping ("Classes" categories)
  // ----- MasterClass-style landing-page fields -----
  imageUrl: string | null; // hero/cover image
  description: string | null;
  trailerUrl: string | null; // Vimeo/MP4 or Gallery video URL
  featuredCourseId: string | null; // course whose lessons are the curriculum
  skills: SkillDTO[];
  // Certificate template override for this class; null = use the default
  // template (Certificates section). Resolution happens server-side.
  certificateTemplateId: string | null;
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
  audienceTags?: string[]; // tag names applied within the in-house audience on grant
  audienceId?: string; // in-house Audience id to capture granted members into (omit = default "Members" audience)
  categoryIds?: string[]; // admin-only class categories to assign
  imageUrl?: string; // hero/cover image (Gallery URL)
  description?: string;
  trailerUrl?: string; // Vimeo/MP4 or Gallery video URL
  featuredCourseId?: string; // course supplying the curriculum
  skills?: SkillInput[];
  certificateTemplateId?: string | null; // per-class template override; null clears (use default)
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

// ---------- Checkout (member) ----------
// Public config the checkout page needs to render the active provider's payment
// UI. `provider` is the admin-selected processor for NEW checkouts. When the
// active provider's key is null, it isn't configured on this environment and
// Outbound email sender credentials (in-house Mailchimp replacement).
// `pass` and `resendApiKey` are write-only (sent on PUT, never returned); blank
// fields on PUT keep the stored value. `provider` is the pluggable sender id:
// "smtp" (nodemailer) or "resend" (REST API). `secure` toggles implicit TLS
// (typically port 465). SMTP fields apply when provider="smtp"; `resendApiKey`
// applies when provider="resend".
export interface EmailSettingsInput {
  provider?: "smtp" | "resend";
  host?: string;
  port?: string; // string on the wire; parsed to a number server-side
  user?: string;
  pass?: string;
  resendApiKey?: string;
  fromEmail?: string;
  fromName?: string;
  secure?: boolean;
}
export interface EmailSettingsMasked {
  provider: "smtp" | "resend"; // defaults to "smtp"
  host: string | null;
  port: string | null;
  user: string | null;
  // The SMTP password is a secret — never returned; only whether one is stored.
  passSet: boolean;
  // The Resend API key is a secret — never returned; only whether one is stored.
  resendApiKeySet: boolean;
  fromEmail: string | null;
  fromName: string | null;
  secure: boolean;
}
// the web app falls back to a mock payment path (UI stays fully testable).
export interface BillingConfigDTO {
  provider: PaymentProviderId;
  publishableKey: string | null; // Stripe Elements key (pk_…)
  paypalClientId: string | null; // PayPal JS SDK client id (public)
  paypalMode: "sandbox" | "live" | null;
}
// Start an embedded (Elements) subscription. `couponCode` is an optional Stripe
// promotion code applied to the subscription.
export interface SubscribeInput {
  priceId: string; // Stripe price id (price_…) or the local Price id
  couponCode?: string;
}
// ---------- PayPal checkout (member) ----------
// Flow: prepare (server lazily provisions the PayPal product+plan for a local
// price) → PayPal Buttons approve → activate (server verifies the subscription
// belongs to the member + plan, grants access inline — also the manual
// reconcile fallback when webhooks can't reach the environment).
export interface PayPalPrepareInput {
  priceId: string; // local Price id (preferred) or a stripePriceId
}
export interface PayPalPrepareResult {
  planId: string; // PayPal billing plan id (P-…) for Buttons createSubscription
  customId: string; // stamped on the subscription (the member's user id)
}
export interface PayPalActivateInput {
  subscriptionId: string; // I-… returned by PayPal Buttons onApprove
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
  stripeSubId: string; // the provider's subscription id: sub_… (Stripe) | I-… (PayPal)
  provider: PaymentProviderId;
  levelId: string;
  levelName: string;
  status: string; // provider sub status, normalized: active | past_due | paused | trialing | …
  interval: string; // "month" | "year" (the subscribed price's interval)
  amount: number; // minor units (the actual subscribed price)
  currency: string;
  currentPeriodEnd: string | null; // ISO — when the paid period ends / renews
  cancelAtPeriodEnd: boolean; // true once "Cancel" was used (reversible)
  paused: boolean; // true while billing is paused (access suspended, resumable)
  installmentsTotal: number | null; // installment plan size (null = ongoing subscription)
  installmentsPaid: number | null; // installments paid so far (null = ongoing)
}
// One row of payment history (a Stripe invoice or a PayPal transaction —
// PayPal rows have no hosted receipt/PDF, those stay null).
export interface InvoiceDTO {
  id: string;
  number: string | null;
  created: string; // ISO
  amountPaid: number; // minor units
  amountDue: number; // minor units
  currency: string;
  status: string; // paid | open | void | uncollectible | draft
  description: string | null; // first line item / plan
  hostedInvoiceUrl: string | null; // Stripe-hosted receipt (null for PayPal)
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

// One row of the admin Subscriptions tab — every subscription (active +
// historical, both providers) joined to the local member + level, with an order
// count and last order date. Stripe rows read live; PayPal rows come from the
// local mirror enriched with live lookups.
export interface SubscriptionRowDTO {
  id: string; // provider subscription id (row key): sub_… | I-…
  provider: PaymentProviderId;
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
  videoUrl?: string | null; // Vimeo link or direct video URL (e.g. MP4)
  durationSeconds?: number | null; // lesson length (admin-entered); drives curriculum totals
  order: number;
  completed?: boolean;
  notes?: LessonNoteDTO[]; // downloadable attachments (present on detail views)
  // Present on member detail views ONLY when this lesson is the terminal lesson
  // (last by order) of a class whose certificate feature is active — one entry
  // per such class (a course can sit in several classes). Drives the
  // "Get certificate" button on the lesson screen.
  certificates?: ClassCertificateStatusDTO[];
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
  // Certificate state for this class (owned requests only; omitted when no
  // template resolves — feature dormant). Drives the class-page button.
  certificate?: ClassCertificateStatusDTO | null;
}

// ---------- Certificates ----------
// A member who completes EVERY lesson of EVERY course in a class can claim a
// PDF certificate. Admins upload artwork images and position the dynamic text
// fields visually; the layout below is the single contract shared by the
// template rows (Json column), the admin drag-editor preview, and the server
// PDF renderer — both sides compute from the same normalized percentages.

// Bundled fonts: TTFs live in apps/api/src/certificates/fonts/ and are served
// at GET /cert-fonts/<file> so the admin preview @font-faces the EXACT bytes
// the PDF embeds (WYSIWYG parity).
export const CERTIFICATE_FONTS = [
  { id: "playfair", label: "Playfair Display", file: "PlayfairDisplay-Regular.ttf" },
  { id: "greatvibes", label: "Great Vibes", file: "GreatVibes-Regular.ttf" },
  { id: "inter", label: "Inter", file: "Inter-Regular.ttf" },
  { id: "ebgaramond", label: "EB Garamond", file: "EBGaramond-Regular.ttf" },
] as const;
export type CertificateFontId = (typeof CERTIFICATE_FONTS)[number]["id"];

export type CertificateFieldKind = "memberName" | "className" | "issueDate" | "serial";

// Normalized field layout. xPct/yPct are the text box's LEFT/TOP edges as % of
// the artwork (CSS convention; the PDF renderer converts top → baseline).
// fontSizePct is % of the artwork WIDTH so text scales with any artwork size.
export interface CertificateFieldLayout {
  kind: CertificateFieldKind;
  enabled: boolean; // memberName/className are always true; issueDate/serial are admin-toggleable
  xPct: number; // 0..100
  yPct: number; // 0..100
  widthPct: number; // 5..100 — box width; long values auto-shrink to fit
  align: "left" | "center" | "right";
  fontFamily: CertificateFontId;
  fontSizePct: number; // 0.5..20
  color: string; // #rrggbb
  uppercase: boolean;
  letterSpacing?: number; // optional tracking in em
}

export interface CertificateTemplateDTO {
  id: string;
  name: string;
  artworkUrl: string; // always a local "/media/<key>" path (validated at save)
  imageWidth: number; // artwork pixel size, derived server-side at save
  imageHeight: number;
  fields: CertificateFieldLayout[];
  isDefault: boolean; // exactly one template; classes without an override use it
  issuedCount: number; // admin list convenience
  createdAt: string; // ISO
}
export interface CreateCertificateTemplateInput {
  name: string;
  artworkUrl: string;
  fields: CertificateFieldLayout[];
  isDefault?: boolean;
}
export type UpdateCertificateTemplateInput = Partial<CreateCertificateTemplateInput>;

// Per-class certificate state on member surfaces (lesson + class pages).
export interface ClassCertificateStatusDTO {
  levelId: string;
  levelName: string;
  eligible: boolean; // every lesson of every course complete (and >=1 lesson exists)
  claimed: boolean;
  certificateId: string | null;
  serial: string | null;
  needsName: boolean; // profile first/last blank -> claim UI prompts for a name once
}

export interface ClaimCertificateInput {
  levelId: string;
  name?: string; // required by the server only when the profile name is blank
}
export interface MyCertificateDTO {
  id: string;
  serial: string;
  levelId: string;
  className: string; // snapshot at claim time
  memberName: string; // snapshot at claim time
  issuedAt: string; // ISO
  downloadUrl: string; // "/certificates/:id/download" (Bearer header or ?token=)
}
export interface AdminCertificateRow {
  id: string;
  serial: string;
  memberName: string;
  memberEmail: string;
  className: string;
  templateName: string | null; // null when the template was later deleted
  issuedAt: string;
}
export interface AdminCertificateListDTO {
  items: AdminCertificateRow[];
  total: number;
  page: number;
  pageSize: number;
}
// Public verification (serial printed on the PDF). Unknown serials return
// {valid:false} with HTTP 200 — no existence oracle beyond the cert itself.
export interface CertificateVerifyDTO {
  valid: boolean;
  memberName?: string;
  className?: string;
  issuedAt?: string;
}
// POST /lessons/:id/complete response: completing the FINAL lesson of a class
// returns the fresh certificate state so the button appears without a refetch.
export interface CompleteLessonResponse {
  ok: true;
  certificates?: ClassCertificateStatusDTO[];
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

// ---------- Contacts / Audiences (in-house list — replaces Mailchimp) ----------
// Mirrors Mailchimp's model: a contact belongs to one audience; email is unique
// within an audience; tags + attributes (merge fields) are per-audience.
export type ContactStatus =
  | "SUBSCRIBED"
  | "PENDING" // double opt-in, awaiting confirmation
  | "UNSUBSCRIBED"
  | "CLEANED"; // hard-bounced / complained
export type ContactSource =
  | "SIGNUP"
  | "FORM"
  | "FOOTER"
  | "IMPORT"
  | "MANUAL"
  | "ADMIN";

export interface AudienceDTO {
  id: string;
  name: string;
  slug: string | null;
  isDefault: boolean;
  contactCount: number;
  subscribedCount: number;
  createdAt: string; // ISO
}
export interface AudienceFieldDTO {
  tag: string; // FNAME, LNAME, PHONE … (EMAIL is implicit)
  label: string;
  type: string;
  required: boolean;
}
export interface ContactDTO {
  id: string;
  audienceId: string;
  email: string;
  status: ContactStatus;
  firstName: string | null;
  lastName: string | null;
  attributes: Record<string, unknown>; // mapped field values
  tags: string[];
  source: ContactSource;
  userId: string | null; // member link when known
  createdAt: string; // ISO
}
export interface ContactListDTO {
  items: ContactDTO[];
  total: number;
  page: number;
  pageSize: number;
}
// Saved filter over an audience — the campaign/automation target shape.
export interface ContactFilter {
  status?: ContactStatus;
  anyTags?: string[]; // contact has ANY of these tags
  allTags?: string[]; // contact has ALL of these tags
  search?: string; // email / name substring
}
export interface SegmentDTO {
  id: string;
  audienceId: string;
  name: string;
  filter: ContactFilter;
  contactCount?: number; // resolved size (optional; admin list view)
  createdAt: string; // ISO
}

export interface CreateAudienceInput {
  name: string;
  slug?: string;
  isDefault?: boolean;
}
export interface UpdateAudienceInput {
  name?: string;
  slug?: string | null;
  isDefault?: boolean;
}
export interface UpsertAudienceFieldInput {
  tag: string; // uppercased server-side
  label: string;
  type?: string;
  required?: boolean;
}
export interface CreateContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, unknown>;
  tags?: string[];
  status?: ContactStatus;
  source?: ContactSource;
}
export interface UpdateContactInput {
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  attributes?: Record<string, unknown>;
  tags?: string[];
  status?: ContactStatus;
}
export interface CreateSegmentInput {
  name: string;
  filter: ContactFilter;
}

// Result of the one-time Mailchimp → internal-contacts import. Counts are
// totals across all imported audiences; `errors` holds a per-audience message
// for any list that failed (the rest still import — the run is best-effort).
export interface ImportSummary {
  audiences: number; // audiences upserted
  fields: number; // audience fields upserted (excl. implicit EMAIL)
  contactsCreated: number;
  contactsUpdated: number;
  errors: string[]; // "<audience name>: <reason>" per failed list
}
export interface UpdateSegmentInput {
  name?: string;
  filter?: ContactFilter;
}

// ---------- Email templates (MJML body + Handlebars merge vars) ----------
// A reusable email template. `key` is set for system templates (welcome, …) so
// code can render-by-key and the editor knows not to allow deletion; custom
// admin templates have key null. `variables` are the declared merge-var names
// the editor surfaces (and seeds sample values from for preview).
export interface EmailTemplateDTO {
  id: string;
  key: string | null; // stable id for system templates; null for custom
  name: string;
  subject: string; // Handlebars-enabled
  mjml: string; // MJML source (Handlebars-enabled)
  variables: string[]; // declared merge-var names
  category: string | null;
  isSystem: boolean; // === (key != null); convenience for the UI
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  mjml: string;
  variables?: string[];
  category?: string;
}
export interface UpdateEmailTemplateInput {
  name?: string;
  subject?: string;
  mjml?: string;
  variables?: string[];
  category?: string;
}
// Ad-hoc render for the live editor preview (no saved row needed).
export interface RenderPreviewInput {
  subject: string;
  mjml: string;
  vars?: Record<string, unknown>;
}
export interface RenderPreviewResult {
  subject: string;
  html: string;
}
// Send a test of a saved template to an arbitrary address (no dedupe).
export interface TestSendInput {
  to: string;
  vars?: Record<string, unknown>;
}
// Outcome of a template send/test — mirrors the EmailLog ledger row the
// EmailService returns (status drives the admin toast).
export type EmailSendStatus =
  | "QUEUED"
  | "SENT"
  | "FAILED"
  | "BOUNCED"
  | "COMPLAINED";
export interface EmailSendResultDTO {
  id: string;
  to: string;
  subject: string;
  status: EmailSendStatus;
  error: string | null;
}

// ---------- Email logs (the send ledger / EmailLog rows) ----------
// One row of the outbound-mail audit trail surfaced in the admin logs viewer.
// `status` reuses EmailSendStatus (the EmailStatus enum). `templateKey` is the
// template/automation that produced it (null for ad-hoc/campaign sends);
// `providerId` is the transport message id used to correlate provider webhooks.
export interface EmailLogDTO {
  id: string;
  to: string;
  subject: string;
  status: EmailSendStatus;
  templateKey: string | null;
  campaignId: string | null;
  providerId: string | null;
  error: string | null;
  sentAt: string | null; // ISO
  createdAt: string; // ISO
}
// Paginated EmailLog list (mirrors ContactListDTO / AdminCertificateListDTO).
export interface EmailLogListDTO {
  items: EmailLogDTO[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Campaigns (scheduled broadcasts) ----------
// A campaign sends a stored template to an audience (optionally narrowed by a
// Segment). ONCE is a one-off at `runAt`; WEEKLY/MONTHLY recur from `runAt`;
// CRON recurs on a `cron` expression. The scheduler advances `nextRunAt`.
export type CampaignCadence = "ONCE" | "WEEKLY" | "MONTHLY" | "CRON";
export type CampaignStatus =
  | "DRAFT" // created, not yet scheduled
  | "SCHEDULED" // armed; scheduler will dispatch at nextRunAt
  | "SENDING" // a run is in progress
  | "SENT" // ONCE campaign finished
  | "PAUSED"; // scheduled but held back by an admin
export interface CampaignDTO {
  id: string;
  name: string;
  templateId: string;
  audienceId: string;
  segmentId: string | null; // optional narrower target
  cadence: CampaignCadence;
  runAt: string | null; // ISO — ONCE: send time; recurring: first run
  cron: string | null; // CRON cadence expression
  timezone?: string; // IANA tz for cron/weekly/monthly schedules (null/undefined => UTC)
  status: CampaignStatus;
  nextRunAt: string | null; // ISO — next scheduler dispatch
  lastRunAt: string | null; // ISO — last dispatch
  sentCount: number; // cumulative recipients sent across runs
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
// Create/update body. Status is never set directly — it's driven by the
// schedule/pause actions and the scheduler. All fields optional on update;
// create requires name/templateId/audienceId (validated server-side).
export interface CampaignInput {
  name?: string;
  templateId?: string;
  audienceId?: string;
  segmentId?: string | null;
  cadence?: CampaignCadence;
  runAt?: string | null; // ISO
  cron?: string | null;
  timezone?: string | null; // IANA tz for cron/weekly/monthly schedules; null/omitted => UTC
}

// ---------- Automations (event-triggered emails) ----------
// An automation sends a template whenever its domain event fires. Triggers map
// to wired event sites in the API (SIGNUP, CERTIFICATE_ISSUED, …). `delayMinutes`
// is reserved for future delayed sends (0 = immediate today).
export type AutomationTrigger =
  | "SIGNUP"
  | "SUBSCRIPTION_ACTIVE"
  | "SUBSCRIPTION_CANCELED"
  | "LESSON_COMPLETED"
  | "CERTIFICATE_ISSUED";
export interface AutomationDTO {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  templateId: string;
  active: boolean;
  delayMinutes: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
// Create/update body. Create requires name/trigger/templateId (validated
// server-side); update patches only the provided keys.
export interface AutomationInput {
  name?: string;
  trigger?: AutomationTrigger;
  templateId?: string;
  active?: boolean;
  delayMinutes?: number;
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
  audienceId: string | null; // in-house Audience id (null = default "Members")
  audienceName: string | null; // display name from the Audience relation (null = default)
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
  audienceId?: string; // in-house Audience id (omit/null = default "Members")
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
  subscribeStatus: string | null; // subscribed | pending | existing | skipped
  redirectUrl: string | null;
  message: string | null;
}

// A stored submission (admin entries viewer). `data` holds every submitted
// field value keyed by the field's `name`.
export interface FormSubmissionDTO {
  id: string;
  email: string | null;
  data: Record<string, string | number | boolean>;
  subscribeStatus: string | null; // subscribed | pending | existing | skipped
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

// How a popup targets CMS pages (independent of the member-area toggles).
//   NONE    — not shown on any CMS page
//   ALL     — shown on every CMS page
//   INCLUDE — shown only on the pages listed in pageIds
//   EXCLUDE — shown on every CMS page except those listed in pageIds
export type PopupPageMode = "NONE" | "ALL" | "INCLUDE" | "EXCLUDE";

// When the popup fires once its surface is open (Elementor-style triggers).
//   IMMEDIATE   — as soon as the page/dashboard loads (legacy behaviour)
//   DELAY       — triggerValue seconds after load
//   SCROLL      — after the visitor scrolls triggerValue % of the page (web;
//                 the native app approximates with a short delay)
//   EXIT_INTENT — when the cursor leaves the viewport top (web desktop; other
//                 surfaces approximate with a delay)
export type PopupTrigger = "IMMEDIATE" | "DELAY" | "SCROLL" | "EXIT_INTENT";

// How often the popup may re-appear for the same visitor (client-enforced via
// local storage — popups are marketing surfaces, not security boundaries).
//   EVERY_VISIT      — no capping (legacy behaviour)
//   ONCE_PER_SESSION — once per browser session / app run
//   ONCE_PER_DAYS    — at most once every frequencyDays days
//   ONCE             — once ever per device
export type PopupFrequency =
  | "EVERY_VISIT"
  | "ONCE_PER_SESSION"
  | "ONCE_PER_DAYS"
  | "ONCE";

// Entrance animation of the popup box.
export type PopupAnimation = "NONE" | "FADE" | "SLIDE_UP" | "ZOOM";

// Behaviour settings sent to the renderer alongside style.
export interface PopupBehaviorDTO {
  trigger: PopupTrigger;
  triggerValue: number; // DELAY: seconds; SCROLL: percent (0–100)
  frequency: PopupFrequency;
  frequencyDays: number; // used when frequency = ONCE_PER_DAYS
  closeOnOverlay: boolean; // tap/click on the dim backdrop dismisses
  animation: PopupAnimation;
}

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
  behavior: PopupBehaviorDTO;
}

// Admin list row (table view — omits the heavy document body).
export interface PopupListItem {
  id: string;
  name: string;
  status: PopupStatus;
  position: PopupPosition;
  showOnDashboard: boolean;
  showOnClasses: boolean;
  showOnCourses: boolean;
  showOnLessons: boolean;
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
  showOnClasses: boolean;
  showOnCourses: boolean;
  showOnLessons: boolean;
  pageMode: PopupPageMode;
  pageIds: string[];
  trigger: PopupTrigger;
  triggerValue: number;
  frequency: PopupFrequency;
  frequencyDays: number;
  closeOnOverlay: boolean;
  animation: PopupAnimation;
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
  showOnClasses?: boolean;
  showOnCourses?: boolean;
  showOnLessons?: boolean;
  pageMode?: PopupPageMode;
  pageIds?: string[];
  trigger?: PopupTrigger;
  triggerValue?: number;
  frequency?: PopupFrequency;
  frequencyDays?: number;
  closeOnOverlay?: boolean;
  animation?: PopupAnimation;
}
export type UpdatePopupInput = Partial<CreatePopupInput>;

// Member-area surfaces a popup can target with a simple on/off flag (CMS pages
// have their own include/exclude targeting via PopupPageMode).
export type PopupSurface = "dashboard" | "classes" | "courses" | "lessons";

// Context the public renderer asks about. Member-area surfaces carry no id; a
// CMS page passes its page id so INCLUDE/EXCLUDE targeting can be evaluated.
export type PopupContext =
  | { type: PopupSurface }
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
  | "INSTALLMENT_PLAN_COMPLETED"
  | "CERTIFICATE_ISSUED";

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
  audienceId?: string | null; // in-house Audience id (null = default "Members")
  audienceName?: string | null; // display name from the Audience (null = default)
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
  // col 3: email opt-in (built-in -> in-house audience)
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

// ---------- Mobile App Customization (single global; drives the Expo app) ----------
// Branding the native mobile app reads at launch (and live in-session via its
// ThemeProvider). Stored as a singleton (like the Footer) and served public so
// the app can theme its logged-out screens too. iconUrl/splashUrl are reference
// only — the actual app icon & launch splash are baked into the binary and ship
// via app.json, so changing them needs a new build + store submission.
export interface AppThemePalette {
  bg: string; // #rrggbb — screen background
  surface: string; // cards / headers
  surfaceMuted: string; // pressed/disabled surface
  border: string; // hairlines / dividers
  text: string; // primary text
  textMuted: string; // secondary text
  primary: string; // brand / buttons / active
  danger: string; // errors / destructive
}
export type AppColorScheme = "light" | "dark" | "system";
export interface AppConfig {
  title: string; // app/brand name shown in-app
  tagline?: string | null; // short line under the logo (login)
  description?: string | null; // longer blurb (login/account)
  logoUrl?: string | null; // in-app logo image; null -> title text
  iconUrl?: string | null; // reference only (see note) — not applied at runtime
  splashUrl?: string | null; // reference only (see note) — not applied at runtime
  colorScheme: AppColorScheme; // which palette the app uses (system follows device)
  light: AppThemePalette;
  dark: AppThemePalette;
}
export interface UpdateAppConfigInput {
  appConfig: AppConfig;
}

export const ROUTES = {
  // auth
  memberLogin: "POST /auth/login", // body {email,password} -> LoginResponse<AuthUser>
  memberSignup: "POST /auth/signup", // body SignupInput -> LoginResponse<AuthUser>
  adminLogin: "POST /auth/admin/login", // -> LoginResponse<AuthAdmin>
  me: "GET /auth/me",
  updateMe: "PATCH /auth/me", // body UpdateProfileInput -> AuthUser (member self-service)
  uploadAvatar: "POST /auth/me/avatar", // member self; multipart file -> AuthUser
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
  getMember: "GET /members/:id", // -> MemberRow (admin detail view)
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
  // mobile app customization (single global) — admin (RBAC `appCustomization`) + public config
  appConfig: "GET /app/config", // public -> AppConfig (default-merged; drives the mobile app)
  adminGetAppConfig: "GET /admin/app/config", // -> AppConfig (default-merged)
  adminUpdateAppConfig: "PUT /admin/app/config", // body UpdateAppConfigInput -> AppConfig

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
  adminUploadBlogImage: "POST /admin/blog/upload", // multipart {file} -> {url}; post images

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

  // forms (in-house Audience) — ADMIN
  adminListForms: "GET /admin/forms", // -> FormAdminRow[]
  adminGetForm: "GET /admin/forms/:id", // -> FormAdminRow
  adminCreateForm: "POST /admin/forms", // body CreateFormInput -> FormAdminRow
  adminUpdateForm: "PATCH /admin/forms/:id", // body UpdateFormInput -> FormAdminRow
  adminDeleteForm: "DELETE /admin/forms/:id",
  adminListFormSubmissions: "GET /admin/forms/:id/submissions", // -> FormSubmissionDTO[]

  // forms — PUBLIC (no auth): only ACTIVE forms
  getPublicForm: "GET /forms/:id", // -> FormPublicDTO (404 if inactive/missing)
  submitForm: "POST /forms/:id/submit", // body FormSubmitInput -> FormSubmitResult
  formEmbedScript: "GET /forms/:id/embed.js", // -> JS for <script> paste-anywhere embeds

  // contacts / audiences (in-house list — replaces Mailchimp) — ADMIN (RBAC `contacts`)
  adminListAudiences: "GET /admin/audiences", // -> AudienceDTO[] (with contact + subscribed counts)
  adminCreateAudience: "POST /admin/audiences", // body CreateAudienceInput -> AudienceDTO
  adminGetAudience: "GET /admin/audiences/:id", // -> AudienceDTO
  adminUpdateAudience: "PATCH /admin/audiences/:id", // body UpdateAudienceInput -> AudienceDTO (isDefault:true unsets others)
  adminDeleteAudience: "DELETE /admin/audiences/:id", // -> { ok: true } (cascades fields/contacts/segments)
  adminListAudienceFields: "GET /admin/audiences/:id/fields", // -> AudienceFieldDTO[]
  adminUpsertAudienceField: "POST /admin/audiences/:id/fields", // body UpsertAudienceFieldInput -> AudienceFieldDTO (upsert by tag)
  adminDeleteAudienceField: "DELETE /admin/audiences/:id/fields/:tag", // -> { ok: true }
  adminListContacts: "GET /admin/audiences/:id/contacts", // ?status&tag&q&page&pageSize -> ContactListDTO
  adminCreateContact: "POST /admin/audiences/:id/contacts", // body CreateContactInput -> ContactDTO
  adminUpdateContact: "PATCH /admin/contacts/:id", // body UpdateContactInput -> ContactDTO
  adminDeleteContact: "DELETE /admin/contacts/:id", // -> { ok: true }
  adminImportContacts: "POST /admin/contacts/import", // -> ImportSummary (one-time Mailchimp → in-house import; idempotent; 400 if Mailchimp unconfigured)
  adminListSegments: "GET /admin/audiences/:id/segments", // -> SegmentDTO[] (each with resolved contactCount)
  adminCreateSegment: "POST /admin/audiences/:id/segments", // body CreateSegmentInput -> SegmentDTO
  adminUpdateSegment: "PATCH /admin/segments/:id", // body UpdateSegmentInput -> SegmentDTO
  adminDeleteSegment: "DELETE /admin/segments/:id", // -> { ok: true }

  // contacts — PUBLIC (no auth): double opt-in confirmation (PENDING -> SUBSCRIBED via the emailed token)
  confirmContact: "GET/POST /contacts/confirm?token=...",

  // email templates (MJML + Handlebars) — ADMIN (RBAC `email`)
  adminListEmailTemplates: "GET /admin/email/templates", // -> EmailTemplateDTO[]
  adminCreateEmailTemplate: "POST /admin/email/templates", // body CreateEmailTemplateInput -> EmailTemplateDTO
  adminGetEmailTemplate: "GET /admin/email/templates/:id", // -> EmailTemplateDTO
  adminUpdateEmailTemplate: "PATCH /admin/email/templates/:id", // body UpdateEmailTemplateInput -> EmailTemplateDTO
  adminDeleteEmailTemplate: "DELETE /admin/email/templates/:id", // -> { ok: true }; 400 for system templates (key != null)
  adminPreviewEmailTemplate: "POST /admin/email/templates/preview", // body RenderPreviewInput -> RenderPreviewResult (ad-hoc; no saved row)
  adminTestSendEmailTemplate: "POST /admin/email/templates/:id/test-send", // body TestSendInput -> EmailSendResultDTO (no dedupe)

  // campaigns (scheduled broadcasts) — ADMIN (RBAC `email`)
  adminListCampaigns: "GET /admin/email/campaigns", // -> CampaignDTO[]
  adminCreateCampaign: "POST /admin/email/campaigns", // body CampaignInput -> CampaignDTO (status DRAFT)
  adminGetCampaign: "GET /admin/email/campaigns/:id", // -> CampaignDTO
  adminUpdateCampaign: "PATCH /admin/email/campaigns/:id", // body CampaignInput -> CampaignDTO
  adminDeleteCampaign: "DELETE /admin/email/campaigns/:id", // -> { ok: true }
  adminScheduleCampaign: "POST /admin/email/campaigns/:id/schedule", // -> CampaignDTO (status SCHEDULED, nextRunAt set)
  adminPauseCampaign: "POST /admin/email/campaigns/:id/pause", // -> CampaignDTO (status PAUSED)

  // automations (event-triggered emails) — ADMIN (RBAC `email`)
  adminListAutomations: "GET /admin/email/automations", // -> AutomationDTO[]
  adminCreateAutomation: "POST /admin/email/automations", // body AutomationInput -> AutomationDTO
  adminUpdateAutomation: "PATCH /admin/email/automations/:id", // body AutomationInput -> AutomationDTO
  adminDeleteAutomation: "DELETE /admin/email/automations/:id", // -> { ok: true }

  // email logs (the send ledger) — ADMIN (RBAC `email` read)
  adminListEmailLogs: "GET /admin/email/logs", // ?status&q&page&pageSize -> EmailLogListDTO

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

  // certificates — MEMBER
  uncompleteLesson: "DELETE /lessons/:id/complete", // member; undo mark-complete -> { ok: true }
  claimCertificate: "POST /certificates/claim", // body ClaimCertificateInput -> MyCertificateDTO (idempotent)
  myCertificates: "GET /certificates/mine", // -> MyCertificateDTO[]
  downloadCertificate: "GET /certificates/:id/download", // owner/admin; Bearer or ?token= -> PDF stream
  // certificates — PUBLIC
  verifyCertificate: "GET /certificates/verify/:serial", // -> CertificateVerifyDTO (always 200)
  certificateFonts: "GET /cert-fonts/:file", // static TTFs (admin preview = PDF parity)
  // certificates — ADMIN
  adminListCertificateTemplates: "GET /admin/certificate-templates", // -> CertificateTemplateDTO[]
  adminGetCertificateTemplate: "GET /admin/certificate-templates/:id", // -> CertificateTemplateDTO
  adminCreateCertificateTemplate: "POST /admin/certificate-templates", // body CreateCertificateTemplateInput
  adminUpdateCertificateTemplate: "PATCH /admin/certificate-templates/:id", // body UpdateCertificateTemplateInput
  adminDeleteCertificateTemplate: "DELETE /admin/certificate-templates/:id", // issued certs keep snapshots (SetNull)
  adminListCertificates: "GET /admin/certificates", // ?q&page&pageSize -> AdminCertificateListDTO
  adminDeleteCertificate: "DELETE /admin/certificates/:id", // revoke: row + PDF file removed

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

  // billing — PayPal (member; active when admin selects the paypal provider)
  paypalPrepare: "POST /billing/paypal/prepare", // body PayPalPrepareInput -> PayPalPrepareResult (lazy-provisions the plan)
  paypalActivate: "POST /billing/paypal/activate", // body PayPalActivateInput -> SubscriptionDetailDTO[] (verify + grant inline)
  paypalWebhook: "POST /billing/paypal/webhook", // public; verified via PayPal verify-webhook-signature

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
  getEmailSettings: "GET /admin/settings/email", // -> EmailSettingsMasked (pass + Resend key never returned, only passSet/resendApiKeySet)
  putEmailSettings: "PUT /admin/settings/email", // body EmailSettingsInput (blank pass/resendApiKey keeps stored; provider "smtp"|"resend")
  deleteEmailSettings: "DELETE /admin/settings/email", // clears all email/SMTP creds
  getPayPalSettings: "GET /admin/settings/paypal", // -> {clientId, clientSecretLast4, webhookId, mode}
  putPayPalSettings: "PUT /admin/settings/paypal", // body {clientId?, clientSecret?, webhookId?, mode?}
  deletePayPalSettings: "DELETE /admin/settings/paypal", // clears all PayPal creds
  getPaymentProvider: "GET /admin/settings/payment-provider", // -> {provider}
  putPaymentProvider: "PUT /admin/settings/payment-provider", // body {provider}; 400 if target provider unconfigured

  // infra
  health: "GET /health", // public probe -> { status, env, uptime, checks: { db, redis } }
} as const;
