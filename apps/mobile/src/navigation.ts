import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// Param list for the authenticated stack.
export type RootStackParamList = {
  Dashboard: undefined;
  Course: { courseId: string; title: string };
  Lesson: { lessonId: string; title: string };
  Account: undefined;
  Blog: undefined;
  BlogPost: { slug: string; title: string };
};

export type ScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
