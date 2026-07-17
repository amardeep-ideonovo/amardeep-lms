// Minimal dependency-free PNG writer + raster canvas.
//
// Exists so the demo artwork in assets/demo/ can be regenerated from source
// (see generate-demo-art.ts) without pulling an image library into @lms/db,
// whose dependency list is deliberately tiny (it runs inside every provisioned
// instance's api container at boot). Node's zlib does the only hard part.
//
// Truecolor (8-bit RGB, no alpha) — the artwork is opaque, and dropping the
// alpha channel costs nothing and shrinks the output by a quarter.
//
// Deliberately Buffer-free: this package's ts-node runs TypeScript 5.9 while the
// repo root is on 5.5, and 5.7+ made Buffer (Uint8Array<ArrayBufferLike>) stop
// being assignable to a plain Uint8Array. Sticking to Uint8Array compiles
// identically under both.
import * as zlib from "zlib";

// ---------- byte helpers ----------

const ascii = (s: string): Uint8Array =>
  Uint8Array.from(s, (ch) => ch.charCodeAt(0));

/** Big-endian uint32. */
function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------- PNG encoding ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([ascii(type), data]); // CRC covers type + data
  return concat([u32(data.length), body, u32(crc32(body))]);
}

// Per-scanline filtering. A flat filter-0 encode of a smooth gradient is huge;
// picking the cheapest of None/Sub/Up per row (the sum-of-absolute-differences
// heuristic from the PNG spec's own guidance) typically cuts these files by 5-10x.
function filterScanlines(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 3;
  const out = new Uint8Array((stride + 1) * h);
  const sub = new Uint8Array(stride);
  const up = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;

    let sumNone = 0;
    let sumSub = 0;
    let sumUp = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3] : 0; // byte to the left (same channel)
      const b = prev ? prev[i] : 0;
      sub[i] = (row[i] - a) & 0xff;
      up[i] = (row[i] - b) & 0xff;
      // Signed magnitude — filtered bytes near 0 (or 255) compress best.
      sumNone += row[i] < 128 ? row[i] : 256 - row[i];
      sumSub += sub[i] < 128 ? sub[i] : 256 - sub[i];
      sumUp += up[i] < 128 ? up[i] : 256 - up[i];
    }

    const o = y * (stride + 1);
    if (sumSub <= sumNone && sumSub <= sumUp) {
      out[o] = 1;
      out.set(sub, o + 1);
    } else if (sumUp <= sumNone) {
      out[o] = 2;
      out.set(up, o + 1);
    } else {
      out[o] = 0;
      out.set(row, o + 1);
    }
  }
  return out;
}

export function encodePng(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = concat([
    u32(w),
    u32(h),
    new Uint8Array([
      8, // bit depth
      2, // color type 2 = truecolor RGB
      0, // deflate
      0, // adaptive filtering
      0, // no interlace
    ]),
  ]);
  const idat = new Uint8Array(zlib.deflateSync(filterScanlines(rgb, w, h), { level: 9 }));
  return concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ---------- color ----------

export type RGB = [number, number, number];

export function hex(s: string): RGB {
  const v = s.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

const clamp = (n: number, lo = 0, hi = 255) => (n < lo ? lo : n > hi ? hi : n);
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// smoothstep — soft, band-free falloff for glows and gradient stops.
export const smooth = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

// ---------- deterministic pseudo-randomness ----------
// Art must be byte-identical across regenerations, so nothing may reach for
// Math.random(). A string key seeds a small xorshift instead.

export function hashKey(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ---------- canvas ----------
// Float RGB accumulation buffer; every draw op composites with an alpha and is
// clipped to the canvas. Kept intentionally small — enough primitives for
// abstract geometric artwork, nothing more.

export class Canvas {
  readonly w: number;
  readonly h: number;
  private readonly px: Float64Array; // w*h*3

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Float64Array(w * h * 3);
  }

  /** Composite `c` at (x,y) with coverage/alpha `a`. Out-of-bounds is a no-op. */
  blend(x: number, y: number, c: RGB, a: number): void {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const t = a > 1 ? 1 : a;
    const i = (y * this.w + x) * 3;
    this.px[i] += (c[0] - this.px[i]) * t;
    this.px[i + 1] += (c[1] - this.px[i + 1]) * t;
    this.px[i + 2] += (c[2] - this.px[i + 2]) * t;
  }

  fill(c: RGB): void {
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
    }
  }

  /** Linear gradient across the canvas. `angle` in radians, 0 = left→right. */
  linear(angle: number, from: RGB, to: RGB): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Project every corner to normalise t into [0,1] whatever the angle.
    const projs = [0, this.w].flatMap((x) => [0, this.h].map((y) => x * dx + y * dy));
    const lo = Math.min(...projs);
    const hi = Math.max(...projs);
    const span = hi - lo || 1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const t = (x * dx + y * dy - lo) / span;
        this.blend(x, y, mix(from, to, smooth(t)), 1);
      }
    }
  }

  /** Soft radial glow — the workhorse for the artwork's depth. */
  glow(cx: number, cy: number, radius: number, c: RGB, intensity = 1): void {
    const r0 = Math.max(0, Math.floor(cy - radius));
    const r1 = Math.min(this.h - 1, Math.ceil(cy + radius));
    const c0 = Math.max(0, Math.floor(cx - radius));
    const c1 = Math.min(this.w - 1, Math.ceil(cx + radius));
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        if (d >= 1) continue;
        this.blend(x, y, c, smooth(1 - d) * intensity);
      }
    }
  }

  /** Anti-aliased disc. */
  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    const r0 = Math.max(0, Math.floor(cy - r - 1));
    const r1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    const c0 = Math.max(0, Math.floor(cx - r - 1));
    const c1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const cov = clamp(r - d + 0.5, 0, 1); // 1px AA band at the edge
        if (cov > 0) this.blend(x, y, c, cov * a);
      }
    }
  }

  /** Anti-aliased ring (stroked circle) of the given thickness. */
  ring(cx: number, cy: number, r: number, thickness: number, c: RGB, a = 1): void {
    const outer = r + thickness / 2;
    const r0 = Math.max(0, Math.floor(cy - outer - 1));
    const r1 = Math.min(this.h - 1, Math.ceil(cy + outer + 1));
    const c0 = Math.max(0, Math.floor(cx - outer - 1));
    const c1 = Math.min(this.w - 1, Math.ceil(cx + outer + 1));
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
        const cov = clamp(thickness / 2 - d + 0.5, 0, 1);
        if (cov > 0) this.blend(x, y, c, cov * a);
      }
    }
  }

  /** Axis-aligned rounded rect (radius 0 = square corners). */
  roundRect(x: number, y: number, w: number, h: number, radius: number, c: RGB, a = 1): void {
    const r = Math.min(radius, w / 2, h / 2);
    for (let py = Math.max(0, Math.floor(y)); py <= Math.min(this.h - 1, Math.ceil(y + h)); py++) {
      for (let px = Math.max(0, Math.floor(x)); px <= Math.min(this.w - 1, Math.ceil(x + w)); px++) {
        // Distance to the rounded-rect boundary, via the inset-corner trick.
        const qx = Math.max(x + r - px, 0, px - (x + w - r));
        const qy = Math.max(y + r - py, 0, py - (y + h - r));
        const d = Math.hypot(qx, qy) - r;
        const cov = clamp(0.5 - d, 0, 1);
        if (cov > 0) this.blend(px, py, c, cov * a);
      }
    }
  }

  /** Thick line segment with round caps. */
  line(x0: number, y0: number, x1: number, y1: number, thickness: number, c: RGB, a = 1): void {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - thickness));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + thickness));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - thickness));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + thickness));
    const vx = x1 - x0;
    const vy = y1 - y0;
    const len2 = vx * vx + vy * vy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // Distance from the pixel to the segment.
        let t = ((x - x0) * vx + (y - y0) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy));
        const cov = clamp(thickness / 2 - d + 0.5, 0, 1);
        if (cov > 0) this.blend(x, y, c, cov * a);
      }
    }
  }

  /** Darken the edges — stops the flat panels reading as clip-art. */
  vignette(strength = 0.35): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const max = Math.hypot(cx, cy);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d = Math.hypot(x - cx, y - cy) / max;
        this.blend(x, y, [0, 0, 0], smooth((d - 0.45) / 0.55) * strength);
      }
    }
  }

  toPng(): Uint8Array {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < out.length; i++) out[i] = clamp(Math.round(this.px[i]));
    return encodePng(out, this.w, this.h);
  }
}
