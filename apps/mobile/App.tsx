import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "./src/auth";
import { ConfigProvider, useAppConfig } from "./src/config-provider";
import { ThemeProvider, useTheme } from "./src/theme-provider";
import type {
  AuthStackParamList,
  RootStackParamList,
} from "./src/navigation";
import { LoginScreen } from "./src/screens/LoginScreen";
import { SignupScreen } from "./src/screens/SignupScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { CourseListScreen } from "./src/screens/CourseListScreen";
import { CourseScreen } from "./src/screens/CourseScreen";
import { LessonScreen } from "./src/screens/LessonScreen";
import { AccountScreen } from "./src/screens/AccountScreen";
import { BlogListScreen } from "./src/screens/BlogListScreen";
import { BlogPostScreen } from "./src/screens/BlogPostScreen";
import { PageScreen } from "./src/screens/PageScreen";

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
    contentStyle: { backgroundColor: colors.bg },
  };
  return (
    <AppStack.Navigator screenOptions={screenOptions}>
      <AppStack.Screen name="Dashboard" component={DashboardScreen} />
      <AppStack.Screen
        name="CourseList"
        component={CourseListScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <AppStack.Screen
        name="Course"
        component={CourseScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <AppStack.Screen
        name="Lesson"
        component={LessonScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <AppStack.Screen name="Account" component={AccountScreen} />
      <AppStack.Screen
        name="Blog"
        component={BlogListScreen}
        options={{ title: "Blog" }}
      />
      <AppStack.Screen
        name="BlogPost"
        component={BlogPostScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <AppStack.Screen
        name="Page"
        component={PageScreen}
        options={({ route }) => ({ title: route.params.title })}
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
    <NavigationContainer theme={navTheme}>
      <StatusBar style={mode === "light" ? "dark" : "light"} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
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
