/**
 * The waiting zone (TASK-3522): an agent that has waited on Rasmus for
 * ATTENTION_DELAY_SEC walks to the attention Area and stands there; an answer
 * or approval sends it back to its seat. A quick approval keeps it at its desk.
 */
import assert from 'node:assert/strict';

import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';

import { ATTENTION_DELAY_SEC, CROWNED_NAME_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

beforeAll(() => {
  assert.ok(
    buildDynamicCatalog({
      catalog: [
        {
          id: 'STOOL',
          label: '',
          width: 16,
          height: 16,
          footprintW: 1,
          footprintH: 1,
          isDesk: false,
          category: 'chairs',
        },
      ],
      sprites: { STOOL: [['s']] },
    }),
  );
});

let clock = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = 1_000_000;
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());

/** An 8x6 room: two stools at the top, the zone (cols 5-6 of row 4) at the bottom right. */
function office(zone = true, zoneTiles = 2) {
  const cols = 8;
  const rows = 6;
  const tiles: number[] = [];
  const areaTiles: (string | null)[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const wall = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      tiles.push(wall ? TileType.WALL : TileType.FLOOR_1);
      areaTiles.push(zone && r === 4 && c >= 5 && c < 5 + zoneTiles ? 'Väntezon' : null);
    }
  const layout = {
    version: 1,
    cols,
    rows,
    tiles,
    furniture: [
      { uid: 'a', type: 'STOOL', col: 1, row: 1 },
      { uid: 'b', type: 'STOOL', col: 2, row: 1 },
      { uid: 'c', type: 'STOOL', col: 3, row: 1 },
    ],
    areas: [{ label: 'Väntezon', color: CROWNED_NAME_COLOR, role: 'attention' }],
    areaTiles,
  } as OfficeLayout;
  return new OfficeState(layout);
}

function run(os: OfficeState, sec: number) {
  for (let t = 0; t < sec; t += 0.05) {
    clock += 50;
    vi.setSystemTime(clock);
    os.update(0.05);
  }
}

function seated(os: OfficeState, id: number) {
  os.addAgent(id, undefined, undefined, undefined, true);
  const ch = os.characters.get(id)!;
  ch.isActive = true;
  return ch;
}

const inZone = (c: { tileCol: number; tileRow: number }) =>
  c.tileRow === 4 && c.tileCol >= 5 && c.tileCol <= 6;

test('a pending approval sends the agent to the zone; approving it sends it home', () => {
  const os = office();
  const ch = seated(os, 1);
  const home = [ch.tileCol, ch.tileRow];
  os.showPermissionBubble(1);
  run(os, ATTENTION_DELAY_SEC - 1);
  assert.deepEqual([ch.tileCol, ch.tileRow], home, 'still at the desk before the delay');
  run(os, 6);
  assert.ok(inZone(ch), `in the zone, at ${ch.tileCol},${ch.tileRow}`);
  os.clearPermissionBubble(1);
  run(os, 8);
  assert.equal(ch.attention, undefined);
  assert.deepEqual([ch.tileCol, ch.tileRow], home, 'back at its seat');
});

test('a quick approval keeps the agent at its desk', () => {
  const os = office();
  const ch = seated(os, 1);
  const home = [ch.tileCol, ch.tileRow];
  os.showPermissionBubble(1);
  run(os, ATTENTION_DELAY_SEC - 2);
  os.clearPermissionBubble(1);
  run(os, 8);
  assert.deepEqual([ch.tileCol, ch.tileRow], home);
  assert.equal(ch.attention, undefined);
});

test('waiting for an answer counts only while idle: the stale flag on a working agent does not', () => {
  const os = office();
  const ch = seated(os, 1);
  os.setAgentActive(1, false);
  os.showWaitingBubble(1, true);
  run(os, ATTENTION_DELAY_SEC + 6);
  assert.ok(inZone(ch), 'waiting for input: in the zone');
  os.setAgentActive(1, true); // Rasmus answered; the flag is still set
  run(os, 8);
  assert.ok(!inZone(ch), 'working again: left the zone');
});

test('two waiting agents get different spots; a full zone leaves the third where it is', () => {
  const os = office(true, 2);
  const chs = [1, 2, 3].map((id) => seated(os, id));
  const homes = chs.map((c) => [c.tileCol, c.tileRow]);
  for (const c of chs) os.showPermissionBubble(c.id);
  run(os, ATTENTION_DELAY_SEC + 8);
  const spots = chs.filter(inZone).map((c) => `${c.tileCol},${c.tileRow}`);
  assert.equal(spots.length, 2);
  assert.equal(new Set(spots).size, 2, 'never the same spot');
  const left = chs.find((c) => !inZone(c))!;
  assert.deepEqual([left.tileCol, left.tileRow], homes[chs.indexOf(left)]);
});

test('without a zone in the layout nothing moves', () => {
  const os = office(false);
  const ch = seated(os, 1);
  const home = [ch.tileCol, ch.tileRow];
  os.showPermissionBubble(1);
  run(os, ATTENTION_DELAY_SEC + 6);
  assert.deepEqual([ch.tileCol, ch.tileRow], home);
});
