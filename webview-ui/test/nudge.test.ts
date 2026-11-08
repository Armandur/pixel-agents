/** Half-tile nudge: a visual offset only; the footprint stays on whole tiles. */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { nudgeFurniture } from '../src/office/editor/nudge.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import {
  getBlockedTiles,
  layoutToFurnitureInstances,
} from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

beforeAll(() => {
  const base = { label: '', width: 16, height: 16, footprintW: 1, footprintH: 1, isDesk: false };
  const catalog = [
    { ...base, id: 'MUG', category: 'decor', canPlaceOnSurfaces: true },
    { ...base, id: 'CLOCK', category: 'wall', canPlaceOnWalls: true },
    { ...base, id: 'CHAIR', category: 'chairs' },
  ];
  assert.ok(
    buildDynamicCatalog({ catalog, sprites: { MUG: [['m']], CLOCK: [['c']], CHAIR: [['s']] } }),
  );
});

const layout = (type: string): OfficeLayout => ({
  version: 1,
  cols: 4,
  rows: 4,
  tiles: new Array(16).fill(TileType.FLOOR_1),
  furniture: [{ uid: 'a', type, col: 1, row: 1 }],
});

test('a nudge moves the drawing by half a tile at most, and never the footprint', () => {
  let l = nudgeFurniture(layout('MUG'), 'a', 8, 8);
  l = nudgeFurniture(l, 'a', 8, 0); // clamped at +8
  assert.deepEqual(l.furniture[0].nudge, { x: 8, y: 8 });
  const [inst] = layoutToFurnitureInstances(l.furniture);
  assert.deepEqual([inst.x, inst.y], [16 + 8, 16 + 8]);
  assert.ok(getBlockedTiles(l.furniture).has('1,1'));
});

test('nudging back to the tile clears the field', () => {
  const l = nudgeFurniture(nudgeFurniture(layout('MUG'), 'a', -8, 0), 'a', 8, 0);
  assert.equal(l.furniture[0].nudge, undefined);
});

test('wall items move only sideways, and chairs stay on the grid', () => {
  assert.deepEqual(nudgeFurniture(layout('CLOCK'), 'a', 8, 8).furniture[0].nudge, { x: 8, y: 0 });
  const chair = layout('CHAIR');
  assert.equal(nudgeFurniture(chair, 'a', 8, 0), chair);
});
