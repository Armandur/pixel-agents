import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { hex, lerpHex, lum, saturation, seededRandom, shiftHex, unhex } from './color.js';

/**
 * Generated figures: a session name seeds a character composed from the
 * Metro City layers (CC0, assets/figures/metrocity) in the office's 112x96
 * format (7 frames x 3 directions of 16x32).
 *
 * Walk frames (0-2) are Metro City's own layers. The sitting typing/reading
 * frames (3-6) come from the office's char_5: its body in those poses is
 * recoloured role by role (skin, shirt, pants, shoes) from the figure's
 * outfit, its head is replaced by the figure's (skin, hair or hat), and its
 * reading glasses are kept. Only clothes take a hue shift; skin and hair keep
 * their natural colours.
 */

type Cell = Array<string | null>;
interface Layer {
  img: PNG;
  row: number;
  hat: boolean;
}
export interface FigureLayers {
  body: PNG;
  donor: PNG;
  hairs: Layer[];
  outfits: Layer[];
  skinMaps: Array<Record<string, string>>;
  bodyCols: Set<string>;
  /** Per hair layer: each colour's step (0 dark … 3 light) on a hair tone ramp. */
  hairLevels: Array<Record<string, number>>;
}
interface Traits {
  skin: number;
  outfit: number;
  hair: number;
  outfitHue: number;
  hairTone: number;
  fabric: number;
}
interface Ramps {
  shirt: string[];
  pants: string[];
  shoes: string[] | null;
}

const CELL = 32;
const CROP_X = 8;
const OW = 16;
const OH = 32;
/** Metro City column of each office direction (0 down, 1 up, 2 right). */
const DIR_BASE: Record<number, number> = { 0: 0, 1: 12, 2: 6 };
const WALK = [1, 0, 4];
/** The Metro City column matching the office's standing walk2 frame. */
const STAND = 0;
/** Head/body split in the standing frame, per direction. */
const SPLIT_STAND: Record<number, number> = { 0: 18, 1: 18, 2: 19 };

/** Colour roles in char_5, the pose donor. */
const ROLE: Record<string, string> = {};
const setRole = (role: string, list: string[]) => list.forEach((h) => (ROLE[h] = role));
setRole('hair', ['0e0e0e', '202020', '373737', '303030', '414141', '282828', '131313']);
setRole('skin', [
  'fcd6c4',
  'ffede5',
  'cf9d86',
  'e1aa91',
  'fff6f2',
  'ffe0d2',
  'c1a496',
  'ba917e',
  'b0886c',
  'cab3a9',
  'b48d7c',
  'e1ad95',
  '705e56',
  '594b45',
  '595959',
  '4f4f4f',
  '7b6860',
  'ad8572',
]);
setRole('shirt', ['640026', '9f3f31', 'b24737', 'e16451']);
setRole('pants', ['0f0c13', '1d1718', '2a2320', '332c23']);
setRole('paper', ['391624', 'e1e3e9']);
setRole('lens', ['000000', '191919', 'ffffff', 'd0d0d0', 'fff2ec']);
const SHIRT_LV: Record<string, number> = { '640026': 0, '9f3f31': 1, b24737: 2, e16451: 3 };
const PANTS_LV: Record<string, number> = { '0f0c13': 0, '1d1718': 1, '2a2320': 2, '332c23': 3 };

const read = (file: string) => PNG.sync.read(fs.readFileSync(file));

/**
 * Natural hair tones, dark → light, one picked per seed. A hair layer's own
 * shades are mapped onto the tone by brightness, so its shading survives;
 * near-black outline pixels are kept as drawn.
 */
const HAIR_TONES: string[][] = [
  ['1a1414', '2b2222', '3d3030', '524444'], // black
  ['2e1c12', '4a2e1c', '64402a', '7e5638'], // dark brown
  ['4a2c18', '6e4426', '8f5c36', 'ad7a4c'], // brown
  ['5a2416', '82361e', 'a54b28', 'c2683a'], // auburn
  ['7a2e14', 'a8461c', 'cc6428', 'e4884a'], // ginger
  ['6e5228', '927036', 'b38f4c', 'cfae6a'], // dark blonde
  ['8f7038', 'b8964c', 'd8b866', 'eed88e'], // blonde
  ['4f4f55', '75757c', '9c9ca3', 'c4c4ca'], // grey
  ['8e8e96', 'b4b4bc', 'd6d6dc', 'f0f0f4'], // white
];
/**
 * Fabrics for an outfit's white and light-grey cloth (which a hue shift
 * cannot colour), dark → light; null keeps the cloth white. Saturated cloth
 * keeps the seed's hue shift instead.
 */
const FABRICS: Array<string[] | null> = [
  ['1f2a4a', '2c3c66', '3d5288', '5670a8'], // navy
  ['1e3a26', '2b5236', '3c6e48', '58905f'], // forest
  ['4a1622', '66202f', '86303f', 'a84a58'], // burgundy
  ['7a5a14', '9c761e', 'bf952e', 'd9b24a'], // mustard
  ['14464a', '1e6066', '2c7e84', '46a0a4'], // teal
  ['36204e', '4a2e6a', '62408a', '7e5ca8'], // purple
  ['4a4a1e', '62622a', '7c7c3a', '9a9a52'], // olive
  ['3a6a96', '4e86b4', '6aa2cc', '90c0e2'], // sky
  ['8a3a5a', 'a84c70', 'c4688a', 'dc8ca8'], // rose
  ['2a2a30', '3a3a42', '4e4e58', '66666f'], // charcoal
  null, // white
  null,
];
/** Greyer and lighter than these is "white cloth" that takes the fabric. */
const PALE_SATURATION = 0.12;
const PALE_LUM = 120;

function clothColor(t: Traits, h: string): string {
  const fabric = FABRICS[t.fabric];
  if (fabric && saturation(h) <= PALE_SATURATION && lum(h) >= PALE_LUM) {
    const step = Math.min(3, Math.max(0, Math.round(((lum(h) - PALE_LUM) / (255 - PALE_LUM)) * 3)));
    return fabric[step];
  }
  return shiftHex(h, t.outfitHue);
}

/** Darker than this (luminance) is outline, not hair colour. */
const HAIR_OUTLINE_LUM = 40;

/** Rank a hair layer's colours by brightness into the 4 steps of a tone. */
function hairLevelsOf(layer: Layer): Record<string, number> {
  const colors = new Set<string>();
  for (let col = 0; col < 24; col++) {
    for (const h of metroCell(layer.img, layer.row, col)) {
      if (h && lum(h) >= HAIR_OUTLINE_LUM) colors.add(h);
    }
  }
  const sorted = [...colors].sort((a, b) => lum(a) - lum(b));
  const levels: Record<string, number> = {};
  sorted.forEach((h, i) => {
    levels[h] = sorted.length === 1 ? 2 : Math.round((i / (sorted.length - 1)) * 3);
  });
  return levels;
}

function toneHair(layers: FigureLayers, t: Traits, h: string): string {
  const level = layers.hairLevels[t.hair][h];
  return level === undefined ? h : HAIR_TONES[t.hairTone][level];
}

/** Load the layers once; null when the figure assets are missing. */
export function loadFigureLayers(assetsRoot: string): FigureLayers | null {
  const dir = path.join(assetsRoot, 'assets', 'figures', 'metrocity');
  const donorFile = path.join(assetsRoot, 'assets', 'characters', 'char_5.png');
  if (!fs.existsSync(path.join(dir, 'body.png')) || !fs.existsSync(donorFile)) return null;
  const f = (n: string) => read(path.join(dir, n));
  const body = f('body.png');
  const hairs1 = f('hairs.png');
  const hairs2 = f('hairs2.png');
  const suit = f('suit.png');
  const suit1 = f('suit1.png');
  const hairs: Layer[] = [
    ...Array.from({ length: 8 }, (_, r) => ({ img: hairs1, row: r, hat: false })),
    ...[0, 2, 3, 4].map((r) => ({ img: hairs2, row: r, hat: false })), // row 1 is eyebrows
  ];
  const outfits: Layer[] = [
    ...[1, 2, 4, 5, 6].map((n) => ({ img: f(`outfit${n}.png`), row: 0, hat: false })),
    ...[0, 1, 2, 3].map((r) => ({ img: suit, row: r, hat: r !== 2 })),
    ...[0, 1, 2, 3, 4].map((r) => ({ img: suit1, row: r, hat: false })),
  ];
  return {
    body,
    donor: read(donorFile),
    hairs,
    outfits,
    ...skinTables(body),
    hairLevels: hairs.map(hairLevelsOf),
  };
}

/** Skin: char_5's skin is Metro City row 1, so map row 1 → row r pixel by pixel. */
function skinTables(body: PNG) {
  const skinMaps: Array<Record<string, string>> = [];
  for (let r = 0; r < 6; r++) {
    const votes: Record<string, Record<string, number>> = {};
    for (let col = 0; col < 24; col++) {
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const ka = ((CELL + y) * body.width + col * CELL + x) * 4;
          const kb = ((r * CELL + y) * body.width + col * CELL + x) * 4;
          if (body.data[ka + 3] < 2 || body.data[kb + 3] < 2) continue;
          const a = hex(body.data[ka], body.data[ka + 1], body.data[ka + 2]);
          const b = hex(body.data[kb], body.data[kb + 1], body.data[kb + 2]);
          (votes[a] ??= {})[b] = (votes[a][b] ?? 0) + 1;
        }
      }
    }
    const m: Record<string, string> = {};
    for (const [a, vs] of Object.entries(votes)) {
      m[a] = Object.entries(vs).sort((p, q) => q[1] - p[1])[0][0];
    }
    skinMaps.push(m);
  }
  const bodyCols = new Set<string>();
  for (let i = 0; i < body.data.length; i += 4) {
    if (body.data[i + 3] >= 2) bodyCols.add(hex(body.data[i], body.data[i + 1], body.data[i + 2]));
  }
  return { skinMaps, bodyCols };
}

function traitsFor(layers: FigureLayers, seed: string): Traits {
  const rnd = seededRandom(seed);
  const pick = (n: number) => Math.floor(rnd() * n);
  return {
    skin: pick(6),
    outfit: pick(layers.outfits.length),
    hair: pick(layers.hairs.length),
    outfitHue: pick(12) * 30,
    // Drawn last, so the earlier traits of every seed stay as they were.
    hairTone: pick(HAIR_TONES.length),
    fabric: pick(FABRICS.length),
  };
}

function metroCell(img: PNG, row: number, col: number): Cell {
  const c: Cell = new Array(OW * OH).fill(null);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const k = ((row * CELL + y) * img.width + col * CELL + CROP_X + x) * 4;
      if (img.data[k + 3] >= 2) c[y * OW + x] = hex(img.data[k], img.data[k + 1], img.data[k + 2]);
    }
  }
  return c;
}

function donorCell(donor: PNG, d: number, f: number): Cell {
  const c: Cell = new Array(OW * OH).fill(null);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const k = ((d * OH + y) * donor.width + f * OW + x) * 4;
      if (donor.data[k + 3] >= 2) {
        c[y * OW + x] = hex(donor.data[k], donor.data[k + 1], donor.data[k + 2]);
      }
    }
  }
  return c;
}

const firstRow = (c: Cell) => {
  for (let i = 0; i < c.length; i++) if (c[i]) return (i / OW) | 0;
  return 0;
};
const lastRow = (c: Cell) => {
  for (let i = c.length - 1; i >= 0; i--) if (c[i]) return (i / OW) | 0;
  return 0;
};

function mapSkin(layers: FigureLayers, r: number, h: string): string {
  const m = layers.skinMaps[r];
  if (m[h]) return m[h];
  const near = Object.keys(m).sort(
    (a, b) => Math.abs(lum(a) - lum(h)) - Math.abs(lum(b) - lum(h)),
  )[0];
  return m[near];
}

/** Clothing colours (not skin) in rows y0..y1 of the cells, dark to light. */
function colorsIn(layers: FigureLayers, cells: Cell[], y0: number, y1: number, min: number) {
  const m: Record<string, number> = {};
  for (const c of cells) {
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < OW; x++) {
        const h = c[y * OW + x];
        if (h && !layers.bodyCols.has(h)) m[h] = (m[h] ?? 0) + 1;
      }
    }
  }
  return Object.entries(m)
    .filter(([, n]) => n >= min)
    .map(([h]) => h)
    .sort((a, b) => lum(a) - lum(b));
}

/** A 4-step ramp (dark → light) from a sorted list; fewer colours are interpolated. */
function ramp4(list: string[]): string[] | null {
  if (list.length === 0) return null;
  if (list.length === 1) {
    return [
      lerpHex(list[0], '000000', 0.45),
      lerpHex(list[0], '000000', 0.2),
      list[0],
      lerpHex(list[0], 'ffffff', 0.25),
    ];
  }
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const p = (i / 3) * (list.length - 1);
    const lo = Math.floor(p);
    const hi = Math.ceil(p);
    out.push(lo === hi ? list[lo] : lerpHex(list[lo], list[hi], p - lo));
  }
  return out;
}

function outfitRamps(layers: FigureLayers, o: Layer, t: Traits): Ramps {
  const stand = [0, 1, 2].map((d) => metroCell(o.img, o.row, DIR_BASE[d] + STAND));
  const torso = colorsIn(layers, stand, 18, 23, 3);
  const torsoSet = new Set(torso);
  const legsOnly = colorsIn(layers, stand, 24, 28, 2).filter((h) => !torsoSet.has(h));
  const feet = colorsIn(layers, stand, 29, 31, 2);
  const sh = (l: string[]) => l.map((h) => clothColor(t, h)).sort((a, b) => lum(a) - lum(b));
  const shirt = ramp4(sh(torso))!;
  return {
    shirt,
    pants: legsOnly.length >= 2 ? ramp4(sh(legsOnly))! : shirt, // dress or long shirt: one cloth
    shoes: feet.length ? sh(feet) : null,
  };
}

/** The donor's sitting frame f (3-6) facing d, in the figure's colours and head. */
function posedCell(layers: FigureLayers, d: number, f: number, t: Traits, ramps: Ramps): Cell {
  const o = layers.outfits[t.outfit];
  const Dc = donorCell(layers.donor, d, f);
  const Ds = donorCell(layers.donor, d, 1);
  const dyh = firstRow(Dc) - firstRow(Ds);
  const split = SPLIT_STAND[d] + dyh;
  const out: Cell = new Array(OW * OH).fill(null);
  const put = (x: number, y: number, h: string | null | undefined) => {
    if (x >= 0 && x < OW && y >= 0 && y < OH && h) out[y * OW + x] = h;
  };
  const ymax = lastRow(Dc);
  const footFrom = ymax >= 28 ? ymax - (d === 2 ? 2 : 1) : 99;

  // 1. Body: the donor's pixels below the split, plus clothes and paper anywhere.
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const h = Dc[y * OW + x];
      if (!h) continue;
      const role = ROLE[h];
      if (role === 'shirt') put(x, y, ramps.shirt[SHIRT_LV[h]]);
      else if (role === 'pants') put(x, y, ramps.pants[PANTS_LV[h]]);
      else if (role === 'paper') put(x, y, h);
      else if (role === 'lens' && (y >= split || x >= 13) && h !== '000000') put(x, y, h);
      else if (role === 'skin' && y >= split) {
        if (y >= footFrom && ramps.shoes) {
          put(
            x,
            y,
            ramps.shoes[
              Math.min(ramps.shoes.length - 1, lum(h) > 120 ? ramps.shoes.length - 1 : 0)
            ],
          );
        } else put(x, y, mapSkin(layers, t.skin, h));
      }
    }
  }
  // 2. Head: the figure's skin in the standing frame, shifted like the donor's head.
  const hs = metroCell(layers.body, t.skin, DIR_BASE[d] + STAND);
  for (let y = 0; y < SPLIT_STAND[d]; y++)
    for (let x = 0; x < OW; x++) put(x, y + dyh, hs[y * OW + x]);
  // 3. Hat or hair (hair is drawn over the shoulders, as in Metro City's own layering).
  if (o.hat) {
    const oc = metroCell(o.img, o.row, DIR_BASE[d] + STAND);
    for (let y = 0; y < SPLIT_STAND[d]; y++) {
      for (let x = 0; x < OW; x++) {
        const h = oc[y * OW + x];
        put(x, y + dyh, h && shiftHex(h, t.outfitHue));
      }
    }
  } else {
    const hr = layers.hairs[t.hair];
    const hc = metroCell(hr.img, hr.row, DIR_BASE[d] + STAND);
    const tone = (h: string | null) => h && toneHair(layers, t, h);
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) put(x, y + dyh, tone(hc[y * OW + x]));
  }
  // 4. Glasses in the reading frames: what the donor's reading frame has and its
  //    typing frame lacks, in the head's rows.
  if (f >= 5) {
    const Tc = donorCell(layers.donor, d, f - 2);
    const dy2 = firstRow(Dc) - firstRow(Tc);
    for (let y = 0; y < split; y++) {
      for (let x = 0; x < OW; x++) {
        const h = Dc[y * OW + x];
        if (!h || ROLE[h] !== 'lens' || h === 'd0d0d0' || h === 'fff2ec') continue;
        if (x >= 13 && d === 2 && h === 'ffffff') continue; // paper, not a lens
        if (Tc[(y - dy2) * OW + x] === h) continue;
        put(x, y, h);
      }
    }
    for (let y = 0; y < split; y++) {
      for (let x = 0; x < OW; x++) {
        const h = Dc[y * OW + x];
        if (!h || (ROLE[h] !== 'hair' && h !== '000000')) continue;
        if (Tc[(y - dy2) * OW + x] === h) continue;
        if (h === '000000' || h === '191919') put(x, y, h);
      }
    }
  }
  return out;
}

/** A walk frame: Metro City's own body, outfit and hair layers. */
function walkCell(layers: FigureLayers, d: number, f: number, t: Traits): Cell {
  const o = layers.outfits[t.outfit];
  const hr = layers.hairs[t.hair];
  const col = DIR_BASE[d] + WALK[f];
  const out: Cell = new Array(OW * OH).fill(null);
  const lay = (c: Cell, shift: boolean) => {
    for (let i = 0; i < c.length; i++) {
      const h = c[i];
      if (h) out[i] = shift ? clothColor(t, h) : h;
    }
  };
  lay(metroCell(layers.body, t.skin, col), false);
  lay(metroCell(o.img, o.row, col), true);
  if (!o.hat) {
    const hc = metroCell(hr.img, hr.row, col);
    for (let i = 0; i < hc.length; i++) {
      const h = hc[i];
      if (h) out[i] = toneHair(layers, t, h);
    }
  }
  return out;
}

/** The figure for `seed` as a 112x96 PNG in the office character format. */
export function composeFigure(layers: FigureLayers, seed: string): Buffer {
  const t = traitsFor(layers, seed);
  const ramps = outfitRamps(layers, layers.outfits[t.outfit], t);
  const png = new PNG({ width: 7 * OW, height: 3 * OH });
  for (let d = 0; d < 3; d++) {
    for (let f = 0; f < 7; f++) {
      const cell = f < 3 ? walkCell(layers, d, f, t) : posedCell(layers, d, f, t, ramps);
      for (let y = 0; y < OH; y++) {
        for (let x = 0; x < OW; x++) {
          const h = cell[y * OW + x];
          if (!h) continue;
          const k = ((d * OH + y) * png.width + f * OW + x) * 4;
          const [r, g, b] = unhex(h);
          png.data[k] = r;
          png.data[k + 1] = g;
          png.data[k + 2] = b;
          png.data[k + 3] = 255;
        }
      }
    }
  }
  return PNG.sync.write(png);
}
