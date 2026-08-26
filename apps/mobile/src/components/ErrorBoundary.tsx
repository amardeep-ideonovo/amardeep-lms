// Last-resort crash screen. A render throw anywhere below used to unwind to a
// hard native crash (blank screen / app killed) — an automatic store-review
// rejection if a reviewer trips one. This boundary sits ABOVE ThemeProvider so
// it still renders when theming itself is what threw; the colors are therefore
// fixed neutrals (brand ink + white), not theme tokens.
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { STR } from "@lms/types";

type Props = { children: React.ReactNode };
type State = { error: Error | null; attempt: number };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Dev-visible only; the app has no crash-reporting SDK (by design — no
    // trackers in the store build).
    console.error("[error-boundary]", error, info.componentStack);
  }

  private retry = () => {
    // Bumping attempt remounts the whole subtree via the key below, so retry
    // recovers from transient state, not just re-renders the broken tree.
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The app hit an unexpected error. Your progress is safe — try again,
            or close and reopen the app.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.retry}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{STR.common.retry}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <React.Fragment key={this.state.attempt}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#221c3d", // brand ink — matches the splash ground
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12,
  },
  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 320,
  },
  button: {
    marginTop: 8,
    backgroundColor: "#34c9a2", // spark teal
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 26,
  },
  buttonText: {
    color: "#221c3d", // CTA labels on teal are ink (brand rule)
    fontSize: 15,
    fontWeight: "700",
  },
});
