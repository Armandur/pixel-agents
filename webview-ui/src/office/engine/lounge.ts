import {
  LOUNGE_IDLE_SEC,
  LOUNGE_SIT_MAX_SEC,
  LOUNGE_SIT_MIN_SEC,
  LOUNGE_STAND_MAX_SEC,
  LOUNGE_STAND_MIN_SEC,
} from '../../constants.js';
import type { Character, OfficeLayout, Seat } from '../types.js';
import { CharacterState } from '../types.js';
import { facingToward } from './conversation.js';

/**
 * The lounge ("fikarummet"): agents idle long enough leave their desk for an
 * Area with role 'lounge', where they take turns sitting on a free seat,
 * strolling and standing with each other — until they turn active, when they
 * head back to their own seat. Pure rules; OfficeState supplies the map.
 */

export type LoungeActivity = 'sit' | 'stroll' | 'mingle';

/** What a lounging character is doing. Replaces the FSM while set. */
export interface LoungeState {
  phase: 'walking' | 'resting';
  activity: LoungeActivity;
  /** Lounge seat it is heading to or sits on (a temporary claim, not its seatId). */
  seatUid?: string;
  /** Who it went to stand with (mingle). */
  partnerId?: number;
  /** Seconds left of sitting/standing once arrived. */
  timer: number;
}

/** "col,row" keys of every tile painted with an Area whose role is lounge. */
export function loungeTileKeys(layout: OfficeLayout): Set<string> {
  const lounges = new Set(
    (layout.areas ?? []).filter((a) => a.role === 'lounge').map((a) => a.label),
  );
  const keys = new Set<string>();
  if (lounges.size === 0 || !layout.areaTiles) return keys;
  layout.areaTiles.forEach((label, idx) => {
    if (label && lounges.has(label)) {
      keys.add(`${idx % layout.cols},${Math.floor(idx / layout.cols)}`);
    }
  });
  return keys;
}

/**
 * Idle long enough to go to the lounge: idle since at least LOUNGE_IDLE_SEC
 * ago, not waiting on the user or for an approval (those need Rasmus, not a
 * coffee), not a sub-agent, not delivering a message. The server's idleSince
 * is the idle signal, not `ch.isActive`: an adopted agent that has shown no
 * activity yet keeps the character default `isActive: true` although the
 * server knows it has been idle since its transcript was last written.
 */
export function wantsLounge(ch: Character, idleSince: number | undefined, now: number): boolean {
  if (ch.isSubagent || ch.visit || idleSince === undefined) return false;
  if (ch.bubbleType === 'permission') return false;
  if (ch.waitingAwaitingInput) return false;
  return now - idleSince >= LOUNGE_IDLE_SEC * 1000;
}

/** Pick the next activity among those possible: sitting is the favourite. */
export function chooseActivity(
  possible: { sit: boolean; stroll: boolean; mingle: boolean },
  random: () => number,
): LoungeActivity | null {
  const weighted: Array<[LoungeActivity, number]> = [
    ['sit', possible.sit ? 5 : 0],
    ['stroll', possible.stroll ? 3 : 0],
    ['mingle', possible.mingle ? 2 : 0],
  ];
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  if (total === 0) return null;
  let pick = random() * total;
  for (const [activity, w] of weighted) {
    if (pick < w) return activity;
    pick -= w;
  }
  return weighted.find(([, w]) => w > 0)![0];
}

/** Begin walking to a lounge spot (the path is already on `ch.path`). */
export function beginLounge(
  ch: Character,
  activity: LoungeActivity,
  extra: { seatUid?: string; partnerId?: number } = {},
): void {
  ch.lounge = { phase: 'walking', activity, timer: 0, ...extra };
  ch.state = ch.path.length > 0 ? CharacterState.WALK : CharacterState.IDLE;
  ch.moveProgress = 0;
  ch.frame = 0;
  ch.frameTimer = 0;
}

/**
 * One frame of lounging. Walking: step along the path; on arrival sit
 * (seat facing, TYPE pose) or stand (facing the partner when mingling) for a
 * random while. Resting: count down. Returns 'next' when it is time to pick a
 * new activity (the caller releases any seat and chooses again).
 */
export function advanceLounge(
  ch: Character,
  dt: number,
  seats: Map<string, Seat>,
  partner: Character | undefined,
  step: (ch: Character, dt: number) => void,
  random: () => number,
): 'walking' | 'resting' | 'next' {
  const lounge = ch.lounge;
  if (!lounge) return 'next';
  if (lounge.phase === 'walking') {
    if (ch.path.length > 0) {
      step(ch, dt);
      return 'walking';
    }
    lounge.phase = 'resting';
    ch.frame = 0;
    const seat = lounge.seatUid ? seats.get(lounge.seatUid) : undefined;
    if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      lounge.timer = LOUNGE_SIT_MIN_SEC + random() * (LOUNGE_SIT_MAX_SEC - LOUNGE_SIT_MIN_SEC);
    } else {
      ch.state = CharacterState.IDLE;
      lounge.timer =
        LOUNGE_STAND_MIN_SEC + random() * (LOUNGE_STAND_MAX_SEC - LOUNGE_STAND_MIN_SEC);
      if (partner) {
        // Face each other, and keep the partner around for the chat: a resting
        // partner turns to us and stays at least as long as we do.
        ch.dir = facingToward(ch, partner);
        if (partner.lounge?.phase === 'resting') {
          partner.dir = facingToward(partner, ch);
          partner.lounge.timer = Math.max(partner.lounge.timer, lounge.timer);
        }
      }
      return 'resting';
    }
    return 'resting';
  }
  lounge.timer -= dt;
  if (lounge.timer > 0) return 'resting';
  releasePartner(ch, partner, seats);
  return 'next';
}

/**
 * A mingle is over: a partner still sitting on its lounge seat turns back to
 * the seat's facing. Without this it kept sitting sideways, facing a chat
 * partner that had already left.
 */
export function releasePartner(
  ch: Character,
  partner: Character | undefined,
  seats: Map<string, Seat>,
): void {
  if (ch.lounge?.activity !== 'mingle' || !partner) return;
  const seatUid = partner.lounge?.phase === 'resting' ? partner.lounge.seatUid : undefined;
  const seat = seatUid ? seats.get(seatUid) : undefined;
  if (seat && partner.tileCol === seat.seatCol && partner.tileRow === seat.seatRow) {
    partner.dir = seat.facingDir;
  }
}

/** Leave the lounge: stand up (an active agent's FSM then walks it to its seat). */
export function endLounge(ch: Character): void {
  ch.lounge = undefined;
  ch.path = [];
  if (ch.state === CharacterState.TYPE || ch.state === CharacterState.WALK) {
    ch.state = CharacterState.IDLE;
  }
  ch.frame = 0;
}

/** What the lounge rules need from the office (OfficeState supplies it). */
export interface LoungeContext {
  keys: Set<string>;
  characters: Iterable<Character>;
  seats: Iterable<Seat>;
  walkableTiles: Array<{ col: number; row: number }>;
  /** Path from `ch` to (col,row), the target tile opened even if it is a chair. */
  pathTo: (ch: Character, col: number, row: number) => Array<{ col: number; row: number }>;
  /** Closest free walkable tile beside (col,row), never on it. */
  freeTileBeside: (col: number, row: number) => { col: number; row: number } | null;
}

/**
 * Choose and start the next lounge activity: sit on a free lounge seat (not
 * anyone's assigned seat, not another lounger's), stroll to a free lounge
 * tile, or stand beside another lounging agent. Seats full → stroll or
 * mingle; no free lounge tile either → false (the FSM keeps it where it is).
 */
export function planLoungeActivity(
  ch: Character,
  ctx: LoungeContext,
  random: () => number,
): boolean {
  const occupied = new Set<string>();
  const claimed = new Set<string>();
  const partners: Character[] = [];
  for (const other of ctx.characters) {
    if (other.id === ch.id) continue;
    occupied.add(`${other.tileCol},${other.tileRow}`);
    if (other.lounge?.seatUid) claimed.add(other.lounge.seatUid);
    if (other.lounge) partners.push(other);
  }
  const freeSeats = [...ctx.seats].filter(
    (s) => ctx.keys.has(`${s.seatCol},${s.seatRow}`) && !s.assigned && !claimed.has(s.uid),
  );
  const freeTiles = ctx.walkableTiles.filter(
    (t) => ctx.keys.has(`${t.col},${t.row}`) && !occupied.has(`${t.col},${t.row}`),
  );
  const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)];
  const activity = chooseActivity(
    { sit: freeSeats.length > 0, stroll: freeTiles.length > 0, mingle: partners.length > 0 },
    random,
  );

  if (activity === 'sit') {
    const seat = pick(freeSeats);
    ch.path = ctx.pathTo(ch, seat.seatCol, seat.seatRow);
    if (ch.path.length > 0 || (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow)) {
      beginLounge(ch, 'sit', { seatUid: seat.uid });
      return true;
    }
  }
  if (activity === 'mingle') {
    const partner = pick(partners);
    const spot = ctx.freeTileBeside(partner.tileCol, partner.tileRow);
    if (spot) {
      ch.path = ctx.pathTo(ch, spot.col, spot.row);
      beginLounge(ch, 'mingle', { partnerId: partner.id });
      return true;
    }
  }
  if (freeTiles.length > 0) {
    const tile = pick(freeTiles);
    ch.path = ctx.pathTo(ch, tile.col, tile.row);
    beginLounge(ch, 'stroll');
    return true;
  }
  return false;
}
