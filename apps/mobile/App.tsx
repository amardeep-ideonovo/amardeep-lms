import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import type { LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
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
import { InstanceGate } from "./src/instance-gate";
import { navigationRef } from "./src/nav-ref";
import { ThemeProvider, useTheme } from "./src/theme-provider";
import { fonts } from "./src/theme";
import type {
  AuthStackParamList,
  RootStackParamList,
  TabParamList,
} from "./src/navigation";
import { LoginScreen } from "./src/screens/LoginScreen";
import { SignupScreen } from "./src/screens/SignupScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ClassScreen } from "./src/screens/ClassScreen";
import { CourseListScreen } from "./src/screens/CourseListScreen";
import { CourseScreen } from "./src/screens/CourseScreen";
import { LessonScreen } from "./src/screens/LessonScreen";
import { LiveSessionScreen } from "./src/screens/LiveSessionScreen";
import { AccountScreen } from "./src/screens/AccountScreen";
import { PaymentsScreen } from "./src/screens/PaymentsScreen";
import { PlansScreen } from "./src/screens/PlansScreen";
import { BlogListScreen } from "./src/screens/BlogListScreen";
import { BlogPostScreen } from "./src/screens/BlogPostScreen";
import { PageScreen } from "./src/screens/PageScreen";

// OS-level deep links (lms:// + the web origin) map straight onto the authed
// stack — same table as src/links.ts. The Page catch-all MUST stay last.
// Logged-out cold starts fall back to the Login stack (known v1 limit).
// Built per render (not module-level): WEB_BASE_URL is a live binding that is
// only known after the instance gate binds an instance on shared builds.
function buildLinking(): LinkingOptions<RootStackParamList> {
  return {
    prefixes: WEB_BASE_URL
      ? [ExpoLinking.createURL("/"), WEB_BASE_URL]
      : [ExpoLinking.createURL("/")],
    // The expo-dev-client launch URL (lms://expo-development-client/?url=…) is
    // for the dev launcher, not the app — without this filter the Page catch-all
    // below swallows it and every dev launch lands on "Page not found".
    filter: (url) => !url.includes("expo-development-client"),
    config: {
      screens: {
        // Dashboard / Blog / Account now live inside the "Main" tab navigator, so
        // their deep-link paths are declared as nested screens of Main.
        Main: {
          screens: {
            Dashboard: "dashboard",
            Blog: "blog",
            Account: "account",
          },
        },
        Class: "classes/:slugOrId",
        Course: "courses/:courseId",
        Lesson: "lessons/:lessonId",
        LiveSession: "live/:sessionId",
        BlogPost: "blog/:slug",
        Payments: "account/payments",
        Plans: "pricing/all",
        Page: ":slug",
      },
    },
  };
}

const AppStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// Bottom-tab icon (Ionicons, bundled with Expo). Active/inactive tint comes
// from the navigator's tabBarActive/InactiveTintColor.
function TabIcon({
  name,
  color,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}) {
  return <Ionicons name={name} size={22} color={color} />;
}

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

// The persistent authed shell — a bottom tab bar with Dashboard / Blog /
// Account. Each tab owns its OWN header (styled like the stack chrome below);
// detail screens push OVER the tabs from the root stack. The bottom safe-area
// inset is handled automatically by bottom-tabs via safe-area-context.
function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 17 },
        // Dark glass tab bar.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSoft,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          // The home header carries the brand (admin-configured logo or title),
          // not the screen name — matches the admin live-preview.
          headerTitle: () => <BrandHeaderTitle />,
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "home" : "home-outline"} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Blog"
        component={BlogListScreen}
        options={{
          title: "Blog",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "newspaper" : "newspaper-outline"} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{
          title: "Account",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "person" : "person-outline"} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Authenticated screens — the main app. The "Main" tab shell carries its own
// headers; the detail screens below push OVER the tabs with stack header chrome
// that follows the active theme.
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
        name="Main"
        component={MainTabs}
        options={{ headerShown: false }}
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
      <AppStack.Screen
        name="LiveSession"
        component={LiveSessionScreen}
        options={({ route }) => ({ title: route.params.title ?? "Live Session" })}
      />
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

// Version-skew gates: friendly full-screen states instead of screens breaking
// on missing/renamed endpoints. Recovery is automatic — the config provider
// re-fetches every 30s and on foreground, so these clear on their own.
function VersionGate({ kind }: { kind: "appOutdated" | "apiOutdated" }) {
  const { colors } = useTheme();
  const { config } = useAppConfig();
  const title = kind === "appOutdated" ? "Update required" : "Back soon";
  const body =
    kind === "appOutdated"
      ? `A newer version of the ${config.title} app is required. Please update from the app store.`
      : `${config.title} is being updated right now. This usually takes a few minutes — the app will reconnect automatically.`;
  return (
    <View style={[styles.center, { backgroundColor: colors.bg, padding: 32 }]}>
      <Text
        style={{
          color: colors.text,
          fontSize: 24,
          fontFamily: fonts.display,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 15,
          fontFamily: fonts.regular,
          textAlign: "center",
          marginTop: 12,
          lineHeight: 22,
        }}
      >
        {body}
      </Text>
      {kind === "apiOutdated" && (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      )}
    </View>
  );
}

function RootNavigator() {
  const { token, loading: authLoading } = useAuth();
  const { loading: configLoading, compat } = useAppConfig();
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

  // Version handshake: an app the API no longer supports must update; an API
  // older than this app build gets a "updating" holding screen (fleet lockstep
  // upgrades make this a minutes-long window, not a stuck state).
  if (compat.appOutdated) return <VersionGate kind="appOutdated" />;
  if (compat.apiOutdated) return <VersionGate kind="apiOutdated" />;

  // Auth gate: no stored token -> Login + Signup stack; otherwise the app.
  return token == null ? <AuthNavigator /> : <AppNavigator />;
}

// Reads the active theme to build the navigation theme + status bar style. Lives
// under ThemeProvider so it re-renders when the admin config / device theme changes.
function ThemedApp() {
  const { mode, colors } = useTheme();
  // Linking prefixes read the live WEB_BASE_URL — resolved by the instance
  // gate before this tree mounts (and this tree remounts per instance).
  const linking = useMemo(buildLinking, []);
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
      <InstanceGate>
        <ConfigProvider>
          <ThemeProvider>
            <AuthProvider>
              <ThemedApp />
            </AuthProvider>
          </ThemeProvider>
        </ConfigProvider>
      </InstanceGate>
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
