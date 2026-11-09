import { ATTENTION_DELAY_SEC } from '../../constants.js';
import type { AreaRole, Character, OfficeLayout } from '../types.js';
import { CharacterState, Direction } from '../types.js';

/** Where an agent waiting on Rasmus stands, and whether it has got there. */
export interface AttentionState {
  col: number;
  row: number;
  arrived: boolean;
}

/** "col,row" keys of every tile painted with an Area whose role is `role`. */
export function roleTileKeys(layout: OfficeLayout, role: AreaRole): Set<string> {
  const labels = new Set((layout.areas ?? []).filter((a) => a.role === role).map((a) => a.label));
  const keys = new Set<string>();
  if (labels.size === 0 || !layout.areaTiles) return keys;
  layout.areaTiles.forEach((label, idx) => {
    if (label && labels.has(label))
      keys.add(`${idx % layout.cols},${Math.floor(idx / layout.cols)}`);
  });
  return keys;
}

/** Waiting on Rasmus: an answer (waiting for input) or an approval (permission bubble). */
export function needsRasmus(ch: Character): boolean {
  if (ch.isSubagent || ch.visit || ch.doorway || ch.matrixEffect) return false;
  if (ch.bubbleType === 'permission') return true;
  // The flag outlives the wait (only the next turn end rewrites it): an
  // agent that got its answer is active again and belongs at its desk.
  return ch.waitingAwaitingInput === true && !ch.isActive;
}

/** Has needed Rasmus long enough to go and stand in the zone (a quick approval keeps it at its desk). */
export function wantsAttention(needSince: number | undefined, now: number): boolean {
  return needSince !== undefined && now - needSince >= ATTENTION_DELAY_SEC * 1000;
}

/**
 * The free zone tile nearest to the character: walkable, not someone else's
 * spot, not where someone else stands. Null when the zone is full.
 */
export function pickAttentionTile(
  ch: Character,
  keys: Set<string>,
  walkable: ReadonlySet<string>,
  others: Iterable<Character>,
): { col: number; row: number } | null {
  const taken = new Set<string>();
  for (const o of others) {
    if (o.id === ch.id) continue;
    if (o.attention) taken.add(`${o.attention.col},${o.attention.row}`);
    taken.add(`${o.tileCol},${o.tileRow}`);
  }
  let best: { col: number; row: number } | null = null;
  let bestD = Infinity;
  for (const key of keys) {
    if (taken.has(key) || !walkable.has(key)) continue;
    const [col, row] = key.split(',').map(Number);
    const d = Math.abs(col - ch.tileCol) + Math.abs(row - ch.tileRow);
    if (d < bestD) {
      bestD = d;
      best = { col, row };
    }
  }
  return best;
}

/** One frame of going to (or standing at) the spot; `step` walks the path. */
export function advanceAttention(
  ch: Character,
  dt: number,
  step: (ch: Character, dt: number) => void,
): void {
  const a = ch.attention!;
  if (ch.path.length > 0) {
    ch.state = CharacterState.WALK;
    step(ch, dt);
    return;
  }
  if (!a.arrived) {
    a.arrived = true;
    ch.frame = 0;
  }
  ch.state = CharacterState.IDLE;
  ch.dir = Direction.DOWN; // face the room, so Rasmus sees who waits
}
