/**
 * The entrance (TASK-3456): a newcomer materializes in the doorway, the door
 * opens, and it walks in to its seat; a leaver walks out and dematerializes
 * in the doorway. No entrance → the matrix effect where it stands, as before.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

beforeAll(() => {
  const leaf = {
    label: '',
    width: 16,
    height: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    category: 'wall',
    canPlaceOnWalls: true,
    groupId: 'DOOR',
    door: true,
  };
  const chair = {
    id: 'STOOL',
    label: '',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    category: 'chairs',
  };
  assert.ok(
    buildDynamicCatalog({
      catalog: [
        { ...leaf, id: 'DOOR', state: 'off' },
        ...[1, 2, 3].map((i) => ({
          ...leaf,
          id: `DOOR_OPEN_${i}`,
          state: 'on',
          animationGroup: 'DOOR__ON',
          frame: i - 1,
        })),
        chair,
      ],
      sprites: {
        DOOR: [['d']],
        DOOR_OPEN_1: [['o1']],
        DOOR_OPEN_2: [['o2']],
        DOOR_OPEN_3: [['o3']],
        STOOL: [['s']],
      },
    }),
  );
});

/** A 6x6 room: walls round it, a door in the bottom wall at (2,5), a stool at (2,1). */
function office(withDoor: boolean, stools = 1) {
  const tiles: number[] = [];
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++)
      tiles.push(r === 0 || r === 5 || c === 0 || c === 5 ? TileType.WALL : TileType.FLOOR_1);
  const layout = {
    version: 1,
    cols: 6,
    rows: 6,
    tiles,
    furniture: [
      { uid: 'stool', type: 'STOOL', col: 2, row: 1 },
      ...(stools > 1 ? [{ uid: 'stool2', type: 'STOOL', col: 3, row: 1 }] : []),
      ...(withDoor ? [{ uid: 'door', type: 'DOOR', col: 2, row: 4 }] : []),
    ],
  } as OfficeLayout;
  return new OfficeState(layout);
}
const run = (os: OfficeState, sec: number, until?: () => boolean) => {
  for (let t = 0; t < sec && !until?.(); t += 0.05) os.update(0.05);
};
const doorSprite = (os: OfficeState) => os.furniture.find((f) => f.y === 4 * 16)?.sprite[0][0];

test('a newcomer materializes outside the door, the door opens, and it walks in to its seat', () => {
  const os = office(true);
  os.addAgent(1);
  const ch = os.characters.get(1)!;
  assert.deepEqual([ch.tileCol, ch.tileRow], [2, 6], 'starts just outside the door');
  assert.equal(ch.matrixEffect, 'spawn');
  run(os, 0.4);
  assert.equal(doorSprite(os), 'o3', 'the door is open while it comes in');
  run(os, 10, () => ch.tileCol === 2 && ch.tileRow === 1);
  assert.deepEqual([ch.tileCol, ch.tileRow], [2, 1], 'reaches its seat');
  run(os, 1);
  assert.equal(doorSprite(os), 'd', 'and the door shuts behind it');
});

test('a leaver walks out through the door and dematerializes just outside', () => {
  const os = office(true);
  os.addAgent(1, undefined, undefined, undefined, true); // restored: at its seat
  const ch = os.characters.get(1)!;
  os.removeAgent(1);
  assert.equal(ch.matrixEffect, null, 'not on the spot: it walks out');
  assert.equal(os.seats.get('stool')!.assigned, false);
  run(os, 15, () => ch.matrixEffect === 'despawn');
  assert.deepEqual([ch.tileCol, ch.tileRow], [2, 6], 'dematerializes just outside');
  run(os, 2);
  assert.equal(os.characters.has(1), false);
});

test('without an entrance agents appear and vanish where they are, as before', () => {
  const os = office(false);
  os.addAgent(1);
  const ch = os.characters.get(1)!;
  assert.deepEqual([ch.tileCol, ch.tileRow], [2, 1]);
  assert.equal(ch.doorway, undefined);
  run(os, 1);
  os.removeAgent(1);
  assert.equal(ch.matrixEffect, 'despawn');
});

test('a finished sub-agent reports, then walks out through the door', () => {
  const os = office(true);
  os.addAgent(1, undefined, undefined, undefined, true);
  const id = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  run(os, 1);
  os.removeSubagent(1, 'tool-1');
  let leftViaDoor = false;
  run(os, 30, () => {
    if (sub.doorway?.phase === 'toDoor') leftViaDoor = true;
    return !os.characters.has(id);
  });
  assert.ok(leftViaDoor, 'it headed for the door after reporting');
  assert.equal(os.characters.has(id), false);
});

test('a new sub-agent also comes in through the door, then goes to its computer or its parent', () => {
  const os = office(true);
  os.addAgent(1, undefined, undefined, undefined, true);
  const id = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  assert.deepEqual([sub.tileCol, sub.tileRow], [2, 6], 'starts outside the door');
  run(os, 15, () => sub.doorway === undefined && sub.path.length === 0 && sub.tileRow < 4);
  assert.ok(sub.tileRow < 4, 'walked in toward its parent');
});

test('two newcomers in the same frame come in one at a time, in creation order', () => {
  const os = office(true, 2);
  os.addAgent(1);
  os.addAgent(2);
  const [a, b] = [os.characters.get(1)!, os.characters.get(2)!];
  assert.equal(a.matrixEffect, 'spawn');
  assert.equal(b.matrixEffect, null, 'the second does not materialize yet');
  assert.ok(!os.getCharacters().some((c) => c === b && c.x >= 0), 'and is not on the map');
  let bAppeared = -1;
  let sharedTile = false;
  let aClearAtAppear = false;
  for (let t = 0; t < 20; t += 0.05) {
    os.update(0.05);
    if (bAppeared < 0 && b.matrixEffect === 'spawn') {
      bAppeared = t;
      aClearAtAppear =
        Math.abs(a.tileCol - 2) + Math.abs(a.tileRow - 6) >= 4 || a.doorway === undefined;
    }
    if (bAppeared >= 0 && a.tileCol === b.tileCol && a.tileRow === b.tileRow) sharedTile = true;
    if (bAppeared < 0) assert.ok(b.x < 0, 'unseen until its turn');
  }
  assert.ok(bAppeared > 0.3, 'the second waited for the first');
  assert.ok(aClearAtAppear, 'the first was already inside');
  assert.equal(sharedTile, false, 'never on the same tile');
  for (const c of [a, b]) {
    const seat = os.seats.get(c.seatId!)!;
    assert.deepEqual([c.tileCol, c.tileRow], [seat.seatCol, seat.seatRow], 'reaches its seat');
  }
});

test('a sub-agent created with its parent waits for the parent to get in', () => {
  const os = office(true, 2);
  os.addAgent(1);
  const id = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  assert.equal(sub.matrixEffect, null);
  run(os, 20);
  assert.equal(sub.doorway, undefined);
  assert.ok(sub.tileRow < 5, 'came in too');
});

test('a waiting newcomer that is removed leaves the queue without a trace', () => {
  const os = office(true, 2);
  os.addAgent(1);
  os.addAgent(2);
  os.addAgent(3);
  const seat = os.characters.get(2)!.seatId!;
  os.removeAgent(2);
  assert.equal(os.characters.has(2), false);
  assert.equal(os.seats.get(seat)!.assigned, false, 'its seat is free again');
  run(os, 20);
  const c = os.characters.get(3)!;
  assert.ok(c.tileRow < 5, 'the third still comes in, now second in line');
  assert.equal(os.characters.has(2), false);
});

test('a waiting sub-agent that is removed leaves the queue without a trace', () => {
  const os = office(true, 2);
  os.addAgent(1);
  const id = os.addSubagent(1, 'tool-1');
  os.removeSubagent(1, 'tool-1');
  assert.equal(os.characters.has(id), false);
  assert.equal(os.getSubagentId(1, 'tool-1'), null);
  run(os, 5);
  assert.equal(os.characters.has(1), true);
});
