/**
 * Agent-to-agent conversations (TASK-3428), through the real OfficeState:
 * startConversation walks the sender next to the recipient, both face each
 * other while it talks, then the visit ends and any queued one starts.
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  CONVERSATION_QUEUE_MAX,
  CONVERSATION_TALK_SEC,
  CONVERSATION_WAIT_SEC,
} from '../src/constants.js';
import { facingToward, visitDestination } from '../src/office/engine/conversation.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { Character, OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

function floorLayout(cols = 9, rows = 9): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

function place(ch: Character, col: number, row: number): void {
  ch.tileCol = col;
  ch.tileRow = row;
  ch.x = col * TILE_SIZE + TILE_SIZE / 2;
  ch.y = row * TILE_SIZE + TILE_SIZE / 2;
  ch.path = [];
}

function office(): { os: OfficeState; sender: Character; recipient: Character } {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0, undefined, true);
  os.addAgent(2, 1, 0, undefined, true);
  const sender = os.characters.get(1)!;
  const recipient = os.characters.get(2)!;
  place(sender, 1, 1);
  place(recipient, 7, 7);
  return { os, sender, recipient };
}

/** Advance in small frames until `done` holds or the budget runs out. */
function runUntil(os: OfficeState, done: () => boolean, maxSec = 30): void {
  for (let t = 0; t < maxSec && !done(); t += 0.05) os.update(0.05);
}

const distance = (a: Character, b: Character) =>
  Math.abs(a.tileCol - b.tileCol) + Math.abs(a.tileRow - b.tileRow);

test('the sender walks next to the recipient, both face each other, then it ends', () => {
  const { os, sender, recipient } = office();

  os.startConversation(1, 2, 'Uppdrag klart');
  assert.equal(sender.visit?.phase, 'going');
  assert.equal(sender.visit?.summary, 'Uppdrag klart');

  runUntil(os, () => sender.visit?.phase === 'talking');
  assert.equal(sender.visit?.phase, 'talking', 'arrives and starts talking');
  assert.equal(distance(sender, recipient), 1, 'stands on a tile next to the recipient');
  assert.equal(sender.dir, facingToward(sender, recipient));
  assert.equal(recipient.dir, facingToward(recipient, sender));

  runUntil(os, () => sender.visit === undefined, CONVERSATION_TALK_SEC + 1);
  assert.equal(sender.visit, undefined, 'the visit ends after the talk time');
});

test('a message while a visit runs is queued, starts next, and the queue is capped', () => {
  const { os, sender } = office();
  os.addAgent(3, 2, 0, undefined, true);
  place(os.characters.get(3)!, 1, 7);

  os.startConversation(1, 2, 'first');
  for (let i = 0; i < CONVERSATION_QUEUE_MAX + 2; i++) os.startConversation(1, 3, `queued ${i}`);
  assert.equal(sender.visitQueue?.length, CONVERSATION_QUEUE_MAX, 'extra messages are dropped');

  runUntil(os, () => sender.visit?.summary === 'queued 0');
  assert.equal(sender.visit?.targetId, 3, 'the queued visit starts after the first');
  assert.equal(sender.visitQueue?.length, CONVERSATION_QUEUE_MAX - 1);
});

test('a recipient outside the office, or the sender itself, starts nothing', () => {
  const { os, sender } = office();
  os.startConversation(1, 99, 'nobody');
  os.startConversation(1, 1, 'myself');
  assert.equal(sender.visit, undefined);
});

test('facingToward picks the dominant axis', () => {
  assert.equal(
    facingToward({ tileCol: 0, tileRow: 0 }, { tileCol: 3, tileRow: 1 }),
    Direction.RIGHT,
  );
  assert.equal(facingToward({ tileCol: 0, tileRow: 0 }, { tileCol: 0, tileRow: -2 }), Direction.UP);
});

const line = (col: number, fromRow: number, toRow: number) => {
  const steps: Array<{ col: number; row: number }> = [];
  const dir = toRow > fromRow ? 1 : -1;
  for (let r = fromRow + dir; r !== toRow + dir; r += dir) steps.push({ col, row: r });
  return steps;
};

test('visitDestination: path end while walking, seat while active, else the tile', () => {
  const seat = { seatCol: 4, seatRow: 4 };
  const at = { tileCol: 1, tileRow: 1 };
  assert.deepEqual(
    visitDestination(
      {
        ...at,
        isActive: true,
        path: [
          { col: 2, row: 1 },
          { col: 3, row: 1 },
        ],
      },
      seat,
    ),
    { col: 3, row: 1 },
  );
  assert.deepEqual(visitDestination({ ...at, isActive: true, path: [] }, seat), { col: 4, row: 4 });
  assert.deepEqual(visitDestination({ ...at, isActive: false, path: [] }, seat), {
    col: 1,
    row: 1,
  });
});

test('a walking recipient is met where it is going, not where it was', () => {
  const { os, sender, recipient } = office();
  // The recipient sets off from (7,7) up to (7,2) as the message arrives.
  recipient.path = line(7, 7, 2);
  recipient.state = CharacterState.WALK;

  os.startConversation(1, 2, 'hej');
  assert.deepEqual(sender.visit?.anchor, { col: 7, row: 2 });
  runUntil(os, () => sender.visit?.phase === 'talking');
  assert.equal(distance(sender, recipient), 1, 'beside the recipient when the talk starts');
  assert.ok(Math.abs(sender.tileRow - 2) <= 1, 'near the destination row, not the start (7)');
});

test('the sender re-aims when the recipient changes course mid-walk', () => {
  const { os, sender, recipient } = office();
  os.startConversation(1, 2, 'hej');
  os.update(0.3); // the sender is under way toward (7,7)
  recipient.path = line(7, 7, 2);
  recipient.state = CharacterState.WALK;

  runUntil(os, () => sender.visit?.phase === 'talking');
  assert.equal(sender.visit?.phase, 'talking');
  assert.equal(distance(sender, recipient), 1, 'beside the recipient after it moved');
  assert.ok(Math.abs(sender.tileRow - 2) <= 1, 'followed it toward row 2');
});

test('the walk animates: WALK state and changing frames, not a glide', () => {
  const { os, sender } = office();
  os.startConversation(1, 2, 'hej');
  const frames = new Set<number>();
  runUntil(os, () => {
    if (sender.visit?.phase === 'going' && sender.path.length > 0) {
      assert.equal(sender.state, CharacterState.WALK);
      frames.add(sender.frame);
    }
    return sender.visit?.phase === 'talking';
  });
  assert.ok(frames.size > 1, `walk frames cycled (saw ${[...frames].join(',')})`);
});

test('the recipient holds still while being talked to, then carries on', () => {
  const { os, sender, recipient } = office();
  os.startConversation(1, 2, 'hej');
  runUntil(os, () => sender.visit?.phase === 'talking');
  assert.equal(sender.visit?.phase, 'talking');

  // Mid-talk the recipient becomes active with a seat across the room: unheld
  // it would walk off at once.
  os.seats.set('far', {
    uid: 'far',
    seatCol: 1,
    seatRow: 7,
    facingDir: Direction.DOWN,
    assigned: true,
  });
  recipient.seatId = 'far';
  recipient.isActive = true;
  recipient.state = CharacterState.IDLE; // standing (it was wandering), not seated
  const held = {
    col: recipient.tileCol,
    row: recipient.tileRow,
    x: recipient.x,
    y: recipient.y,
    dir: recipient.dir,
  };
  for (let t = 0; t < CONVERSATION_TALK_SEC - 0.5; t += 0.05) {
    os.update(0.05);
    assert.deepEqual(
      {
        col: recipient.tileCol,
        row: recipient.tileRow,
        x: recipient.x,
        y: recipient.y,
        dir: recipient.dir,
      },
      held,
    );
  }
  runUntil(os, () => sender.visit === undefined, 2);
  runUntil(os, () => recipient.tileCol !== held.col || recipient.tileRow !== held.row, 10);
  assert.notDeepEqual(
    { col: recipient.tileCol, row: recipient.tileRow },
    { col: held.col, row: held.row },
    'walks to its seat after the talk',
  );
});

/** A third agent at (col,row), seated nowhere. */
function third(os: OfficeState, col: number, row: number): Character {
  os.addAgent(3, 2, 0, undefined, true);
  const ch = os.characters.get(3)!;
  place(ch, col, row);
  return ch;
}

test('a recipient talking to someone else is met where it stands, not at its seat', () => {
  const { os, sender, recipient } = office();
  third(os, 4, 7);
  os.startConversation(2, 3, 'to the third');
  runUntil(os, () => recipient.visit?.phase === 'talking');
  assert.equal(recipient.visit?.phase, 'talking');

  // Active with a seat far away: the old rule would send the sender there.
  os.seats.set('far', {
    uid: 'far',
    seatCol: 1,
    seatRow: 7,
    facingDir: Direction.DOWN,
    assigned: true,
  });
  recipient.seatId = 'far';
  recipient.isActive = true;
  const stands = { col: recipient.tileCol, row: recipient.tileRow };

  os.startConversation(1, 2, 'reply');
  assert.deepEqual(sender.visit?.anchor, stands, 'aims at the tile it stands on');
  runUntil(os, () => sender.visit?.phase === 'talking');
  assert.equal(sender.visit?.phase, 'talking');
  assert.equal(distance(sender, recipient), 1);
});

test('answering the agent that came over: no walk, talk once it is beside you', () => {
  const { os, sender, recipient } = office();
  os.startConversation(2, 1, 'hello');
  runUntil(os, () => recipient.visit?.phase === 'talking');
  const at = { col: sender.tileCol, row: sender.tileRow };

  os.startConversation(1, 2, 'hello back');
  assert.deepEqual(sender.path, [], 'does not walk');
  os.update(0.05);
  assert.equal(sender.visit?.phase, 'talking', 'talks at once: it is already beside us');
  assert.deepEqual({ col: sender.tileCol, row: sender.tileRow }, at);
  assert.equal(distance(sender, recipient), 1);
});

test('the talk waits until the recipient is actually beside the sender', () => {
  const { os, sender, recipient } = office();
  place(sender, 7, 5);
  place(recipient, 1, 7);
  recipient.path = [2, 3, 4, 5, 6, 7].map((col) => ({ col, row: 7 }));
  recipient.state = CharacterState.WALK;

  os.startConversation(1, 2, 'wait for me');
  let sawWaiting = false;
  runUntil(os, () => {
    if (
      sender.visit?.phase === 'going' &&
      sender.path.length === 0 &&
      distance(sender, recipient) > 1
    ) {
      sawWaiting = true;
    }
    if (sender.visit?.phase === 'talking') assert.equal(distance(sender, recipient), 1);
    return sender.visit?.phase === 'talking';
  });
  assert.ok(sawWaiting, 'the sender arrived first and waited');
  assert.equal(sender.visit?.phase, 'talking');
});

test('a recipient that never arrives is re-aimed at after the wait limit', () => {
  const { os, sender, recipient } = office();
  // Seated and typing in place, but its assigned seat is elsewhere: its
  // destination (the seat) is somewhere it will never walk to.
  os.seats.set('far', {
    uid: 'far',
    seatCol: 1,
    seatRow: 7,
    facingDir: Direction.DOWN,
    assigned: true,
  });
  recipient.seatId = 'far';
  recipient.isActive = true;
  recipient.state = CharacterState.TYPE;

  os.startConversation(1, 2, 'where are you');
  assert.deepEqual(sender.visit?.anchor, { col: 1, row: 7 });
  runUntil(os, () => sender.visit?.phase === 'talking', 30 + CONVERSATION_WAIT_SEC);
  assert.equal(sender.visit?.phase, 'talking');
  assert.equal(distance(sender, recipient), 1, 'ends up beside where it really is');
});
