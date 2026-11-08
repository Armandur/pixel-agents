/**
 * Painted counters: 1x1 desk items whose drawn piece follows their same-type
 * neighbours, while each item keeps storing only the group id.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { autoTileStrokeAdds, autoTileStrokeTile } from '../src/office/editor/autoTileStroke.js';
import { canPlaceFurniture } from '../src/office/editor/editorActions.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import {
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
} from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';

const piece = (m: number) => [[`p${m}`]];

beforeAll(() => {
  const base = { label: '', width: 16, height: 16, footprintW: 1, footprintH: 1 };
  const catalog = [
    { ...base, id: 'COUNTER', category: 'desks', isDesk: true, autoTile: true },
    { ...base, id: 'STOOL', category: 'chairs', isDesk: false },
    { ...base, id: 'MUG', category: 'decor', isDesk: false, canPlaceOnSurfaces: true },
  ];
  const sprites: Record<string, string[][]> = { COUNTER: piece(0), STOOL: [['s']], MUG: [['m']] };
  for (let m = 0; m < 16; m++) sprites[`COUNTER#${m}`] = piece(m);
  assert.ok(buildDynamicCatalog({ catalog, sprites }));
});

function room(): OfficeLayout {
  return {
    version: 1,
    cols: 6,
    rows: 6,
    tiles: new Array(36).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

function paint(layout: OfficeLayout, tiles: Array<[number, number]>): OfficeLayout {
  const adding = autoTileStrokeAdds(layout, 'COUNTER', ...tiles[0]);
  return tiles.reduce((l, [c, r]) => autoTileStrokeTile(l, 'COUNTER', c, r, adding, null), layout);
}

const drawn = (layout: OfficeLayout) =>
  layoutToFurnitureInstances(layout.furniture).map((i) => i.sprite[0][0]);

test('a 2x2 block draws its four corner pieces, and every item stores only the group id', () => {
  const layout = paint(room(), [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]);
  // NW: E+S = 6, NE: S+W = 12, SW: N+E = 3, SE: N+W = 9
  assert.deepEqual(drawn(layout), ['p6', 'p12', 'p3', 'p9']);
  assert.ok(layout.furniture.every((f) => f.type === 'COUNTER'));
});

test('painting a neighbour changes the piece drawn next to it, not the stored item', () => {
  const one = paint(room(), [[1, 1]]);
  const two = paint(one, [[2, 1]]);
  assert.deepEqual(drawn(one), ['p0']);
  assert.deepEqual(drawn(two), ['p2', 'p8']);
  assert.deepEqual(two.furniture[0], one.furniture[0]);
});

test('a stroke that starts on a counter erases, and refuses walls', () => {
  const layout = paint(room(), [
    [1, 1],
    [2, 1],
  ]);
  assert.equal(
    paint(layout, [
      [1, 1],
      [2, 1],
    ]).furniture.length,
    0,
  );
  const walled = { ...room(), tiles: room().tiles.map((t, i) => (i === 7 ? TileType.WALL : t)) };
  assert.equal(paint(walled, [[1, 1]]).furniture.length, 0);
});

test('counters block walking, take surface items and turn a stool toward them', () => {
  let layout = paint(room(), [
    [1, 1],
    [2, 1],
  ]);
  assert.ok(getBlockedTiles(layout.furniture).has('1,1'));
  assert.ok(canPlaceFurniture(layout, 'MUG', 2, 1));
  layout = {
    ...layout,
    furniture: [...layout.furniture, { uid: 's', type: 'STOOL', col: 1, row: 2 }],
  };
  assert.equal(layoutToSeats(layout.furniture).get('s')?.facingDir, Direction.UP);
});
