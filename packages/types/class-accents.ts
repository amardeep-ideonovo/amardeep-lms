// Class accent slots — THE single source (docs/coding-standards.md D2).
// Until 2026-08 this lived as three verbatim copies (web/lib/memberData.ts,
// admin/lib/class-accent.ts, mobile/src/class-colors.ts), each carrying a
// "keep in sync" comment; those files are now thin re-export shims.
//
// A class picks its slot by category/name keyword rather than list position,
// because the API lists classes alphabetically — a pure position cycle would
// re-color every class whenever one is added or renamed. Unmatched classes
// fall back to the position cycle, so an arbitrary client catalog still looks
// deliberate. Slots are named by COLOR, not subject: they dress whatever a
// client's catalog happens to sell.

export const ACCENT_SLOT_COUNT = 6;

export type ClassAccent = {
  color: string;
  base: string; // "r,g,b" — photo-tint gradient start
  dark: string; // "r,g,b" — photo-tint gradient end
  text: string; // on-light text
};

// Mirrors globals.css slots 0 amber · 1 violet · 2 green · 3 red · 4 blue ·
// 5 sea. The demo artwork in packages/db/prisma/assets/generate-demo-art.ts
// paints to match slots 0-4 — keep that file's ACCENT table consistent.
export const CLASS_ACCENTS: ClassAccent[] = [
  { color: "#f7a01e", base: "196,112,6", dark: "120,66,2", text: "#b46f0a" }, // 0 amber
  { color: "#9046c8", base: "112,42,163", dark: "74,22,112", text: "#7a3bab" }, // 1 violet
  { color: "#43a565", base: "42,124,72", dark: "24,88,48", text: "#2d7a45" }, // 2 green
  { color: "#e04848", base: "187,41,41", dark: "132,22,22", text: "#c03a3a" }, // 3 red
  // globals.css shipped no gradient triplets for slots 4-5 originally — these
  // are derived with the same darken ratio as the published four.
  { color: "#4a76d0", base: "42,86,176", dark: "26,54,118", text: "#3a62b4" }, // 4 blue
  { color: "#27a596", base: "24,138,124", dark: "14,90,80", text: "#1f8a7c" }, // 5 sea
];

export function classAccent(index: number): ClassAccent {
  const n = CLASS_ACCENTS.length;
  return CLASS_ACCENTS[((index % n) + n) % n];
}

// Slot keywords in priority order — first match wins. The seeded demo catalog
// leads (music/food/sports/technology → amber/violet/green/blue, matching the
// generated artwork); the rest cover other subjects a client catalog might
// use. Comedy precedes film so "Film & TV · Comedy" lands on sea, not red.
export const ACCENT_KEYWORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/music|song/i, 0],
  [/cook|food|culinary|kitchen|flavor|baking/i, 1],
  [/sport|fitness|athlet|strength|conditioning/i, 2],
  [/technolog|software|coding|web develop|developer|programming/i, 4],
  [/comedy|stand.?up/i, 5],
  [/photo/i, 2],
  [/film|cinema|screen|tv/i, 3],
  [/dance|choreo/i, 4],
];

// Canonical signature takes name + categories; callers without category data
// (e.g. admin surfaces that only have the class name) pass [].
export function classAccentIndex(
  name: string,
  categories: readonly string[],
  fallback: number,
): number {
  const hay = `${name} ${categories.join(" ")}`;
  for (const [re, idx] of ACCENT_KEYWORDS) if (re.test(hay)) return idx;
  return (
    ((fallback % ACCENT_SLOT_COUNT) + ACCENT_SLOT_COUNT) % ACCENT_SLOT_COUNT
  );
}

/** id → accent slot for a class list (category-keyed, position fallback). */
export function accentIndexMap(
  classes: ReadonlyArray<{
    id: string;
    name: string;
    categories?: ReadonlyArray<{ name: string }> | null;
  }>,
): Map<string, number> {
  const m = new Map<string, number>();
  classes.forEach((c, i) =>
    m.set(
      c.id,
      classAccentIndex(
        c.name,
        (c.categories ?? []).map((x) => x.name),
        i,
      ),
    ),
  );
  return m;
}

// Photo-tint gradient stops: solid color behind the title fading so the photo
// shows below (178deg, rgba(base,.9) 0% → rgba(base,.5) 46% → rgba(dark,.4) 100%).
export function accentTint(a: ClassAccent): [string, string, string] {
  return [`rgba(${a.base},0.9)`, `rgba(${a.base},0.5)`, `rgba(${a.dark},0.4)`];
}
export const ACCENT_TINT_LOCATIONS: [number, number, number] = [0, 0.46, 1];
