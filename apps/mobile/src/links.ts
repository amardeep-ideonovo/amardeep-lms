// Internal href → native route resolver. Admin menus, CMS buttons/cards, and
// popup CTAs emit web-style hrefs (see the API's menu-href util); this maps
// them onto the native stack so taps navigate in-app instead of dying.
// Anything commerce/auth-shaped stays on the web, and anything unresolvable
// opens in the browser — a tap must never be a no-op.
import { Linking } from "react-native";

import { WEB_BASE_URL } from "./config";
import { navigationRef } from "./nav-ref";

// First path segments that must NOT fall through to the CMS Page catch-all.
const RESERVED = new Set([
  "dashboard",
  "classes",
  "courses",
  "lessons",
  "blog",
  "account",
  "pricing",
  "checkout",
  "login",
  "signup",
  "forms",
]);

const openExternal = (url: string) => {
  Linking.openURL(url).catch(() => {});
};

export function openAppHref(href: string): void {
  const raw = (href || "").trim();
  if (!raw) return;

  // Absolute URLs: ours re-enter as paths; foreign ones open externally.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.origin === WEB_BASE_URL) {
        openPath(url.pathname, raw);
        return;
      }
    } catch {
      // fall through to external
    }
    openExternal(raw);
    return;
  }
  if (/^(mailto:|tel:)/i.test(raw)) {
    openExternal(raw);
    return;
  }
  openPath(raw, WEB_BASE_URL + (raw.startsWith("/") ? raw : `/${raw}`));
}

function openPath(pathname: string, browserFallback: string): void {
  const path = pathname.split("?")[0].replace(/\/+$/, "");
  const segs = path.split("/").filter(Boolean);

  // Resolver can fire before the authed stack mounts (cold deep link) — the
  // browser fallback keeps the tap meaningful.
  if (!navigationRef.isReady()) {
    openExternal(browserFallback);
    return;
  }
  const nav = navigationRef;

  if (segs.length === 0) {
    nav.navigate("Dashboard");
    return;
  }

  const [head, second] = segs;
  switch (head) {
    case "dashboard":
      nav.navigate("Dashboard");
      return;
    case "classes":
      if (second) nav.navigate("Class", { slugOrId: second });
      else nav.navigate("Dashboard");
      return;
    case "courses":
      if (second) nav.navigate("Course", { courseId: second });
      else nav.navigate("CourseList", { title: "All courses", all: true });
      return;
    case "lessons":
      if (second) nav.navigate("Lesson", { lessonId: second });
      else nav.navigate("Dashboard");
      return;
    case "blog":
      if (second) nav.navigate("BlogPost", { slug: second });
      else nav.navigate("Blog");
      return;
    case "account":
      if (second === "payments") nav.navigate("Payments");
      else nav.navigate("Account");
      return;
    case "pricing":
      // The plans LIST is native now; actual checkout stays on the web.
      nav.navigate("Plans");
      return;
    case "checkout":
    case "login":
    case "signup":
    case "forms":
      // Commerce/auth stays on the web.
      openExternal(browserFallback);
      return;
    default:
      // Single-segment, non-reserved => a CMS page slug.
      if (segs.length === 1 && !RESERVED.has(head)) {
        nav.navigate("Page", { slug: head });
        return;
      }
      openExternal(browserFallback);
  }
}
