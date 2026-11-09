/** Wall signs (TASK-3524): the text is per placed item and reaches the renderer. */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { setFurnitureText } from '../src/office/editor/editorActions.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { layoutToFurnitureInstances } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

beforeAll(() => {
  const wall = {
    label: '',
    width: 48,
    height: 32,
    footprintW: 3,
    footprintH: 2,
    isDesk: false,
    category: 'wall',
    canPlaceOnWalls: true,
  };
  assert.ok(
    buildDynamicCatalog({
      catalog: [
        { ...wall, id: 'SIGN_WALL' },
        { ...wall, id: 'PAINTING' },
      ],
      sprites: { SIGN_WALL: [['s']], PAINTING: [['p']] },
    }),
  );
});

function layout(text?: string): OfficeLayout {
  return {
    version: 1,
    cols: 4,
    rows: 2,
    tiles: Array(8).fill(TileType.WALL),
    furniture: [
      { uid: 'sign', type: 'SIGN_WALL', col: 0, row: 0, ...(text ? { text } : {}) },
      { uid: 'pic', type: 'PAINTING', col: 0, row: 0, text: 'ignored' },
    ],
  } as OfficeLayout;
}

test('a sign carries its text to the renderer; other items never do', () => {
  const [sign, pic] = layoutToFurnitureInstances(layout('Kyrkan').furniture);
  assert.deepEqual(sign.sign, { text: 'Kyrkan', type: 'SIGN_WALL' });
  assert.equal(pic.sign, undefined);
});

test('a sign without text draws no text', () => {
  const [sign] = layoutToFurnitureInstances(layout().furniture);
  assert.equal(sign.sign, undefined);
});

test('setFurnitureText sets, trims and clears; no change keeps the layout object', () => {
  const l = layout();
  const set = setFurnitureText(l, 'sign', '  Infra och agenter ');
  assert.equal(set.furniture[0].text, 'Infra och agenter');
  assert.equal(setFurnitureText(set, 'sign', 'Infra och agenter'), set);
  const cleared = setFurnitureText(set, 'sign', null);
  assert.equal('text' in cleared.furniture[0], false);
  assert.equal(setFurnitureText(l, 'missing', 'x'), l);
});

test('sign text: one line when it fits, two lines before shrinking, the longer line as short as can be', async () => {
  const { layoutSignText } = await import('../src/office/engine/signText.js');
  const width = (s: string) => s.length * 0.6; // 0.6 em per character
  const box = { w: 40, h: 19 };
  assert.deepEqual(layoutSignText('Kyrkan', box, width), { lines: ['Kyrkan'], px: 11 });
  const arkiv = layoutSignText('Arkiv och nedladdare', box, width);
  assert.deepEqual(arkiv.lines, ['Arkiv och', 'nedladdare']);
  assert.ok(arkiv.px >= 6, `two lines keep it large: ${arkiv.px}px`);
  const one = layoutSignText('Konferensrummet', box, width);
  assert.equal(one.lines.length, 1, 'one word never wraps');
});
