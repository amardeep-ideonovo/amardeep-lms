// RN mirror of the web's `prefers-reduced-motion` media query: when the OS
// "Reduce Motion" setting is on, decorative animation must become an instant
// jump. Defaults to false (animate) until the async read lands — a one-frame
// animation for a reduce-motion user is better than freezing everyone's
// first paint on an await.
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (v) => {
        if (live) setReduced(v);
      },
      () => {}, // platform can't say → keep animating
    );
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
