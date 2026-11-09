/**
 * Seats kept for one agent by session name (TASK-3461): nobody else gets the
 * seat, and the named agent walks to it when its name arrives.
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { setSeatOwner } from '../src/office/engine/seatOwners.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';

function office(seatOwners?: Record<string, string>) {
  const layout: OfficeLayout = {
    version: 1,
    cols: 10,
    rows: 10,
    tiles: new Array<TileType>(100).fill(TileType.FLOOR_1),
    furniture: [],
    ...(seatOwners ? { seatOwners } : {}),
  };
  const os = new OfficeState(layout);
  for (const [uid, col] of [
    ['a', 2],
    ['corner', 8],
  ] as const) {
    os.seats.set(uid, {
      uid,
      seatCol: col,
      seatRow: 2,
      facingDir: Direction.DOWN,
      assigned: false,
    });
  }
  return os;
}

test('a kept seat is never handed to another agent', () => {
  const os = office({ corner: 'Dirigent' });
  os.addAgent(1);
  os.addAgent(2);
  assert.equal(os.characters.get(1)!.seatId, 'a');
  assert.equal(os.characters.get(2)!.seatId, null, 'stands rather than taking the kept seat');
  assert.equal(os.seats.get('corner')!.assigned, false);
});

test('the named agent claims its seat when its name arrives, also before it exists', () => {
  const os = office({ corner: 'Dirigent' });
  os.addAgent(1);
  assert.equal(os.characters.get(1)!.seatId, 'a');
  os.setAgentSessionName(1, 'Dirigent');
  assert.equal(os.characters.get(1)!.seatId, 'corner');
  assert.equal(os.seats.get('a')!.assigned, false, 'its old seat is free again');

  const early = office({ corner: 'Dirigent' });
  early.setAgentSessionName(7, 'Dirigent');
  early.addAgent(7);
  assert.equal(early.characters.get(7)!.seatId, 'corner');
});

test('reserving an occupied seat moves the sitter to the seat that freed up', () => {
  // Real chairs, so rebuildFromLayout derives the same seats again.
  buildDynamicCatalog({
    catalog: [
      {
        id: 'STOOL',
        label: '',
        category: 'chairs',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
      },
    ],
    sprites: { STOOL: [['s']] },
  });
  const layout: OfficeLayout = {
    version: 1,
    cols: 10,
    rows: 10,
    tiles: new Array<TileType>(100).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'a', type: 'STOOL', col: 2, row: 2 },
      { uid: 'corner', type: 'STOOL', col: 8, row: 2 },
    ],
  };
  const os = new OfficeState(layout);
  layout.furniture.push({ uid: 'spare', type: 'STOOL', col: 5, row: 5 });
  os.rebuildFromLayout(layout);
  os.addAgent(1, undefined, undefined, 'a');
  os.addAgent(2, undefined, undefined, 'corner');
  os.setAgentSessionName(1, 'Dirigent');
  os.rebuildFromLayout(setSeatOwner(os.getLayout(), 'corner', 'Dirigent'));
  assert.equal(os.characters.get(1)!.seatId, 'corner');
  assert.equal(
    os.characters.get(2)!.seatId,
    'a',
    'the sitter swaps into the seat Dirigent left, not just any free one',
  );
});

test('setSeatOwner trims, frees with null, and drops an empty map', () => {
  const base = office().getLayout();
  const kept = setSeatOwner(base, 'x', '  Dirigent ');
  assert.deepEqual(kept.seatOwners, { x: 'Dirigent' });
  assert.equal(setSeatOwner(kept, 'x', 'Dirigent'), kept, 'no change, same layout');
  assert.equal(setSeatOwner(kept, 'x', null).seatOwners, undefined);
});
