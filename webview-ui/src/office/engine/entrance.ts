import { DOOR_EXIT_TIMEOUT_SEC, DOOR_OPEN_SEC } from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import type { Character, OfficeLayout } from '../types.js';
import { CharacterState, Direction, TileType } from '../types.js';

/**
 * The entrance (TASK-3456): a new agent materializes (matrix effect) just
 * outside the door while it swings open, then walks in through the doorway
 * to its seat; a leaving one walks to the door, out through it, and
 * dematerializes just outside. The entrance is the
 * first `door` item in a wall line (on a wall tile, or filling a floor gap in
 * it) with walkable floor to its north and nothing walkable to its south: a door in a room's bottom wall, which we see
 * from outside, so a character stands in the doorway in front of it. Without
 * one, spawning and despawning stay as they were.
 */
export interface Entrance {
  uid: string;
  col: number;
  /** The wall row the door hangs in: the doorway a character stands in. */
  doorRow: number;
  /** The floor tile just inside. */
  insideRow: number;
  /** The tile just outside, where a character materializes and dematerializes. */
  outsideRow: number;
}

export function findEntrance(layout: OfficeLayout): Entrance | null {
  const at = (c: number, r: number) =>
    r >= 0 && r < layout.rows && c >= 0 && c < layout.cols
      ? layout.tiles[r * layout.cols + c]
      : undefined;
  const walkable = (t: number | undefined) =>
    t !== undefined && t !== TileType.WALL && t !== TileType.VOID;
  for (const f of layout.furniture) {
    const entry = getCatalogEntry(f.type);
    if (!entry?.door) continue;
    const doorRow = f.row + entry.footprintH - 1;
    // The door hangs in a wall, or fills a gap left in it (a floor tile in
    // the wall line, so the open door shows the real floor through it).
    const doorTile = at(f.col, doorRow);
    if (doorTile !== TileType.WALL && !walkable(doorTile)) continue;
    if (!walkable(at(f.col, doorRow - 1)) || walkable(at(f.col, doorRow + 1))) continue;
    return { uid: f.uid, col: f.col, doorRow, insideRow: doorRow - 1, outsideRow: doorRow + 1 };
  }
  return null;
}

/** Walking out through the entrance. */
export function isLeaving(ch: Character): boolean {
  const p = ch.doorway?.phase;
  return p === 'toDoor' || p === 'exit';
}

/** Someone is at the door or passing through it: it should be open. */
export function doorWanted(characters: Iterable<Character>, e: Entrance): boolean {
  for (const ch of characters) {
    const p = ch.doorway?.phase;
    if (!p) continue;
    if (p !== 'toDoor') return true;
    if (ch.path.length === 0 && ch.tileCol === e.col && ch.tileRow === e.insideRow) return true;
  }
  return false;
}

/** Openness 0 (shut) … 1 (open), moving toward `wanted` over DOOR_OPEN_SEC. */
export function advanceOpenness(openness: number, wanted: boolean, dt: number): number {
  const step = dt / DOOR_OPEN_SEC;
  return wanted ? Math.min(1, openness + step) : Math.max(0, openness - step);
}

/** Which frame the door shows: 0 shut, then its opening frames. */
export function doorFrame(openness: number, openFrames: number): number {
  return Math.round(openness * openFrames);
}

/** Put a new character just outside the door to come in (the caller starts
 *  its matrix spawn there; the doorway logic waits for that to finish). */
export function beginEntering(ch: Character, e: Entrance): void {
  ch.tileCol = e.col;
  ch.tileRow = e.outsideRow;
  ch.x = e.col * 16 + 8;
  ch.y = e.outsideRow * 16 + 8;
  ch.path = [];
  ch.moveProgress = 0;
  ch.state = CharacterState.IDLE;
  ch.dir = Direction.UP;
  ch.doorway = { phase: 'appear', timer: 0 };
}

/** Send a character (its path to the inside tile already set) out. */
export function beginLeaving(ch: Character): void {
  ch.doorway = { phase: 'toDoor', timer: 0 };
  ch.state = ch.path.length > 0 ? CharacterState.WALK : CharacterState.IDLE;
  ch.moveProgress = 0;
  ch.frame = 0;
}

/**
 * One frame at the door (runs once any matrix effect is over). Returns
 * 'entered' when a newcomer has stepped inside (the caller sends it to its
 * seat), 'out' when a leaver has stepped out through the door (the caller
 * starts its matrix despawn there), 'timeout' when a leaver never reached the door (the
 * caller despawns it where it is).
 */
export function advanceDoorway(
  ch: Character,
  e: Entrance,
  openness: number,
  dt: number,
  step: (ch: Character, dt: number) => void,
): 'busy' | 'entered' | 'out' | 'timeout' {
  const d = ch.doorway;
  if (!d) return 'busy';
  d.timer += dt;
  switch (d.phase) {
    case 'appear':
      if (openness >= 1) {
        d.phase = 'enter';
        ch.path = [
          { col: e.col, row: e.doorRow },
          { col: e.col, row: e.insideRow },
        ];
        ch.state = CharacterState.WALK;
      }
      return 'busy';
    case 'enter':
      if (ch.path.length > 0) {
        step(ch, dt);
        return 'busy';
      }
      ch.doorway = undefined;
      ch.state = CharacterState.IDLE;
      return 'entered';
    case 'toDoor':
      if (d.timer > DOOR_EXIT_TIMEOUT_SEC) return 'timeout';
      if (ch.path.length > 0) {
        step(ch, dt);
        return 'busy';
      }
      ch.state = CharacterState.IDLE;
      ch.dir = Direction.DOWN;
      if (openness >= 1) {
        d.phase = 'exit';
        ch.path = [
          { col: e.col, row: e.doorRow },
          { col: e.col, row: e.outsideRow },
        ];
        ch.state = CharacterState.WALK;
      }
      return 'busy';
    case 'exit':
      if (ch.path.length > 0) {
        step(ch, dt);
        return 'busy';
      }
      ch.doorway = undefined;
      ch.state = CharacterState.IDLE;
      return 'out';
  }
}
