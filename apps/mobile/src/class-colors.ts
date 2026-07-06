// Ink Hero class accent palette (design tokens.css --music/--cooking/…).
// Accent slots are NAMED after content categories, so a real class picks its
// slot by category/name keywords (the API lists classes alphabetically — a
// pure position cycle scrambles the intended colors); unmatched classes fall
// back to the list-position cycle. `base`/`dark` are the RGB triplets the
// photo-tint gradient uses (signature pattern #2); `text` is on-light text.
export type ClassAccent = {
  color: string;
  base: string; // "r,g,b"
  dark: string; // "r,g,b"
  text: string;
};

export const CLASS_ACCENTS: ClassAccent[] = [
  { color: "#f7a01e", base: "196,112,6", dark: "120,66,2", text: "#b46f0a" }, // music amber
  { color: "#9046c8", base: "112,42,163", dark: "74,22,112", text: "#7a3bab" }, // cooking purple
  { color: "#43a565", base: "42,124,72", dark: "24,88,48", text: "#2d7a45" }, // photography green
  { color: "#e04848", base: "187,41,41", dark: "132,22,22", text: "#c03a3a" }, // filmmaking red
  // tokens.css ships no gradient triplets for dance/comedy — these are derived
  // with the same darken ratio as the published four.
  { color: "#4a76d0", base: "42,86,176", dark: "26,54,118", text: "#3a62b4" }, // dance blue
  { color: "#27a596", base: "24,138,124", dark: "14,90,80", text: "#1f8a7c" }, // comedy sea
];

export function classAccent(index: number): ClassAccent {
  const n = CLASS_ACCENTS.length;
  return CLASS_ACCENTS[((index % n) + n) % n];
}

// Slot keywords in priority order — comedy before film so "Film & TV · Comedy"
// lands on sea, not red.
const ACCENT_KEYWORDS: Array<[RegExp, number]> = [
  [/comedy|stand.?up/i, 5],
  [/music|song/i, 0],
  [/cook|food|culinary|kitchen|flavor/i, 1],
  [/photo/i, 2],
  [/film|cinema|screen|tv/i, 3],
  [/dance|choreo/i, 4],
];

export function classAccentIndex(
  name: string,
  categories: string[],
  fallback: number,
): number {
  const hay = `${name} ${categories.join(" ")}`;
  for (const [re, idx] of ACCENT_KEYWORDS) if (re.test(hay)) return idx;
  return ((fallback % CLASS_ACCENTS.length) + CLASS_ACCENTS.length) % CLASS_ACCENTS.length;
}

/** id → accent slot for a class list (category-keyed, position fallback). */
export function accentIndexMap(
  classes: Array<{ id: string; name: string; categories?: Array<{ name: string }> | null }>,
): Map<string, number> {
  const m = new Map<string, number>();
  classes.forEach((c, i) =>
    m.set(c.id, classAccentIndex(c.name, (c.categories ?? []).map((x) => x.name), i)),
  );
  return m;
}

// Photo-tint gradient stops: solid color behind the title fading so the photo
// shows below (design: 178deg, rgba(base,.9) 0% → rgba(base,.5) 46% → rgba(dark,.4) 100%).
export function accentTint(a: ClassAccent): [string, string, string] {
  return [`rgba(${a.base},0.9)`, `rgba(${a.base},0.5)`, `rgba(${a.dark},0.4)`];
}
export const ACCENT_TINT_LOCATIONS: [number, number, number] = [0, 0.46, 1];
