/**
 * Agent-to-agent conversations (TASK-3428), through the real OfficeState:
 * startConversation walks the sender next to the recipient, both face each
 * other while it talks, then the visit ends and any queued one starts.
 */
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { CONVERSATION_QUEUE_MAX, CONVERSATION_TALK_SEC } from '../src/constants.js';
import { facingToward } from '../src/office/engine/conversation.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { Character, OfficeLayout } from '../src/office/types.js';
import { Direction, TILE_SIZE, TileType } from '../src/office/types.js';

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
