/**
 * Sub-agents work at a free computer near their parent instead of "sitting"
 * on bare floor beside it (Rasmus 2026-11-08, first part of TASK-3459).
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

function office() {
  const layout: OfficeLayout = {
    version: 1,
    cols: 10,
    rows: 10,
    tiles: new Array<TileType>(100).fill(TileType.FLOOR_1),
    furniture: [],
  };
  const os = new OfficeState(layout);
  const seat = (uid: string, col: number, row: number) => ({
    uid,
    seatCol: col,
    seatRow: row,
    facingDir: Direction.DOWN,
    assigned: false,
  });
  os.seats.set('lead', seat('lead', 2, 2)); // addAgent takes it
  os.seats.set('near', seat('near', 3, 2));
  os.seats.set('far', seat('far', 8, 8));
  os.addAgent(1, 0, 0, 'lead', true);
  assert.equal(os.characters.get(1)!.seatId, 'lead');
  const lead = os.characters.get(1)!;
  lead.tileCol = 2;
  lead.tileRow = 2;
  lead.x = 2 * TILE_SIZE + TILE_SIZE / 2;
  lead.y = 2 * TILE_SIZE + TILE_SIZE / 2;
  return os;
}

function run(os: OfficeState, sec: number) {
  for (let t = 0; t < sec; t += 0.05) os.update(0.05);
}

test('a sub-agent takes the free seat closest to its parent and sits down there', () => {
  const os = office();
  const id = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  assert.equal(sub.seatId, 'near');
  assert.equal(os.seats.get('near')!.assigned, true);
  sub.isActive = true;
  run(os, 6);
  assert.deepEqual({ col: sub.tileCol, row: sub.tileRow }, { col: 3, row: 2 });
  assert.equal(sub.state, CharacterState.TYPE, 'sits at the seat, not on the floor');
});

test('removing the sub-agent frees its seat', () => {
  const os = office();
  os.addSubagent(1, 'tool-1');
  os.removeSubagent(1, 'tool-1');
  assert.equal(os.seats.get('near')!.assigned, false);
});

test('with every seat taken a sub-agent stands instead of sitting on the floor', () => {
  const os = office();
  for (const s of os.seats.values()) s.assigned = true;
  const id = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  assert.equal(sub.seatId, null);
  sub.isActive = true;
  run(os, 2);
  assert.notEqual(sub.state, CharacterState.TYPE);
});

test('a finished sub-agent walks to its lead, says it is done, then vanishes', () => {
  const os = office();
  const id = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  run(os, 3); // seated at 'near'
  os.removeSubagent(1, 'tool-1');
  assert.equal(os.seats.get('near')!.assigned, false, 'its computer is free at once');
  assert.equal(sub.matrixEffect, null, 'still here: it goes to report first');
  assert.equal(sub.visit?.targetId, 1);
  let said: string | undefined;
  for (let t = 0; t < 15 && os.characters.has(id); t += 0.05) {
    os.update(0.05);
    if (sub.visit?.phase === 'talking') said = sub.visit.summary;
  }
  assert.equal(said, 'Klart!');
  assert.equal(os.characters.has(id), false, 'gone after the report');
});

test('a sub-agent that cannot reach its lead vanishes after the report time-out', () => {
  const os = office();
  const id = os.addSubagent(1, 'tool-1');
  os.removeSubagent(1, 'tool-1');
  const sub = os.characters.get(id)!;
  sub.reportTimer = 0.1;
  sub.path = [];
  run(os, 1);
  assert.equal(os.characters.has(id), false);
});

test('when the lead itself is gone the sub-agent vanishes at once', () => {
  const os = office();
  const id = os.addSubagent(1, 'tool-1');
  os.characters.get(1)!.matrixEffect = 'despawn';
  os.removeSubagent(1, 'tool-1');
  assert.equal(os.characters.get(id)!.matrixEffect, 'despawn');
});
