import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

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

// Param list for the authenticated stack. Titles are optional where a screen
// can be entered by deep link / internal href (the screen sets the real title
// after its fetch). The "Main" screen hosts the tab navigator above.
export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList>;
  Class: { slugOrId: string; title?: string };
  CourseList: { title: string; categoryId?: string; all?: boolean };
  Course: { courseId: string; title?: string };
  Lesson: { lessonId: string; title?: string };
  LiveSession: { sessionId: string; title?: string };
  Certificates: undefined;
  Payments: undefined;
  Plans: undefined;
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
