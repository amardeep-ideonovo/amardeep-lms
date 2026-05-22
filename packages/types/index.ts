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
  type: LevelType;
  mailchimpTag: string | null;
  stripeProductId: string | null;
  prices: PriceDTO[];
}
export interface CreateLevelInput {
  name: string;
  type: LevelType;
  mailchimpTag?: string;
  prices?: { interval: "month" | "year"; amount: number; currency?: string }[];
}

export interface MemberRow {
  id: string;
  username: string;
  email: string;
  registeredAt: string; // ISO
  levels: { id: string; name: string; status: UserLevelStatus }[];
}

export interface CategoryDTO {
  id: string;
  name: string;
  order: number;
}
export interface CourseCard {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  locked: boolean; // computed from the viewer's active levels
}
export interface LessonDTO {
  id: string;
  courseId: string;
  title: string;
  content: string | null;
  muxPlaybackToken?: string; // signed; present only when the viewer has access
  order: number;
  completed?: boolean;
}
export interface DashboardResponse {
  categories: { category: CategoryDTO; courses: CourseCard[] }[];
}

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
  category: PostCategoryDTO | null;
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
  categoryId: string | null;
  category: PostCategoryDTO | null;
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
  categoryId?: string;
  tags?: string[];
  status?: PostStatus; // default DRAFT
}
export type UpdatePostInput = Partial<CreatePostInput>;
export interface CreatePostCategoryInput {
  name: string;
  order?: number;
}

// ---------- REST contract ----------
// Base: process.env API URL. All authed routes use `Authorization: Bearer <token>`.
export const ROUTES = {
  // auth
  memberLogin: "POST /auth/login", // body {email,password} -> LoginResponse<AuthUser>
  adminLogin: "POST /auth/admin/login", // -> LoginResponse<AuthAdmin>
  me: "GET /auth/me",

  // admin: levels
  listLevels: "GET /levels",
  createLevel: "POST /levels",
  updateLevel: "PATCH /levels/:id",
  deleteLevel: "DELETE /levels/:id",

  // admin: members
  listMembers: "GET /members", // -> MemberRow[]
  addMemberLevel: "POST /members/:id/levels", // body {levelId}
  removeMemberLevel: "DELETE /members/:id/levels/:levelId",

  // lms
  listCategories: "GET /categories",
  createCategory: "POST /categories",
  listCourses: "GET /courses", // admin: all; member: includes locked flag
  createCourse: "POST /courses", // body {title, description?, categoryId?, levelIds:[]}
  updateCourse: "PATCH /courses/:id",
  listCourseLessons: "GET /courses/:id/lessons",
  createLesson: "POST /courses/:id/lessons", // body {title, content?, muxAssetId?}
  getLesson: "GET /lessons/:id", // 403 if viewer lacks access
  completeLesson: "POST /lessons/:id/complete",

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

  // billing (member)
  checkout: "POST /billing/checkout", // body {priceId} -> {url}
  portal: "GET /billing/portal", // -> {url} (Stripe Customer Portal)
  stripeWebhook: "POST /billing/webhook",

  // admin settings (secrets are write-only; GET returns masked/last4 only)
  getStripeSettings: "GET /admin/settings/stripe",
  putStripeSettings: "PUT /admin/settings/stripe",
  getMailchimpSettings: "GET /admin/settings/mailchimp",
  putMailchimpSettings: "PUT /admin/settings/mailchimp",
} as const;
