// Ink Hero class accent slots (0 amber · 1 violet · 2 green · 3 red · 4 blue ·
// 5 sea). Classes pick their slot by name keyword — the class list is
// alphabetical, so a pure position cycle scrambles the colors whenever a class
// is added or renamed. Unmatched names fall back to the position cycle.
//
// Order matters — first match wins. Unlike the web/mobile copies this only
// gets the class NAME (no categories), so the keywords must hit the name
// itself. Comedy precedes film so "Stand-Up Comedy" lands on sea, not red.
//
// Keep in sync with apps/web/lib/memberData.ts and
// apps/mobile/src/class-colors.ts — three copies, no shared package.
const ACCENT_KEYWORDS: Array<[RegExp, number]> = [
  [/music|song/i, 0],
  [/cook|food|culinary|kitchen|flavor|baking/i, 1],
  [/sport|fitness|athlet|strength|conditioning/i, 2],
  [/technolog|software|coding|web develop|developer|programming/i, 4],
  [/comedy|stand.?up/i, 5],
  [/photo/i, 2],
  [/film|cinema|screen|tv/i, 3],
  [/dance|choreo/i, 4],
];

export function classAccentIndex(name: string, fallback: number): number {
  for (const [re, idx] of ACCENT_KEYWORDS) if (re.test(name)) return idx;
  return ((fallback % 6) + 6) % 6;
}
