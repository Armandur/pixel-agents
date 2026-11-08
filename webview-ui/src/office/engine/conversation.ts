import {
  CONVERSATION_QUEUE_MAX,
  CONVERSATION_TALK_SEC,
  CONVERSATION_WAIT_SEC,
} from '../../constants.js';
import type { Character, Direction } from '../types.js';
import { CharacterState, Direction as Dir } from '../types.js';

/** A message one agent sent another: walk over, say `summary`, walk back. */
export interface VisitRequest {
  targetId: number;
  summary?: string;
}

/** The visit in progress on the sender. While set, it replaces the
 *  character FSM: the sender walks its path, then stands and talks. */
export interface Visit extends VisitRequest {
  phase: 'going' | 'talking';
  talkTimer: number;
  /** The recipient's facing before it turned to the sender (restored after). */
  targetPrevDir?: Direction;
  /** The recipient destination the current path leads next to (see visitDestination). */
  anchor?: { col: number; row: number };
  /** Seconds spent at the end of the path without the recipient beside it. */
  waited: number;
  /** Already re-aimed at the recipient's live tile once after waiting too long. */
  retried?: boolean;
}

/**
 * Where the recipient is heading, which is where the sender should go: the
 * end of its path while it walks, its seat while it is active (a message
 * usually makes it start a turn and walk there), else the tile it stands on.
 * Aiming at the live tile sent the sender to an empty chair the recipient
 * had just left.
 */
export function visitDestination(
  target: Pick<Character, 'path' | 'isActive' | 'tileCol' | 'tileRow' | 'visit'>,
  seat: { seatCol: number; seatRow: number } | undefined,
): { col: number; row: number } {
  const last = target.path[target.path.length - 1];
  if (last) return { col: last.col, row: last.row };
  // A recipient out on its own visit is where that visit put it, not at its
  // seat — answering an agent that just came over must not send you to its
  // empty chair.
  if (!target.visit && target.isActive && seat) return { col: seat.seatCol, row: seat.seatRow };
  return { col: target.tileCol, row: target.tileRow };
}

/** Start now, wait behind the current visit, or drop when the queue is full. */
export function requestVisit(ch: Character, req: VisitRequest): 'start' | 'queued' | 'dropped' {
  if (!ch.visit) return 'start';
  ch.visitQueue ??= [];
  if (ch.visitQueue.length >= CONVERSATION_QUEUE_MAX) return 'dropped';
  ch.visitQueue.push(req);
  return 'queued';
}

/** The facing from one tile toward another, on the dominant axis. */
export function facingToward(
  from: { tileCol: number; tileRow: number },
  to: { tileCol: number; tileRow: number },
): Direction {
  const dc = to.tileCol - from.tileCol;
  const dr = to.tileRow - from.tileRow;
  if (Math.abs(dc) >= Math.abs(dr) && dc !== 0) return dc > 0 ? Dir.RIGHT : Dir.LEFT;
  return dr > 0 ? Dir.DOWN : Dir.UP;
}

/** Begin a visit whose path to the recipient is already on `ch.path`. */
export function beginVisit(
  ch: Character,
  req: VisitRequest,
  anchor?: { col: number; row: number },
): void {
  ch.visit = { ...req, phase: 'going', talkTimer: CONVERSATION_TALK_SEC, anchor, waited: 0 };
  ch.state = ch.path.length > 0 ? CharacterState.WALK : CharacterState.IDLE;
  ch.moveProgress = 0;
  ch.frame = 0;
  ch.frameTimer = 0;
}

/**
 * One frame of a visit. Going: walk (via `step`) until the path is done, then
 * both turn to face each other. Talking: stand still until the talk timer
 * runs out. Returns 'done' once the visit is over and cleared — the caller
 * then starts the next queued request, if any. A recipient that left the
 * office ends the visit.
 */
export function advanceVisit(
  ch: Character,
  target: Character | undefined,
  dt: number,
  step: (ch: Character, dt: number) => void,
): 'going' | 'talking' | 'done' {
  const visit = ch.visit;
  if (!visit) return 'done';
  if (!target) return endVisit(ch, undefined);

  if (visit.phase === 'going') {
    if (ch.path.length > 0) {
      step(ch, dt);
      return 'going';
    }
    // Talk only beside the recipient itself; until it gets there, wait (the
    // caller re-aims if it changes course or takes too long). After one
    // re-aim, a recipient that still cannot be reached is talked to anyway.
    const apart = Math.abs(ch.tileCol - target.tileCol) + Math.abs(ch.tileRow - target.tileRow);
    if (apart !== 1 && !(visit.retried && visit.waited >= CONVERSATION_WAIT_SEC)) {
      visit.waited += dt;
      ch.state = CharacterState.IDLE;
      ch.frame = 0;
      return 'going';
    }
    visit.phase = 'talking';
    ch.state = CharacterState.IDLE;
    ch.frame = 0;
    ch.dir = facingToward(ch, target);
    visit.targetPrevDir = target.dir;
    target.dir = facingToward(target, ch);
    return 'talking';
  }

  visit.talkTimer -= dt;
  if (visit.talkTimer > 0) return 'talking';
  return endVisit(ch, target);
}

function endVisit(ch: Character, target: Character | undefined): 'done' {
  // A seated recipient goes back to facing its desk; one that got up keeps
  // whatever its own FSM gave it since.
  if (target && ch.visit?.targetPrevDir !== undefined && target.state === CharacterState.TYPE) {
    target.dir = ch.visit.targetPrevDir;
  }
  ch.visit = undefined;
  ch.path = [];
  ch.state = CharacterState.IDLE;
  ch.frame = 0;
  return 'done';
}
