/**
 * Screens turn on only in front of an agent working at its desk (TASK-3447),
 * through the real OfficeState with a two-state PC in the catalog. Sprite
 * cells are tags, not colours: the test reads which variant is placed.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { Character, OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

type CatalogAsset = LoadedAssetData['catalog'][number];
const pc = (id: string, state: 'on' | 'off'): CatalogAsset => ({
  id,
  label: id,
  category: 'electronics',
  width: 16,
  height: 16,
  footprintW: 1,
  footprintH: 1,
  isDesk: false,
  groupId: 'PC',
  orientation: 'front',
  state,
});

beforeAll(() => {
  assert.ok(
    buildDynamicCatalog({
      catalog: [pc('PC_OFF', 'off'), pc('PC_ON', 'on')],
      sprites: { PC_OFF: [['screen-off']], PC_ON: [['screen-on']] },
    }),
  );
});

function office(): { os: OfficeState; ch: Character } {
  const layout: OfficeLayout = {
    version: 1,
    cols: 8,
    rows: 8,
    tiles: new Array<TileType>(64).fill(TileType.FLOOR_1),
    // The PC stands right in front of (below) the desk seat at (3,3).
    furniture: [{ uid: 'pc', type: 'PC_OFF', col: 3, row: 4 }],
  };
  const os = new OfficeState(layout);
  os.seats.set('desk', {
    uid: 'desk',
    seatCol: 3,
    seatRow: 3,
    facingDir: Direction.DOWN,
    assigned: true,
  });
  os.addAgent(1, 0, 0, undefined, true);
  const ch = os.characters.get(1)!;
  ch.seatId = 'desk';
  ch.tileCol = 3;
  ch.tileRow = 3;
  ch.x = 3 * TILE_SIZE + TILE_SIZE / 2;
  ch.y = 3 * TILE_SIZE + TILE_SIZE / 2;
  ch.state = CharacterState.TYPE;
  ch.path = [];
  return { os, ch };
}

const screenOn = (os: OfficeState) => os.furniture.some((f) => f.sprite[0][0] === 'screen-on');

test('an active agent sitting at its desk turns its screen on', () => {
  const { os } = office();
  os.setAgentActive(1, true);
  assert.equal(screenOn(os), true);
});

test('the screen goes dark when the agent leaves its seat (walks off, visits, lounges)', () => {
  const { os, ch } = office();
  os.setAgentActive(1, true);
  assert.equal(screenOn(os), true);

  ch.state = CharacterState.WALK;
  ch.tileRow = 2;
  os.update(0.25); // the furniture animation tick rebuilds the instances
  assert.equal(screenOn(os), false, 'walked away');

  ch.state = CharacterState.TYPE;
  ch.tileRow = 3;
  ch.visit = { targetId: 2, phase: 'talking', talkTimer: 4, waited: 0 };
  os.update(0.25);
  assert.equal(screenOn(os), false, 'on a visit');
});

test('an agent the server reports idle does not light its screen, even flagged active', () => {
  const { os } = office();
  os.setAgentActive(1, true);
  os.setAgentIdleSince(1, Date.now() - 60_000); // an adopted agent: isActive stays at its default
  assert.equal(screenOn(os), false);
  os.setAgentIdleSince(1, undefined);
  assert.equal(screenOn(os), true, 'back to work');
});

test('the screen goes dark when the agent is removed or moved to another seat', () => {
  const removed = office();
  removed.os.setAgentActive(1, true);
  removed.os.removeAgent(1);
  removed.os.update(0.25);
  assert.equal(screenOn(removed.os), false, 'session ended');

  const moved = office();
  moved.os.setAgentActive(1, true);
  moved.os.seats.set('other', {
    uid: 'other',
    seatCol: 6,
    seatRow: 6,
    facingDir: Direction.UP,
    assigned: true,
  });
  moved.ch.seatId = 'other';
  moved.os.update(0.25);
  assert.equal(screenOn(moved.os), false, 'moved to another seat');
});
