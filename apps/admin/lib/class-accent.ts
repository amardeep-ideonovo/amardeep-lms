// Ink Hero class accent slots are NAMED after content categories (tokens.css:
// 0 music amber · 1 cooking purple · 2 photography green · 3 film red ·
// 4 dance blue · 5 comedy sea). Classes pick their slot by name keywords —
// the class list is alphabetical, so a pure position cycle scrambles the
// intended per-class colors. Unmatched names fall back to the position cycle.
// Comedy is matched before film so "Stand-Up Comedy" lands on sea, not red.
const ACCENT_KEYWORDS: Array<[RegExp, number]> = [
  [/comedy|stand.?up/i, 5],
  [/music|song/i, 0],
  [/cook|food|culinary|kitchen|flavor/i, 1],
  [/photo/i, 2],
  [/film|cinema|screen|tv/i, 3],
  [/dance|choreo/i, 4],
];

export function classAccentIndex(name: string, fallback: number): number {
  for (const [re, idx] of ACCENT_KEYWORDS) if (re.test(name)) return idx;
  return ((fallback % 6) + 6) % 6;
}
