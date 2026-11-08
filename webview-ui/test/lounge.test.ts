/**
 * The lounge ("fikarummet", TASK-3448): idle agents leave their desk for an
 * Area with role 'lounge', sit / stroll / mingle there, and go back to their
 * own seat when they turn active. Integration through the real OfficeState,
 * plus the pure choice rules with a controlled random.
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { LOUNGE_IDLE_SEC, LOUNGE_SIT_MAX_SEC, LOUNGE_SIT_MIN_SEC } from '../src/constants.js';
import { setAreaRole } from '../src/office/editor/editorActions.js';
import type { LoungeContext } from '../src/office/engine/lounge.js';
import { advanceLounge, loungeTileKeys, planLoungeActivity } from '../src/office/engine/lounge.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { Character, OfficeLayout, Seat } from '../src/office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

const COLS = 12;
const ROWS = 9;
const inLounge = (col: number) => col >= 8;

function layout(withLounge = true): OfficeLayout {
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture: [],
    areas: [
      {
        label: 'Fikarummet',
        color: 'area-color',
        ...(withLounge ? { role: 'lounge' as const } : {}),
      },
    ],
    areaTiles: tiles.map((_, i) => (inLounge(i % COLS) ? 'Fikarummet' : null)),
  };
}

function place(ch: Character, col: number, row: number): void {
  ch.tileCol = col;
  ch.tileRow = row;
  ch.x = col * TILE_SIZE + TILE_SIZE / 2;
  ch.y = row * TILE_SIZE + TILE_SIZE / 2;
  ch.path = [];
}

const seat = (uid: string, col: number, row: number, assigned = false): Seat => ({
  uid,
  seatCol: col,
  seatRow: row,
  facingDir: Direction.DOWN,
  assigned,
});

/** One agent at its desk (1,4), idle for `idleSec`, plus a sofa seat in the lounge. */
function office(idleSec: number, withLounge = true) {
  const os = new OfficeState(layout(withLounge));
  os.seats.set('desk', seat('desk', 1, 4, true));
  os.seats.set('sofa', seat('sofa', 10, 2));
  os.addAgent(1, 0, 0, undefined, true);
  const ch = os.characters.get(1)!;
  ch.seatId = 'desk';
  ch.isActive = false;
  place(ch, 1, 4);
  ch.state = CharacterState.IDLE;
  os.setAgentIdleSince(1, Date.now() - idleSec * 1000);
  return { os, ch };
}

function run(os: OfficeState, sec: number, each?: () => void): void {
  for (let t = 0; t < sec; t += 0.05) {
    os.update(0.05);
    each?.();
  }
}

test('setAreaRole turns the lounge role on and off; only lounge tiles count', () => {
  const plain = layout(false);
  assert.equal(loungeTileKeys(plain).size, 0);
  const on = setAreaRole(plain, 'Fikarummet', 'lounge');
  assert.equal(on.areas?.[0].role, 'lounge');
  assert.equal(loungeTileKeys(on).size, 4 * ROWS);
  const off = setAreaRole(on, 'Fikarummet', undefined);
  assert.equal(off.areas?.[0].role, undefined);
  assert.equal(setAreaRole(off, 'Fikarummet', undefined), off, 'no change → same layout');
});

test('idle for 5 minutes → goes to the lounge; less, or no lounge area → stays', () => {
  const short = office(LOUNGE_IDLE_SEC - 30);
  run(short.os, 2);
  assert.equal(short.ch.lounge, undefined, 'not idle long enough');

  const none = office(LOUNGE_IDLE_SEC + 30, false);
  run(none.os, 2);
  assert.equal(none.ch.lounge, undefined, 'no lounge Area');

  const long = office(LOUNGE_IDLE_SEC + 30);
  run(long.os, 0.1);
  assert.ok(long.ch.lounge, 'set off for the lounge');
  run(long.os, 8, () => undefined);
  assert.ok(inLounge(long.ch.tileCol), `in the lounge (col ${long.ch.tileCol})`);
});

test('an adopted agent still flagged active, but idle per the server, lounges too', () => {
  const { os, ch } = office(LOUNGE_IDLE_SEC + 30);
  ch.isActive = true; // the character default, never corrected for an adopted idle agent
  run(os, 10);
  assert.ok(ch.lounge && inLounge(ch.tileCol), 'idleSince decides, not the stale isActive');
});

test('waiting for input or for an approval is not idle', () => {
  const waiting = office(LOUNGE_IDLE_SEC + 30);
  waiting.ch.waitingAwaitingInput = true;
  run(waiting.os, 2);
  assert.equal(waiting.ch.lounge, undefined);

  const approval = office(LOUNGE_IDLE_SEC + 30);
  approval.ch.bubbleType = 'permission';
  run(approval.os, 2);
  assert.equal(approval.ch.lounge, undefined);
});

test('turning active leaves the lounge and walks back to its own seat', () => {
  const { os, ch } = office(LOUNGE_IDLE_SEC + 30);
  run(os, 10);
  assert.ok(ch.lounge && inLounge(ch.tileCol), 'lounging');
  ch.isActive = true;
  os.setAgentIdleSince(1, undefined);
  run(os, 15);
  assert.equal(ch.lounge, undefined);
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, { col: 1, row: 4 }, 'back at its desk');
});

test('two loungers never share a seat', () => {
  const { os } = office(LOUNGE_IDLE_SEC + 30);
  os.addAgent(2, 1, 0, undefined, true);
  const b = os.characters.get(2)!;
  b.isActive = false;
  place(b, 1, 6);
  b.state = CharacterState.IDLE;
  os.setAgentIdleSince(2, Date.now() - (LOUNGE_IDLE_SEC + 30) * 1000);
  const a = os.characters.get(1)!;
  run(os, 120, () => {
    if (a.lounge?.seatUid && b.lounge?.seatUid) assert.notEqual(a.lounge.seatUid, b.lounge.seatUid);
  });
});

/** A pure context: lounge = cols 8-11, open floor, straight-line "paths". */
function ctx(chars: Character[], seats: Seat[], fullTiles = false): LoungeContext {
  const keys = loungeTileKeys(layout());
  const walkable: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) walkable.push({ col: c, row: r });
  return {
    keys,
    characters: chars,
    seats,
    walkableTiles: fullTiles ? walkable.filter((t) => !inLounge(t.col)) : walkable,
    pathTo: (_ch, col, row) => [{ col, row }],
    freeTileBeside: (col, row) => ({ col: col - 1, row }),
  };
}

const lounger = (id: number, extra: Partial<Character> = {}) =>
  ({ id, tileCol: 1, tileRow: 1, path: [], ...extra }) as Character;

test('a free lounge seat is taken; an assigned or claimed one is not', () => {
  const me = lounger(1);
  const sitFirst = () => 0; // chooseActivity: 0 → the first possible activity (sit)
  assert.ok(planLoungeActivity(me, ctx([me], [seat('sofa', 10, 2)]), sitFirst));
  assert.equal(me.lounge?.activity, 'sit');
  assert.equal(me.lounge?.seatUid, 'sofa');

  const other = lounger(2, {
    lounge: { phase: 'resting', activity: 'sit', seatUid: 'sofa', timer: 5 },
  });
  const me2 = lounger(1);
  planLoungeActivity(
    me2,
    ctx([me2, other], [seat('sofa', 10, 2), seat('desk', 9, 2, true)]),
    sitFirst,
  );
  assert.notEqual(me2.lounge?.activity, 'sit', 'claimed and assigned seats are full → no sitting');
  assert.ok(me2.lounge, 'it strolls or mingles instead');
});

test('seats and lounge tiles all full → stays put (false)', () => {
  const me = lounger(1);
  assert.equal(
    planLoungeActivity(me, ctx([me], [], true), () => 0),
    false,
  );
  assert.equal(me.lounge, undefined);
});

test('arriving at a lounge seat sits it down for 30-90 s, then asks for the next activity', () => {
  const sofa = seat('sofa', 10, 2);
  const me = lounger(1, { tileCol: 10, tileRow: 2 });
  planLoungeActivity(me, { ...ctx([me], [sofa]), pathTo: () => [] }, () => 0);
  const seats = new Map([['sofa', sofa]]);
  const noStep = () => undefined;
  assert.equal(
    advanceLounge(me, 0.05, seats, undefined, noStep, () => 0.5),
    'resting',
  );
  assert.equal(me.state, CharacterState.TYPE, 'sitting');
  assert.equal(me.dir, sofa.facingDir);
  const timer = me.lounge!.timer;
  assert.ok(timer >= LOUNGE_SIT_MIN_SEC && timer <= LOUNGE_SIT_MAX_SEC, `sits ${timer} s`);
  assert.equal(
    advanceLounge(me, timer + 0.1, seats, undefined, noStep, () => 0.5),
    'next',
  );
});

test('mingling: both turn to face each other and the partner stays for the chat', () => {
  const partner = lounger(2, {
    tileCol: 9,
    tileRow: 4,
    dir: Direction.LEFT,
    lounge: { phase: 'resting', activity: 'sit', timer: 1 },
  });
  const me = lounger(1, { tileCol: 9, tileRow: 2 });
  planLoungeActivity(
    me,
    {
      ...ctx([me, partner], [], true),
      pathTo: () => [],
      freeTileBeside: () => ({ col: 9, row: 3 }),
    },
    () => 0,
  );
  assert.equal(me.lounge?.activity, 'mingle');
  me.tileRow = 3; // arrived beside the partner
  advanceLounge(
    me,
    0.05,
    new Map(),
    partner,
    () => undefined,
    () => 0.5,
  );
  assert.equal(me.dir, Direction.DOWN, 'faces the partner below');
  assert.equal(partner.dir, Direction.UP, 'the partner faces back up');
  assert.ok(partner.lounge!.timer >= me.lounge!.timer, 'the partner stays at least as long');
});

test('a seated chat partner turns back to its seat when the mingle ends', () => {
  const sofa = seat('sofa', 9, 4);
  const seats = new Map([['sofa', sofa]]);
  const partner = lounger(2, {
    tileCol: 9,
    tileRow: 4,
    dir: Direction.DOWN,
    lounge: { phase: 'resting', activity: 'sit', seatUid: 'sofa', timer: 60 },
  });
  const me = lounger(1, { tileCol: 10, tileRow: 4 });
  me.lounge = { phase: 'walking', activity: 'mingle', partnerId: 2, timer: 0 };
  advanceLounge(
    me,
    0.05,
    seats,
    partner,
    () => undefined,
    () => 0.5,
  );
  assert.equal(partner.dir, Direction.RIGHT, 'turned to the chat');
  assert.equal(
    advanceLounge(
      me,
      100,
      seats,
      partner,
      () => undefined,
      () => 0.5,
    ),
    'next',
  );
  assert.equal(partner.dir, sofa.facingDir, 'back to facing the way the seat does');
});
