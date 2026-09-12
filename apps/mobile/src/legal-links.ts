// Pure resolution of the in-app legal-link targets — no Expo, no React Native —
// so the precedence rules are unit-testable. config.ts wraps these with the
// live DIRECTORY_URL / WEB_BASE_URL values.
//
// Who owns which policy (the store "whose policy" model):
// - CONNECTED to an academy → that academy's OWN pages. Every academy is seeded
//   with editable /privacy and /terms (seedLegalPages), and its AppConfig may
//   override either with an absolute URL.
// - BEFORE connecting (shared store app) → the connect screen is the platform's
//   surface: the connect code (and the device's IP) go to the directory, not to
//   any academy. The applicable notice is the platform's MEMBER-facing privacy
//   page — the same URL the store listings carry — never the B2B one at /privacy.
//   There is no member-facing platform Terms page; Terms belong to the academy a
//   member signs up with, so pre-connect exposes Privacy only.

export const PLATFORM_PRIVACY_PATH = "/app/privacy";
export const ACADEMY_PRIVACY_PATH = "/privacy";
export const ACADEMY_TERMS_PATH = "/terms";

export type LegalOverride = {
  privacyUrl?: string | null;
  termsUrl?: string | null;
};

export type LegalTargets = { privacy: string; terms: string };

const trimSlash = (u: string): string => u.replace(/\/$/, "");

// Resolve a stored legal URL to something Linking.openURL can open: an absolute
// http(s) URL is used as-is; a "/path" is joined to the bound member site; a
// relative path with no bound site (or anything else) is unusable → null.
export function resolveLegalUrl(
  u: string | null | undefined,
  webBaseUrl: string,
): string | null {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  const base = trimSlash(webBaseUrl);
  return u.startsWith("/") && base ? `${base}${u}` : null;
}

// Privacy + Terms for a CONNECTED academy. Precedence: the academy's AppConfig
// override, then its own seeded pages on the bound member site. Null when no
// member site is bound — call sites hide the links rather than open a broken or
// wrong-owner URL.
export function resolveLegalLinks(
  webBaseUrl: string,
  override?: LegalOverride,
): LegalTargets | null {
  const base = trimSlash(webBaseUrl);
  const derived = base
    ? {
        privacy: `${base}${ACADEMY_PRIVACY_PATH}`,
        terms: `${base}${ACADEMY_TERMS_PATH}`,
      }
    : null;
  const privacy =
    resolveLegalUrl(override?.privacyUrl, webBaseUrl) ??
    derived?.privacy ??
    null;
  const terms =
    resolveLegalUrl(override?.termsUrl, webBaseUrl) ?? derived?.terms ?? null;
  return privacy && terms ? { privacy, terms } : null;
}

// The platform's member-facing Privacy Policy for the pre-connect screen of the
// shared app. Null on locked / white-label builds (no directory), which never
// show that screen anyway.
export function resolvePlatformPrivacyUrl(directoryUrl: string): string | null {
  const base = trimSlash(directoryUrl);
  return base ? `${base}${PLATFORM_PRIVACY_PATH}` : null;
}
