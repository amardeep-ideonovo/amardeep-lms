import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import type { LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ExpoLinking from "expo-linking";
import { useFonts } from "expo-font";
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
} from "@expo-google-fonts/montserrat";
import {
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_800ExtraBold,
} from "@expo-google-fonts/playfair-display";

import { AuthProvider, useAuth } from "./src/auth";
import { BrandHeaderTitle } from "./src/components/BrandHeaderTitle";
import { WEB_BASE_URL } from "./src/config";
import { ConfigProvider, useAppConfig } from "./src/config-provider";
import { navigationRef } from "./src/nav-ref";
import { ThemeProvider, useTheme } from "./src/theme-provider";
import { fonts } from "./src/theme";
import type {
  AuthStackParamList,
  RootStackParamList,
} from "./src/navigation";
import { LoginScreen } from "./src/screens/LoginScreen";
import { SignupScreen } from "./src/screens/SignupScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ClassScreen } from "./src/screens/ClassScreen";
import { CourseListScreen } from "./src/screens/CourseListScreen";
import { CourseScreen } from "./src/screens/CourseScreen";
import { LessonScreen } from "./src/screens/LessonScreen";
import { AccountScreen } from "./src/screens/AccountScreen";
import { PaymentsScreen } from "./src/screens/PaymentsScreen";
import { PlansScreen } from "./src/screens/PlansScreen";
import { BlogListScreen } from "./src/screens/BlogListScreen";
import { BlogPostScreen } from "./src/screens/BlogPostScreen";
import { PageScreen } from "./src/screens/PageScreen";

// OS-level deep links (lms:// + the web origin) map straight onto the authed
// stack — same table as src/links.ts. The Page catch-all MUST stay last.
// Logged-out cold starts fall back to the Login stack (known v1 limit).
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [ExpoLinking.createURL("/"), WEB_BASE_URL],
  // The expo-dev-client launch URL (lms://expo-development-client/?url=…) is
  // for the dev launcher, not the app — without this filter the Page catch-all
  // below swallows it and every dev launch lands on "Page not found".
  filter: (url) => !url.includes("expo-development-client"),
  config: {
    screens: {
      Dashboard: "dashboard",
      Class: "classes/:slugOrId",
      Course: "courses/:courseId",
      Lesson: "lessons/:lessonId",
      Blog: "blog",
      BlogPost: "blog/:slug",
      Account: "account",
      Payments: "account/payments",
      Plans: "pricing/all",
      Page: ":slug",
    },
  },
};

const AppStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

// Unauthenticated screens — Login + Signup. Header is hidden so the screens
// own their own layout.
function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

// Authenticated screens — the main app. Header chrome follows the active theme.
function AppNavigator() {
  const { colors } = useTheme();
  const screenOptions = {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: fonts.bold, fontSize: 17 },
    contentStyle: { backgroundColor: colors.bg },
  };
  return (
    <AppStack.Navigator screenOptions={screenOptions}>
      <AppStack.Screen
        name="Dashboard"
        component={DashboardScreen}
        // The home header carries the brand (admin-configured logo or title),
        // not the screen name — matches the admin live-preview.
        options={{ headerTitle: () => <BrandHeaderTitle /> }}
      />
      <AppStack.Screen
        name="Class"
        component={ClassScreen}
        options={({ route }) => ({ title: route.params.title ?? "Class" })}
      />
      <AppStack.Screen
        name="CourseList"
        component={CourseListScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <AppStack.Screen
        name="Course"
        component={CourseScreen}
        options={({ route }) => ({ title: route.params.title ?? "Course" })}
      />
      <AppStack.Screen
        name="Lesson"
        component={LessonScreen}
        options={({ route }) => ({ title: route.params.title ?? "Lesson" })}
      />
      <AppStack.Screen name="Account" component={AccountScreen} />
      <AppStack.Screen
        name="Payments"
        component={PaymentsScreen}
        options={{ title: "Payment history" }}
      />
      <AppStack.Screen
        name="Plans"
        component={PlansScreen}
        options={{ title: "All plans" }}
      />
      <AppStack.Screen
        name="Blog"
        component={BlogListScreen}
        options={{ title: "Blog" }}
      />
      <AppStack.Screen
        name="BlogPost"
        component={BlogPostScreen}
        options={({ route }) => ({ title: route.params.title ?? "Post" })}
      />
      <AppStack.Screen
        name="Page"
        component={PageScreen}
        options={({ route }) => ({ title: route.params.title ?? "Page" })}
      />
    </AppStack.Navigator>
  );
}

function RootNavigator() {
  const { token, loading: authLoading } = useAuth();
  const { loading: configLoading } = useAppConfig();
  const { colors } = useTheme();

  // Wait for both the stored token AND the branding config so the first paint is
  // already correctly themed (config seeds from cache, so this is brief).
  if (authLoading || configLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Auth gate: no stored token -> Login + Signup stack; otherwise the app.
  return token == null ? <AuthNavigator /> : <AppNavigator />;
}

// Reads the active theme to build the navigation theme + status bar style. Lives
// under ThemeProvider so it re-renders when the admin config / device theme changes.
function ThemedApp() {
  const { mode, colors } = useTheme();
  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors],
  );

  return (
    <NavigationContainer ref={navigationRef} linking={linking} theme={navTheme}>
      <StatusBar style={mode === "light" ? "dark" : "light"} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  // Load the brand faces before first paint. On error we proceed anyway so a
  // font hiccup never hangs the app (text falls back to the system face).
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_800ExtraBold,
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <ConfigProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedApp />
          </AuthProvider>
        </ThemeProvider>
      </ConfigProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
