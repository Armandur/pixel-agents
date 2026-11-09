/**
 * Meetings (TASK-3523): a message is a desk visit; an answer within
 * MEETING_REPLY_SEC sits both agents down in the meeting room, where every
 * new message shows over its sender. MEETING_IDLE_SEC of silence ends it.
 */
import assert from 'node:assert/strict';

import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';

import {
  CROWNED_NAME_COLOR,
  MEETING_IDLE_SEC,
  MEETING_REPLY_SEC,
  MEETING_TALK_SEC,
} from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';

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

let clock = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = 1_000_000;
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());

/** A 10x6 room: desk stools at (1..3,1), a meeting room (cols 6-8, rows 1-4) with stools at (6,2),(8,2). */
function office(withRoom = true) {
  const cols = 10;
  const rows = 6;
  const tiles: number[] = [];
  const areaTiles: (string | null)[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      tiles.push(
        r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? TileType.WALL : TileType.FLOOR_1,
      );
      areaTiles.push(withRoom && c >= 6 && c <= 8 && r >= 1 && r <= 4 ? 'Konferens' : null);
    }
  return new OfficeState({
    version: 1,
    cols,
    rows,
    tiles,
    furniture: [
      { uid: 'd1', type: 'STOOL', col: 1, row: 1 },
      { uid: 'd2', type: 'STOOL', col: 2, row: 1 },
      { uid: 'd3', type: 'STOOL', col: 3, row: 1 },
      { uid: 'm1', type: 'STOOL', col: 6, row: 2 },
      { uid: 'm2', type: 'STOOL', col: 8, row: 2 },
    ],
    areas: [{ label: 'Konferens', color: CROWNED_NAME_COLOR, role: 'meeting' }],
    areaTiles,
  } as OfficeLayout);
}

function run(os: OfficeState, sec: number) {
  for (let t = 0; t < sec; t += 0.05) {
    clock += 50;
    vi.setSystemTime(clock);
    os.update(0.05);
  }
}

const at = (os: OfficeState, id: number) => {
  const c = os.characters.get(id)!;
  return `${c.tileCol},${c.tileRow}`;
};

function two(os: OfficeState) {
  os.addAgent(1, undefined, undefined, undefined, true);
  os.addAgent(2, undefined, undefined, undefined, true);
  return [at(os, 1), at(os, 2)];
}

test('new agents get desk stools, not the meeting room', () => {
  const os = office();
  const homes = two(os);
  for (const h of homes) assert.ok(['1,1', '2,1', '3,1'].includes(h), h);
});

test('a reply before the first message was said brings that message along', () => {
  const os = office();
  two(os);
  os.startConversation(1, 2, 'fråga');
  os.startConversation(2, 1, 'svar'); // at once: 1 never reached 2's desk
  const m = [...os.meetings.values()][0];
  assert.deepEqual(
    m.pending.map((p) => p.summary),
    ['fråga', 'svar'],
  );
});

test('a single message is a desk visit, not a meeting', () => {
  const os = office();
  two(os);
  os.startConversation(1, 2, 'hej');
  assert.ok(os.characters.get(1)!.visit, 'visiting');
  assert.equal(os.meetings.size, 0);
});

test('an answer within the reply window sits both down in the meeting room', () => {
  const os = office();
  const homes = two(os);
  os.startConversation(1, 2, 'fråga');
  run(os, 5);
  os.startConversation(2, 1, 'svar');
  assert.equal(os.meetings.size, 1);
  assert.equal(os.characters.get(1)!.visit, undefined, 'the visit gave way to the meeting');
  run(os, 0.1);
  assert.equal(os.meetingLine(2), undefined, 'nothing is said on the way there');
  const seated = () => [1, 2].every((id) => os.characters.get(id)!.meeting?.arrived);
  for (let t = 0; t < 10 && !seated(); t += 0.05) run(os, 0.05);
  run(os, 0.1);
  assert.deepEqual([at(os, 1), at(os, 2)].sort(), ['6,2', '8,2']);
  for (const id of [1, 2])
    assert.equal(os.characters.get(id)!.state, CharacterState.TYPE, 'sitting');
  assert.equal(os.meetingLine(2), 'svar', 'once both sit, the reply is said');
  os.startConversation(1, 2, 'en till');
  assert.equal(os.meetingLine(1), undefined, 'waits for the reply to be said');
  run(os, MEETING_TALK_SEC + 0.2);
  assert.equal(os.meetingLine(1), 'en till');
  assert.equal(os.meetingLine(2), undefined);
  run(os, MEETING_TALK_SEC + MEETING_IDLE_SEC - 2);
  assert.equal(os.meetings.size, 1, 'silence counts from the last line said');
  run(os, 3);
  assert.equal(os.meetings.size, 0, 'silence ends it');
  run(os, 10);
  assert.deepEqual([at(os, 1), at(os, 2)].sort(), [...homes].sort(), 'both back at their desks');
});

test('an answer after the reply window is another visit', () => {
  const os = office();
  two(os);
  os.startConversation(1, 2, 'fråga');
  run(os, MEETING_REPLY_SEC + 2);
  os.startConversation(2, 1, 'sent svar');
  assert.equal(os.meetings.size, 0);
  assert.ok(os.characters.get(2)!.visit);
});

test('without a meeting room a back-and-forth stays desk visits', () => {
  const os = office(false);
  two(os);
  os.startConversation(1, 2, 'fråga');
  os.startConversation(2, 1, 'svar');
  assert.equal(os.meetings.size, 0);
  assert.ok(os.characters.get(2)!.visit);
});
