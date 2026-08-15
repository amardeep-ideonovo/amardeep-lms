// Pure boot-brand resolver for the animated splash. No imports on purpose:
// splash-brand.spec.ts runs under node:test via transpile-only ts-node, where
// any react-native/expo import would crash the runner (see build.yml's
// test-mobile job note).

export type SplashBrand =
  | { kind: "lockup"; initial: string; word: string; sub: string }
  | { kind: "title"; initial: string; title: string }
  | { kind: "mark" };

// Decide what the boot splash may call itself.
// - `title` is the best known brand for this install (cached AppConfig title,
//   else the connect-time instance name), or null when nothing trustworthy is
//   stored — callers pass the product default only for UNBOUND shared installs.
// - The styled two-line lockup (lowercase word + spaced uppercase sub) is an
//   art treatment of the PRODUCT default title specifically; any other title
//   renders verbatim, single line, so client brands are never restyled.
// - No usable title -> bare mark. Showing no brand beats showing a wrong one.
export function splashBrand(
  title: string | null | undefined,
  defaultTitle: string,
): SplashBrand {
  const t = title?.trim();
  if (!t) return { kind: "mark" };
  // Spread is surrogate-pair-safe (emoji initials survive); full grapheme
  // clustering isn't worth a dependency for a monogram.
  const initial = ([...t][0] ?? "").toUpperCase();
  if (t === defaultTitle.trim()) {
    const words = t.split(/\s+/);
    return {
      kind: "lockup",
      initial,
      word: (words[0] ?? t).toLowerCase(),
      sub: words.slice(1).join(" ").toUpperCase(),
    };
  }
  return { kind: "title", initial, title: t };
}
