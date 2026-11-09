import {
  SIGN_FONT_MIN_WORLD_PX,
  SIGN_FONT_WORLD_PX,
  SIGN_LINE_HEIGHT,
  SIGN_TEXT_COLOR,
  SIGN_TYPES,
} from '../../constants.js';

const FONT = (px: number) => `${px}px 'FS Pixel Sans', sans-serif`;

/** The two-line split of `text` whose longer line is shortest (null for one word). */
export function splitInTwo(text: string, width: (s: string) => number): [string, string] | null {
  const words = text.split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(width(pair[0]), width(pair[1]));
    if (w < bestW) {
      bestW = w;
      best = pair;
    }
  }
  return best;
}

/**
 * The lines and size (world px) a sign's text is drawn at: the largest size
 * at which it fits the box, on one line or, failing that, on two. `width`
 * measures a string in world px at 1 px font size.
 */
export function layoutSignText(
  text: string,
  box: { w: number; h: number },
  width: (s: string) => number,
): { lines: string[]; px: number } {
  const two = splitInTwo(text, width);
  for (let px = SIGN_FONT_WORLD_PX; px > SIGN_FONT_MIN_WORLD_PX; px--) {
    if (px <= box.h && width(text) * px <= box.w) return { lines: [text], px };
    if (
      two &&
      px * (1 + SIGN_LINE_HEIGHT) <= box.h &&
      Math.max(width(two[0]), width(two[1])) * px <= box.w
    ) {
      return { lines: two, px };
    }
  }
  return { lines: two ?? [text], px: SIGN_FONT_MIN_WORLD_PX };
}

/**
 * Draw a sign's text on its face, right after the sign sprite, so it takes
 * the sign's depth slot like a quota TV's screen. `fx, fy` is the sprite's
 * top-left in device px.
 */
export function drawSignText(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  zoom: number,
  type: string,
  text: string,
): void {
  const box = SIGN_TYPES[type];
  if (!box) return;
  ctx.save();
  // Width at a 100 px font, scaled down: the pixel font measures stably there.
  ctx.font = FONT(100);
  const width = (s: string) => ctx.measureText(s).width / 100;
  const { lines, px } = layoutSignText(text, box, width);
  ctx.font = FONT(px * zoom);
  ctx.fillStyle = SIGN_TEXT_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  ctx.rect(fx + box.x * zoom, fy + box.y * zoom, box.w * zoom, box.h * zoom);
  ctx.clip(); // a text too long even at the smallest size is cut, never spills
  const cx = fx + (box.x + box.w / 2) * zoom;
  const cy = fy + (box.y + box.h / 2) * zoom;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * px * SIGN_LINE_HEIGHT * zoom);
  });
  ctx.restore();
}
