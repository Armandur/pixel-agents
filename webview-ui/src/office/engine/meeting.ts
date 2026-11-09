import { MEETING_REPLY_SEC } from '../../constants.js';
import type { Character, Seat } from '../types.js';
import { CharacterState, Direction } from '../types.js';

/** Two agents talking back and forth, sat down in the meeting room. */
export interface Meeting {
  a: number;
  b: number;
  /** When the latest message between them was sent (ms). */
  lastAt: number;
  /** Who is speaking now, what it says, and how long it still shows. */
  speakerId?: number;
  summary?: string;
  talkTimer: number;
  /** Messages not yet said: nothing is said before both sit at the table,
   *  then one at a time, MEETING_TALK_SEC each. */
  pending: { speakerId: number; summary?: string }[];
}

/**
 * The meeting's next line once both participants sit down and the current one
 * has been said. Talking on the way there read as a conversation in the corridor.
 */
export function advanceMeetingTalk(m: Meeting, seated: boolean, dt: number, talkSec: number): void {
  m.talkTimer = Math.max(0, m.talkTimer - dt);
  if (!seated || m.talkTimer > 0) return;
  const next = m.pending.shift();
  if (next) {
    m.speakerId = next.speakerId;
    m.summary = next.summary;
    m.talkTimer = talkSec;
  } else {
    m.speakerId = undefined;
  }
}

/** A participant's chair in the meeting room, and whether it has sat down. */
export interface MeetingSeat {
  seatUid: string;
  arrived: boolean;
}

export const meetingKey = (x: number, y: number): string => (x < y ? `${x}-${y}` : `${y}-${x}`);

/** A message is a reply when the other one wrote to the sender within MEETING_REPLY_SEC. */
export function isReply(
  lastSent: ReadonlyMap<string, number>,
  fromId: number,
  toId: number,
  now: number,
): boolean {
  const sent = lastSent.get(`${toId}>${fromId}`);
  return sent !== undefined && now - sent <= MEETING_REPLY_SEC * 1000;
}

const opposite = (a: Direction, b: Direction): boolean =>
  (a === Direction.UP && b === Direction.DOWN) ||
  (a === Direction.DOWN && b === Direction.UP) ||
  (a === Direction.LEFT && b === Direction.RIGHT) ||
  (a === Direction.RIGHT && b === Direction.LEFT);

/**
 * Two free meeting-room chairs, preferably across the table from each other
 * (facing each other on the same column or row, nearest pair first). Null
 * when fewer than two are free.
 */
export function pickMeetingSeats(
  seats: Iterable<Seat>,
  keys: ReadonlySet<string>,
  claimed: ReadonlySet<string>,
): [Seat, Seat] | null {
  const free = [...seats].filter(
    (s) => keys.has(`${s.seatCol},${s.seatRow}`) && !s.assigned && !claimed.has(s.uid),
  );
  if (free.length < 2) return null;
  let best: [Seat, Seat] | null = null;
  let bestD = Infinity;
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const [s, t] = [free[i], free[j]];
      const across =
        opposite(s.facingDir, t.facingDir) && (s.seatCol === t.seatCol || s.seatRow === t.seatRow);
      if (!across) continue;
      const d = Math.abs(s.seatCol - t.seatCol) + Math.abs(s.seatRow - t.seatRow);
      if (d < bestD) {
        bestD = d;
        best = [s, t];
      }
    }
  }
  return best ?? [free[0], free[1]];
}

/** One frame of walking to the meeting chair, then sitting on it facing the table. */
export function advanceMeetingSeat(
  ch: Character,
  seat: Seat | undefined,
  dt: number,
  step: (ch: Character, dt: number) => void,
): void {
  if (ch.path.length > 0) {
    ch.state = CharacterState.WALK;
    step(ch, dt);
    return;
  }
  if (!ch.meeting!.arrived) {
    ch.meeting!.arrived = true;
    ch.frame = 0;
  }
  if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
    ch.state = CharacterState.TYPE;
    ch.dir = seat.facingDir;
  } else {
    ch.state = CharacterState.IDLE;
  }
}
