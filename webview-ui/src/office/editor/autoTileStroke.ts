import type { ColorValue } from '../../components/ui/types.js';
import type { OfficeLayout } from '../types.js';
import { placeNewFurniture, removeFurniture } from './editorActions.js';

function itemAt(layout: OfficeLayout, type: string, col: number, row: number) {
  return layout.furniture.find((f) => f.type === type && f.col === col && f.row === row);
}

/** Whether a stroke starting on (col,row) paints (true) or erases (false). */
export function autoTileStrokeAdds(
  layout: OfficeLayout,
  type: string,
  col: number,
  row: number,
): boolean {
  return !itemAt(layout, type, col, row);
}

/**
 * One tile of an auto-tile stroke: add a 1x1 item of `type` (where furniture
 * may go) or remove the one there. Returns the layout unchanged when there is
 * nothing to do, so a drag over painted tiles adds no undo noise.
 */
export function autoTileStrokeTile(
  layout: OfficeLayout,
  type: string,
  col: number,
  row: number,
  adding: boolean,
  color: ColorValue | null,
): OfficeLayout {
  const existing = itemAt(layout, type, col, row);
  if (adding) return existing ? layout : placeNewFurniture(layout, type, col, row, color);
  return existing ? removeFurniture(layout, existing.uid) : layout;
}
