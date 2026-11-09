import { AUTO_ON_FACING_DEPTH, AUTO_ON_SIDE_DEPTH } from '../../constants.js';
import type { Character, Seat } from '../types.js';
import { CharacterState, Direction } from '../types.js';

/**
 * Working at its desk right now: active, not idle per the server, and
 * actually SITTING on its own seat. A character away from the seat (walking,
 * visiting another agent, in the lounge) or an adopted agent that still
 * carries the default `isActive` while the server reports it idle does not
 * count — those were what left screens on at empty desks.
 */
export function isWorkingAtDesk(ch: Character, seat: Seat | undefined, idle: boolean): boolean {
  if (!ch.isActive || idle || !seat || ch.visit || ch.lounge) return false;
  if (ch.matrixEffect === 'despawn') return false; // its session ended
  return (
    ch.state === CharacterState.TYPE && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow
  );
}

/**
 * Tiles whose electronics turn ON: for every seat whose agent isWorkingAtDesk,
 * the ONE nearest tile holding electronics in front of it — straight ahead
 * first, then beside that line, one step deeper at a time (up to
 * AUTO_ON_FACING_DEPTH ahead, AUTO_ON_SIDE_DEPTH for the sides). Only the
 * nearest: at a shared table the agent's own side monitor must win over the
 * front-facing PC two tiles on, even when the side monitor has no ON look.
 */
export function collectAutoOnTiles(
  characters: Iterable<Character>,
  seats: Map<string, Seat>,
  isIdle: (id: number) => boolean,
  hasElectronics: (col: number, row: number) => boolean,
): Set<string> {
  const tiles = new Set<string>();
  for (const ch of characters) {
    const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
    if (!seat || !isWorkingAtDesk(ch, seat, isIdle(ch.id))) continue;
    const dCol =
      seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
    const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
    const hit = nearestElectronics(seat, dCol, dRow, hasElectronics);
    if (hit) tiles.add(hit);
  }
  return tiles;
}

function nearestElectronics(
  seat: Seat,
  dCol: number,
  dRow: number,
  has: (col: number, row: number) => boolean,
): string | null {
  for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
    const col = seat.seatCol + dCol * d;
    const row = seat.seatRow + dRow * d;
    const candidates: Array<[number, number]> = [[col, row]];
    if (d <= AUTO_ON_SIDE_DEPTH) {
      if (dCol !== 0) candidates.push([col, row - 1], [col, row + 1]);
      else candidates.push([col - 1, row], [col + 1, row]);
    }
    for (const [c, r] of candidates) if (has(c, r)) return `${c},${r}`;
  }
  return null;
}

/**
 * Which frame of an ON animation a placed item shows: the shared clock,
 * shifted by a stable per-item offset (from its uid). Two arcade machines
 * side by side then sit at different points of a long multi-game loop
 * instead of playing the same game in lockstep.
 */
export function animationFrameFor(uid: string, clockFrame: number, frameCount: number): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) h = Math.imul(h ^ uid.charCodeAt(i), 16777619);
  return (((clockFrame + (h >>> 0)) % frameCount) + frameCount) % frameCount;
}
