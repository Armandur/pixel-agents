/// <reference lib="dom" />
// The renderer under test draws on a CanvasRenderingContext2D (a DOM type).
/**
 * The quota TVs' screens are drawn on the canvas in the TV's depth slot
 * (TASK-3479): a character in front of the TV covers the bars, one behind it
 * does not. They used to be a DOM overlay drawn over everyone.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { createCharacter } from '../src/office/engine/characters.js';
import { renderScene } from '../src/office/engine/renderer.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { layoutToFurnitureInstances } from '../src/office/layout/layoutSerializer.js';
import { TILE_SIZE } from '../src/office/types.js';

type Op = string;
let ops: Op[] = [];

beforeAll(() => {
  // A stand-in canvas: sprite caching only needs a context to paint into.
  const noop = () => {};
  const offscreen = {
    fillStyle: '',
    fillRect: noop,
    clearRect: noop,
    drawImage: noop,
    imageSmoothingEnabled: false,
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => offscreen }),
  };
  assert.ok(
    buildDynamicCatalog({
      catalog: [
        {
          id: 'TV_CLAUDE',
          label: '',
          category: 'wall',
          width: 48,
          height: 32,
          footprintW: 3,
          footprintH: 2,
          isDesk: false,
          canPlaceOnWalls: true,
        },
      ],
      sprites: { TV_CLAUDE: [['tv']] },
    }),
  );
});

function recorder(): CanvasRenderingContext2D {
  ops = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillText: () => ops.push('text'),
    fillRect: () => ops.push('rect'),
    drawImage: (_img: unknown, x: number) => ops.push(`img@${x}`),
    set fillStyle(_v: string) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set globalAlpha(_v: number) {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

test('the TV instance knows its provider, and its screen is drawn right after it', () => {
  const [tv] = layoutToFurnitureInstances([{ uid: 't', type: 'TV_CLAUDE', col: 2, row: 2 }]);
  assert.equal(tv.quotaProvider, 'claude');

  const behind = createCharacter(1, 0, null, null, 0);
  behind.x = 3 * TILE_SIZE;
  behind.y = 1 * TILE_SIZE; // above the TV's bottom edge: behind it
  const front = createCharacter(2, 0, null, null, 0);
  front.x = 5 * TILE_SIZE;
  front.y = 4 * TILE_SIZE; // in front of the TV
  renderScene(recorder(), [tv], [front, behind], 0, 0, 1, null, null, [], {});

  const tvAt = ops.indexOf(`img@${2 * TILE_SIZE}`);
  const firstRect = ops.indexOf('rect');
  const lastRect = ops.lastIndexOf('rect');
  assert.ok(tvAt >= 0 && firstRect > tvAt, 'screen drawn over the TV sprite');
  const frontImg = ops.findIndex(
    (o, i) => i > tvAt && o.startsWith('img@') && o !== `img@${2 * TILE_SIZE}`,
  );
  assert.ok(frontImg > lastRect, 'the character in front is drawn after (over) the screen');
  const behindImg = ops.findIndex((o) => o.startsWith('img@') && o !== `img@${2 * TILE_SIZE}`);
  assert.ok(behindImg < tvAt, 'the character behind is drawn before the TV');
});
