import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "./src/auth";
import type {
  AuthStackParamList,
  RootStackParamList,
} from "./src/navigation";
import { colors } from "./src/theme";
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

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  contentStyle: { backgroundColor: colors.bg },
} as const;

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

// Authenticated screens — the main app.
function AppNavigator() {
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
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Auth gate: no stored token -> Login + Signup stack; otherwise the app.
  return token == null ? <AuthNavigator /> : <AppNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
});
