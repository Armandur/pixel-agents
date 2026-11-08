import type { SpriteData } from '../types.js';

const topAnchors = new WeakMap<SpriteData, { row: number; centerCol: number }>();

/** The sprite's first non-transparent row and that row's horizontal centre,
 *  in sprite pixels (cached per sprite). Used to seat a crown on a head. */
export function getSpriteTopAnchor(sprite: SpriteData): { row: number; centerCol: number } {
  const known = topAnchors.get(sprite);
  if (known) return known;
  let anchor = { row: 0, centerCol: (sprite[0]?.length ?? 0) / 2 };
  for (let r = 0; r < sprite.length; r++) {
    const filled = sprite[r].flatMap((color, c) => (color === '' ? [] : [c]));
    if (filled.length > 0) {
      anchor = { row: r, centerCol: (filled[0] + filled[filled.length - 1] + 1) / 2 };
      break;
    }
  }
  topAnchors.set(sprite, anchor);
  return anchor;
}
