import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type {
  ClassTileDTO,
  CourseCard,
  LessonDTO,
  HelpdeskCategory,
} from "@lms/types";

// Bottom-tab param list — the persistent authed shell (Home / Classes / Live /
// Profile, per the Ink Hero design). These live INSIDE the "Main" tab
// navigator, nested in the root stack below; detail screens push OVER the tabs
// from the stack. Blog moved out of the tabs into the root stack (reached from
// Profile + deep links).
export type TabParamList = {
  Home: undefined;
  Classes: undefined;
  Live: undefined;
  Profile: undefined;
};

// ---------- first-paint seeds ----------
// A list screen already holds the row it navigated from, so the destination can
// paint that row's title/artwork immediately instead of a cold spinner over data
// the client had milliseconds earlier.
//
// Two hard rules, enforced at every call site:
//   1. A seed is PRESENTATIONAL ONLY and never satisfies a "do we have data?"
//      guard — the destination still runs its real fetch and renders the seed
//      strictly as a placeholder, so a partial can't be mistaken for the whole.
//   2. NOTHING entitlement-bearing travels in a param: no ownership, `locked`,
//      price, video URL, lesson body or certificate state. Access always comes
//      from the server response. Fields below are exactly what the tapped card
//      was already displaying.
export type ClassSeed = {
  name: string;
  imageUrl: string | null;
};

export type CourseSeed = {
  title: string;
  coverImageUrl: string | null;
  // Progress counts, not access: they only label the progress bar while the
  // lesson list is in flight.
  lessonCount: number;
  completedCount: number;
};

export type LessonSeed = {
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

// Build seeds ONLY through these — one place decides what may cross a
// navigation boundary, so a call site can't quietly widen it to `owned`,
// `locked`, `progress`, prices or anything else the server must rule on.
export const classSeed = (c: ClassTileDTO): ClassSeed => ({
  name: c.name,
  imageUrl: c.imageUrl,
});

export const courseSeed = (c: CourseCard): CourseSeed => ({
  title: c.title,
  coverImageUrl: c.coverImageUrl,
  lessonCount: c.lessonCount,
  completedCount: c.completedCount,
});

export const lessonSeed = (l: LessonDTO): LessonSeed => ({
  title: l.title,
  thumbnailUrl: l.thumbnailUrl ?? null,
  durationSeconds: l.durationSeconds ?? null,
});

// Param list for the authenticated stack. Titles are optional where a screen
// can be entered by deep link / internal href (the screen sets the real title
// after its fetch). The "Main" screen hosts the tab navigator above.
export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList>;
  Class: { slugOrId: string; title?: string; seed?: ClassSeed };
  CourseList: { title: string; categoryId?: string; all?: boolean };
  Course: { courseId: string; title?: string; seed?: CourseSeed };
  Lesson: { lessonId: string; title?: string; seed?: LessonSeed };
  LiveSession: { sessionId: string; title?: string };
  Certificates: undefined;
  Payments: undefined;
  Plans: undefined;
  /** `compose` asks home to open the message-the-team box (an answer screen's
   *  "Still stuck?" hands back here rather than duplicating the composer). */
  HelpdeskHome: { compose?: boolean } | undefined;
  /** One topic's answer, on its own screen — self-serve lookups are a
   *  there-and-back errand, not turns appended to a conversation. */
  HelpdeskAnswer: { category: HelpdeskCategory; title: string };
  /** One admin-authored help article, same there-and-back shape. */
  HelpdeskArticle: { articleId: string; title: string };
  HelpdeskThread: {
    conversationId: string;
    subject?: string;
    replyTimeNote?: string | null;
  };
  Blog: undefined;
  BlogPost: { slug: string; title?: string };
  Page: { slug: string; title?: string };
};

// Param list for the unauthenticated stack (Login + Signup).
export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type ScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

// Tab screens need both tab navigation AND access to the parent stack's detail
// routes (Class, Course, etc.), so their navigation prop is the composite of
// the tab and the enclosing root stack.
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
