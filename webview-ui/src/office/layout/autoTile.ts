import type { PlacedFurniture, SpriteData } from '../types.js';

/**
 * Auto-tiled furniture (a counter you paint): each tile is a 1x1 item of the
 * group's type, and the piece it draws depends on which of its four
 * neighbours hold the same type. Mask bits match the walls: N=1, E=2, S=4,
 * W=8. Only the group id is stored on the item, so painting or erasing a
 * neighbour never rewrites an existing item.
 */
const pieces = new Map<string, SpriteData[]>();

/** Register a group's 16 pieces (index = mask). Called by the catalog build. */
export function setAutoTilePieces(type: string, set: SpriteData[]): void {
  pieces.set(type, set);
}

export function clearAutoTilePieces(): void {
  pieces.clear();
}

export function isAutoTile(type: string | undefined): boolean {
  return type !== undefined && pieces.has(type);
}

/** Tiles held by each auto-tile type: type → Set of "col,row". */
export function autoTileIndex(furniture: readonly PlacedFurniture[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const f of furniture) {
    if (!pieces.has(f.type)) continue;
    let tiles = index.get(f.type);
    if (!tiles) index.set(f.type, (tiles = new Set()));
    tiles.add(`${f.col},${f.row}`);
  }
  return index;
}

export function autoTileMask(tiles: ReadonlySet<string>, col: number, row: number): number {
  return (
    (tiles.has(`${col},${row - 1}`) ? 1 : 0) |
    (tiles.has(`${col + 1},${row}`) ? 2 : 0) |
    (tiles.has(`${col},${row + 1}`) ? 4 : 0) |
    (tiles.has(`${col - 1},${row}`) ? 8 : 0)
  );
}

export function autoTilePiece(type: string, mask: number): SpriteData | undefined {
  return pieces.get(type)?.[mask];
}
