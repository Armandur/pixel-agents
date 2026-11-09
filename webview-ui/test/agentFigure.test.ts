/** Generated figures (TASK-3468): an agent and its sub-agents draw with the figure. */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { getCharacterSprites, setFigureTemplate } from '../src/office/sprites/spriteData.js';
import type { OfficeLayout, SpriteData } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';

const frames = (px: string) => Array.from({ length: 7 }, (): SpriteData => [[px]]);

function office() {
  const layout: OfficeLayout = {
    version: 1,
    cols: 6,
    rows: 6,
    tiles: new Array<TileType>(36).fill(TileType.FLOOR_1),
    furniture: [],
  };
  return new OfficeState(layout);
}

test('a figure that arrives before or after the character is drawn by it and its sub-agents', () => {
  const os = office();
  os.setAgentFigure(1, 'Dirigent'); // before the character exists
  os.addAgent(1);
  assert.equal(os.characters.get(1)!.figure, 'Dirigent');
  const sub = os.characters.get(os.addSubagent(1, 'tool-1'))!;
  assert.equal(sub.figure, 'Dirigent', 'a sub-agent looks like its lead');

  os.addAgent(2);
  const sub2 = os.characters.get(os.addSubagent(2, 'tool-2'))!;
  os.setAgentFigure(2, 'Kistvakt'); // after
  assert.equal(os.characters.get(2)!.figure, 'Kistvakt');
  assert.equal(sub2.figure, 'Kistvakt');
});

test('the figure replaces the palette character and ignores the hue shift', () => {
  setFigureTemplate('Tolken', { down: frames('f'), up: frames('f'), right: frames('f') });
  const s = getCharacterSprites(3, 120, 'Tolken');
  assert.equal(s.walk[Direction.DOWN][0][0][0], 'f');
  assert.equal(s.typing[Direction.UP][1][0][0], 'f');
});
