import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// Param list for the authenticated stack.
export type RootStackParamList = {
  Dashboard: undefined;
  CourseList: { title: string; categoryId?: string; all?: boolean };
  Course: { courseId: string; title: string };
  Lesson: { lessonId: string; title: string };
  Account: undefined;
  Blog: undefined;
  BlogPost: { slug: string; title: string };
  Page: { slug: string; title: string };
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
