"use client";

import { useEffect, useState } from "react";

// Member-area theme toggle. The no-flash script in layout.tsx sets the initial
// data-theme on <html> before paint; this just flips + persists it. Dark is the
// brand default; light is the airy lavender variant.
type Pref = "light" | "dark";
const KEY = "lms.theme";

function readTheme(): Pref {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export default function ThemeToggle({
  className = "",
}: {
  className?: string;
}) {
  const [theme, setTheme] = useState<Pref>("dark");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = () => {
    const next: Pref = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode — fall back to in-memory only */
    }
    setTheme(next);
  };

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className={`nav-theme icon-btn ${className}`.trim()}
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
