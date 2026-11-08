import { NUDGE_MAX_PX } from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';

/**
 * Which way an item may be nudged off its tile: things standing on a desk,
 * decor and tech both ways; wall items only sideways (up or down would lift
 * them off the wall face). Everything else stays on the grid.
 */
export function nudgeAxes(type: string): 'xy' | 'x' | null {
  const entry = getCatalogEntry(type);
  if (!entry) return null;
  if (entry.canPlaceOnWalls) return 'x';
  if (entry.canPlaceOnSurfaces || entry.category === 'decor' || entry.category === 'electronics') {
    return 'xy';
  }
  return null;
}

const clamp = (v: number) => Math.max(-NUDGE_MAX_PX, Math.min(NUDGE_MAX_PX, v));

/** Shift a placed item's drawing by (dx, dy) px, clamped to half a tile.
 *  Returns the layout unchanged when the item can't move that way. */
export function nudgeFurniture(
  layout: OfficeLayout,
  uid: string,
  dx: number,
  dy: number,
): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  const axes = item && nudgeAxes(item.type);
  if (!item || !axes) return layout;
  const x = clamp((item.nudge?.x ?? 0) + dx);
  const y = axes === 'xy' ? clamp((item.nudge?.y ?? 0) + dy) : 0;
  if (x === (item.nudge?.x ?? 0) && y === (item.nudge?.y ?? 0)) return layout;
  const moved: PlacedFurniture = { ...item, nudge: { x, y } };
  if (x === 0 && y === 0) delete moved.nudge;
  return { ...layout, furniture: layout.furniture.map((f) => (f.uid === uid ? moved : f)) };
}
