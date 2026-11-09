/**
 * Seed and colour helpers for generated figures (see compose.ts). Colours are
 * 6-digit lower-case hex strings without '#', as the layers are read.
 */

/** FNV-1a over the UTF-8 bytes. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(s, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small seeded PRNG: the same seed always gives the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A session name as a seed: case, surrounding space and Unicode form don't matter. */
export function normalizeSeed(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

export function seededRandom(name: string): () => number {
  return mulberry32(fnv1a(normalizeSeed(name)));
}

export const hex = (r: number, g: number, b: number): string =>
  [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
export const unhex = (h: string): [number, number, number] => [
  parseInt(h.slice(0, 2), 16),
  parseInt(h.slice(2, 4), 16),
  parseInt(h.slice(4, 6), 16),
];
export const lum = (h: string): number => {
  const [r, g, b] = unhex(h);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round) as [number, number, number];
}

/** HSL saturation (0-1) of a colour. */
export function saturation(h: string): number {
  return rgb2hsl(...unhex(h))[1];
}

/** Rotate a colour's hue; greys (saturation <= 0.08) stay as they are. */
export function shiftHex(h: string, hue: number): string {
  if (!hue) return h;
  const [r, g, b] = unhex(h);
  const [hh, s, l] = rgb2hsl(r, g, b);
  if (s <= 0.08) return h;
  return hex(...hsl2rgb((hh + hue) % 360, s, l));
}

export function lerpHex(a: string, b: string, t: number): string {
  const A = unhex(a);
  const B = unhex(b);
  return hex(...(A.map((v, i) => Math.round(v + (B[i] - v) * t)) as [number, number, number]));
}
