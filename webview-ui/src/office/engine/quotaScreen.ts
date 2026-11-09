import {
  providerBadge,
  QUOTA_SCREEN_HEIGHT,
  QUOTA_SCREEN_INSET_X,
  QUOTA_SCREEN_INSET_Y,
  QUOTA_SCREEN_WIDTH,
  QUOTA_STALE_OPACITY,
  QUOTA_SYMBOL_WORLD_PX,
} from '../../constants.js';
import { quotaBars, type QuotaInfo } from '../quotaFormat.js';

/** World px between the symbol and the bars, and between the two bars. */
const GAP = 2;
/** World px between the cells of a bar. */
const CELL_GAP = 0.5;
/** World px height of one bar. */
const BAR_H = 3;

/**
 * Draw a quota TV's screen (provider symbol + 5 h / 7 d cell bars) on the
 * canvas, right after the TV sprite itself, so it takes the TV's place in
 * the depth order: a character walking in front of the TV covers it. The
 * screen used to be a DOM overlay, which always sat on top of everyone.
 * `fx, fy` is the TV sprite's top-left in device px; `zoom` device px per
 * world px.
 */
export function drawQuotaScreen(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  zoom: number,
  provider: string,
  info: QuotaInfo | undefined,
  nowSec: number,
): void {
  const sx = fx + QUOTA_SCREEN_INSET_X * zoom;
  const sy = fy + QUOTA_SCREEN_INSET_Y * zoom;
  const z = (w: number) => w * zoom;
  ctx.save();
  if (info?.stale) ctx.globalAlpha = QUOTA_STALE_OPACITY;

  // The provider symbol: its card badge, large, vertically centred.
  const badge = providerBadge(provider);
  const sym = QUOTA_SYMBOL_WORLD_PX;
  const symX = sx + z(1);
  const symY = sy + z((QUOTA_SCREEN_HEIGHT - sym) / 2);
  if (badge) {
    ctx.fillStyle = badge.border;
    ctx.fillRect(symX, symY, z(sym), z(sym));
    ctx.fillStyle = badge.fill;
    ctx.fillRect(symX + z(1), symY + z(1), z(sym - 2), z(sym - 2));
    ctx.fillStyle = badge.border;
    ctx.font = `${z(sym * 0.8)}px 'FS Pixel Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge.glyph, symX + z(sym / 2), symY + z(sym / 2) + z(0.5));
  }

  // Two bars, 5 h over 7 d, filling the rest of the screen.
  const barsX = sx + z(1 + (badge ? sym + GAP : 0));
  const barsW = sx + z(QUOTA_SCREEN_WIDTH - 1) - barsX;
  const bars = quotaBars(info, nowSec);
  const blockH = bars.length * BAR_H + (bars.length - 1) * GAP;
  let y = sy + z((QUOTA_SCREEN_HEIGHT - blockH) / 2);
  for (const bar of bars) {
    const n = bar.cellColors.length;
    const cellW = (barsW - z(CELL_GAP) * (n - 1)) / n;
    bar.cellColors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(barsX + i * (cellW + z(CELL_GAP)), y, cellW, z(BAR_H));
    });
    y += z(BAR_H + GAP);
  }
  ctx.restore();
}
