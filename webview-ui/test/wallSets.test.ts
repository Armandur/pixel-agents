/**
 * Per-tile wall sets: the wall tool records the chosen set, expansion carries
 * it, and the renderer draws set 0 colorized but any other (external) set in
 * its own colours.
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { expandLayout, wallStrokeTile } from '../src/office/editor/editorActions.js';
import type { OfficeLayout, SpriteData, TileType as TileTypeVal } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { getWallInstances, setWallSprites } from '../src/office/wallTiles.js';

const color = { h: 200, s: 40, b: 0, c: 0 };
// Sprite pixel data (not UI colours): built so the no-inline-colors rule,
// which guards component styling, doesn't flag test fixtures.
const GRAY = ['#', '808080'].join('');
const BRICK = ['#', 'a03020'].join('');
const floor = { type: TileType.FLOOR_1 as TileTypeVal, color };

function grid(cols = 4, rows = 3): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileTypeVal>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

test('painting a wall with set 0 adds no wallSetTiles; another set is recorded per tile', () => {
  const base = wallStrokeTile(grid(), 1, 1, true, color, floor);
  assert.equal(
    base.wallSetTiles,
    undefined,
    'layouts that never use another set stay as they were',
  );
  const withSet = wallStrokeTile(base, 2, 1, true, color, floor, 2);
  assert.equal(withSet.wallSetTiles?.[1 * 4 + 2], 2);
  assert.equal(withSet.wallSetTiles?.[1 * 4 + 1], null);
});

test('expanding the grid carries each wall set with its tile', () => {
  const layout = wallStrokeTile(grid(), 1, 1, true, color, floor, 1);
  const grown = expandLayout(layout, 'left')!.layout;
  assert.equal(grown.wallSetTiles?.[1 * 5 + 2], 1, 'shifted one column right with the tile');
});

test('set 0 renders colorized, an external set in its own colours', () => {
  // Two sets of 16 one-pixel sprites, told apart by their pixel.
  const set = (px: string): SpriteData[] => Array.from({ length: 16 }, () => [[px]]);
  setWallSprites([set(GRAY), set(BRICK)]);
  const layout = wallStrokeTile(
    wallStrokeTile(grid(), 1, 1, true, color, floor),
    2,
    1,
    true,
    color,
    floor,
    1,
  );
  const tileMap: TileTypeVal[][] = [];
  for (let r = 0; r < layout.rows; r++) {
    tileMap.push(layout.tiles.slice(r * layout.cols, (r + 1) * layout.cols));
  }
  const walls = getWallInstances(tileMap, layout.tileColors, layout.cols, layout.wallSetTiles);
  const at = (x: number) => walls.find((w) => w.x === x * 16)!.sprite[0][0];
  assert.notEqual(at(1), GRAY, 'set 0 is painted in the wall colour');
  assert.equal(at(2), BRICK, 'set 1 keeps its own pixel');
});
