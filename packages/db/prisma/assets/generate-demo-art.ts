// Regenerates the demo catalog's artwork into assets/demo/*.png.
//
//   npm run -w @lms/db art
//
// WHY THIS EXISTS: the demo instance is shown to prospective clients, so none of
// its content may reference a real person, a real brand, or another platform's
// media. The catalog art used to hotlink masterclass.com course images and
// picsum.photos (which serves real photographers' work), so it was replaced with
// original abstract artwork generated here and served from the instance's own
// /media route. Nothing depicts anything real; nothing leaves the box.
//
// The output is committed (assets/demo/) rather than generated at seed time:
// every provisioned client instance re-runs the seed on each container start,
// and none of them should pay to redraw artwork they may not even ship. It also
// keeps the art reviewable in a diff.
//
// Deterministic by construction — the same key always yields the same bytes, so
// a regeneration is a no-op in git unless the art actually changed.
import * as fs from "fs";
import * as path from "path";
import { Canvas, hashKey, hex, mix, rng, smooth, type RGB } from "./png";

const OUT_DIR = path.join(__dirname, "demo");

// Ink Hero base (see apps/web/app/globals.css). Artwork sits under a colored
// scrim on the class cards, so it stays dark and low-contrast on purpose.
const INK_DEEP = hex("#171232");
const INK = hex("#2a2350");
const TEAL = hex("#3cc4b2");
const WHITE = hex("#ffffff");

// One accent per demo class, matching the accent slot each class resolves to
// (music amber · food purple · sports green · technology blue).
type Theme = "music" | "food" | "technology" | "sports" | "general";
const ACCENT: Record<Theme, RGB> = {
  music: hex("#f7a01e"),
  food: hex("#9046c8"),
  technology: hex("#4a76d0"),
  sports: hex("#43a565"),
  general: hex("#3cc4b2"),
};

// ---------- motifs ----------
// Each theme draws one abstract geometric figure. They evoke the subject
// (a waveform, a plate, a network, a track) without depicting anything real.

function motifMusic(c: Canvas, accent: RGB, r: () => number): void {
  // Equalizer bars along the lower third, heights on a smooth wave so the
  // silhouette reads as sound rather than a random bar chart.
  const bars = 26;
  const gap = c.w / bars;
  const baseY = c.h * 0.82;
  const phase = r() * Math.PI * 2;
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const env = Math.sin(phase + t * Math.PI * 3) * 0.5 + 0.5;
    const hgt = c.h * (0.06 + env * 0.3 * (0.6 + r() * 0.4));
    const x = gap * (i + 0.5);
    const col = mix(accent, WHITE, 0.15 + env * 0.25);
    c.roundRect(x - gap * 0.22, baseY - hgt, gap * 0.44, hgt, gap * 0.22, col, 0.5);
  }
  // Concentric rings behind, like a speaker cone.
  const cx = c.w * 0.24;
  const cy = c.h * 0.36;
  for (let i = 0; i < 4; i++) {
    c.ring(cx, cy, c.h * (0.1 + i * 0.09), 2, mix(accent, WHITE, 0.3), 0.16 - i * 0.025);
  }
}

function motifFood(c: Canvas, accent: RGB, r: () => number): void {
  // Offset plate rings + scattered dots — a table read from above.
  const cx = c.w * (0.62 + r() * 0.12);
  const cy = c.h * (0.46 + r() * 0.1);
  const base = Math.min(c.w, c.h) * 0.34;
  for (let i = 0; i < 5; i++) {
    c.ring(cx, cy, base * (0.42 + i * 0.17), i === 2 ? 3 : 1.6, mix(accent, WHITE, 0.35), 0.3 - i * 0.04);
  }
  c.disc(cx, cy, base * 0.3, mix(accent, WHITE, 0.1), 0.22);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    const d = base * (0.55 + r() * 0.85);
    c.disc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 3 + r() * 7, mix(accent, WHITE, 0.5), 0.2 + r() * 0.2);
  }
}

function motifTechnology(c: Canvas, accent: RGB, r: () => number): void {
  // Node graph: points on a jittered lattice, each wired to its near neighbours.
  const cols = 7;
  const rows = 4;
  const pts: Array<[number, number]> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      pts.push([
        (c.w / (cols + 1)) * (x + 1) + (r() - 0.5) * c.w * 0.05,
        (c.h / (rows + 1)) * (y + 1) + (r() - 0.5) * c.h * 0.07,
      ]);
    }
  }
  const near = Math.max(c.w / cols, c.h / rows) * 1.15;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > near) continue;
      c.line(pts[i][0], pts[i][1], pts[j][0], pts[j][1], 1.2, mix(accent, WHITE, 0.35), 0.16 * (1 - d / near));
    }
  }
  for (const [x, y] of pts) {
    const big = r() > 0.78;
    c.disc(x, y, big ? 6 : 3, mix(accent, WHITE, big ? 0.6 : 0.3), big ? 0.6 : 0.3);
  }
}

function motifSports(c: Canvas, accent: RGB, r: () => number): void {
  // Track arcs + diagonal motion streaks.
  const cx = c.w * 0.72;
  const cy = c.h * 1.05;
  for (let i = 0; i < 4; i++) {
    c.ring(cx, cy, c.h * (0.45 + i * 0.16), 3, mix(accent, WHITE, 0.3), 0.22 - i * 0.035);
  }
  const streaks = 7;
  for (let i = 0; i < streaks; i++) {
    const y = c.h * (0.12 + (i / streaks) * 0.7) + (r() - 0.5) * 20;
    const len = c.w * (0.16 + r() * 0.3);
    const x = c.w * (0.04 + r() * 0.22);
    c.line(x, y, x + len, y - len * 0.34, 5 + r() * 5, mix(accent, WHITE, 0.4), 0.14 + r() * 0.12);
  }
}

function motifGeneral(c: Canvas, accent: RGB, r: () => number): void {
  // Neutral dot lattice for platform/announcement art with no subject.
  const step = Math.max(26, c.w / 30);
  for (let y = step; y < c.h; y += step) {
    for (let x = step; x < c.w; x += step) {
      const t = smooth(1 - Math.hypot(x - c.w * 0.7, y - c.h * 0.4) / (c.w * 0.7));
      c.disc(x, y, 1.6 + t * 2.4, mix(accent, WHITE, 0.4), 0.08 + t * 0.3);
    }
  }
  for (let i = 0; i < 3; i++) {
    c.ring(c.w * 0.7, c.h * 0.4, c.h * (0.2 + i * 0.16), 2, mix(accent, WHITE, 0.3), 0.14 - i * 0.03);
  }
}

const MOTIF: Record<Theme, (c: Canvas, a: RGB, r: () => number) => void> = {
  music: motifMusic,
  food: motifFood,
  technology: motifTechnology,
  sports: motifSports,
  general: motifGeneral,
};

// ---------- composition ----------

function panel(theme: Theme, variant: number, w: number, h: number): Canvas {
  const key = `${theme}-${variant}`;
  const r = rng(hashKey(key));
  const accent = ACCENT[theme];
  const c = new Canvas(w, h);

  // 1. Ink base, angled so no two variants share a gradient direction.
  c.linear(Math.PI * (0.15 + variant * 0.17), INK_DEEP, INK);

  // 2. Accent glow — the variant moves it around the frame.
  const gx = w * (0.2 + ((variant * 0.23 + r() * 0.1) % 0.62));
  const gy = h * (0.2 + ((variant * 0.31 + r() * 0.1) % 0.6));
  c.glow(gx, gy, Math.max(w, h) * 0.62, accent, 0.5);
  c.glow(gx, gy, Math.max(w, h) * 0.26, mix(accent, WHITE, 0.25), 0.28);

  // 3. Teal counter-glow in the opposite corner for depth.
  c.glow(w - gx, h - gy, Math.max(w, h) * 0.45, TEAL, 0.16);

  // 4. Subject motif.
  MOTIF[theme](c, accent, r);

  // 5. Settle it back toward ink so overlaid text stays legible, then vignette.
  c.vignette(0.4);
  return c;
}

function avatar(key: string, size: number): Canvas {
  // Abstract identicon — deliberately NOT a face. The testimonial block used to
  // pull a picsum photo, i.e. a photograph of a real, identifiable person.
  const r = rng(hashKey(key));
  const themes = Object.keys(ACCENT) as Theme[];
  const accent = ACCENT[themes[Math.floor(r() * themes.length)]];
  const c = new Canvas(size, size);
  c.linear(Math.PI * 0.25, mix(INK_DEEP, accent, 0.25), mix(INK, accent, 0.6));
  c.glow(size * 0.3, size * 0.28, size * 0.75, mix(accent, WHITE, 0.3), 0.4);

  // Vertically mirrored block pattern — reads as a generated avatar.
  const cells = 5;
  const cell = size / (cells + 2);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < Math.ceil(cells / 2); x++) {
      if (r() > 0.5) continue;
      const col = mix(WHITE, accent, r() * 0.35);
      const px = cell * (1 + x);
      const py = cell * (1 + y);
      c.roundRect(px, py, cell, cell, cell * 0.3, col, 0.5);
      const mirrorX = cell * (1 + (cells - 1 - x));
      if (mirrorX !== px) c.roundRect(mirrorX, py, cell, cell, cell * 0.3, col, 0.5);
    }
  }
  c.vignette(0.25);
  return c;
}

// ---------- main ----------

function write(name: string, c: Canvas): void {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, c.toPng());
  console.log(`  ${name}  ${c.w}×${c.h}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Generating demo artwork →", OUT_DIR);

  // Class/course/lesson/skill art. Five variants per theme; the seed rotates
  // through them so a class's surfaces share a palette without repeating.
  for (const theme of ["music", "food", "technology", "sports"] as const) {
    for (let v = 0; v < 5; v++) write(`demo-${theme}-${v}.png`, panel(theme, v, 1200, 675));
  }
  // Subject-free art for platform announcements and the QA fixture courses.
  for (let v = 0; v < 2; v++) write(`demo-general-${v}.png`, panel("general", v, 1200, 675));

  // 0 = the About page's testimonial, 1 = the demo member's profile photo.
  for (let v = 0; v < 2; v++) write(`demo-avatar-${v}.png`, avatar(`avatar-${v}`, 240));

  console.log("Done.");
}

main();
