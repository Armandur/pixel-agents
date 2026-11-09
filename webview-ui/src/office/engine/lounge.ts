import {
  LOUNGE_CHAT_PHRASES,
  LOUNGE_CHAT_TURN_MAX_SEC,
  LOUNGE_CHAT_TURN_MIN_SEC,
  LOUNGE_IDLE_SEC,
  LOUNGE_SIT_MAX_SEC,
  LOUNGE_SIT_MIN_SEC,
  LOUNGE_STAND_MAX_SEC,
  LOUNGE_STAND_MIN_SEC,
} from '../../constants.js';
import type { Character, OfficeLayout, Seat } from '../types.js';
import { CharacterState } from '../types.js';
import { facingToward } from './conversation.js';
import type { LoungeGame, PlaySpotTile } from './loungePlay.js';
import { arriveAtGame, partnerQuit, playableGames } from './loungePlay.js';

/**
 * The lounge ("fikarummet"): agents idle long enough leave their desk for an
 * Area with role 'lounge', where they take turns sitting on a free seat,
 * strolling and standing with each other — until they turn active, when they
 * head back to their own seat. Pure rules; OfficeState supplies the map.
 */

export type LoungeActivity = 'sit' | 'stroll' | 'mingle' | 'play';

/** The pretend chat of a mingle: who "speaks" now and what the bubble says. */
export interface LoungeChat {
  speakerId: number;
  phrase: string;
  /** Seconds left of this turn. */
  timer: number;
}

/** What a lounging character is doing. Replaces the FSM while set. */
export interface LoungeState {
  phase: 'walking' | 'resting';
  activity: LoungeActivity;
  /** Lounge seat it is heading to or sits on (a temporary claim, not its seatId). */
  seatUid?: string;
  /** Who it went to stand with (mingle), or plays against (play). */
  partnerId?: number;
  /** Play: the game's uid and the spot this player stands on. */
  gameUid?: string;
  spot?: PlaySpotTile;
  /** Seconds left of sitting/standing once arrived. */
  timer: number;
  /** Mingle only: the simulated chat, owned by the character that walked up. */
  chat?: LoungeChat;
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
  possible: { sit: boolean; stroll: boolean; mingle: boolean; play?: boolean },
  random: () => number,
): LoungeActivity | null {
  const weighted: Array<[LoungeActivity, number]> = [
    ['sit', possible.sit ? 5 : 0],
    ['stroll', possible.stroll ? 3 : 0],
    ['mingle', possible.mingle ? 2 : 0],
    ['play', possible.play ? 3 : 0],
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

function chatTurn(speakerId: number, previous: string | undefined, random: () => number) {
  const pool = LOUNGE_CHAT_PHRASES.filter((p) => p !== previous);
  return {
    speakerId,
    phrase: pool[Math.floor(random() * pool.length)],
    timer:
      LOUNGE_CHAT_TURN_MIN_SEC + random() * (LOUNGE_CHAT_TURN_MAX_SEC - LOUNGE_CHAT_TURN_MIN_SEC),
  };
}

/** Start the pretend chat when a mingle begins; either side may open. */
export function startLoungeChat(
  selfId: number,
  partnerId: number,
  random: () => number,
): LoungeChat {
  return chatTurn(random() < 0.5 ? selfId : partnerId, undefined, random);
}

/** Count the turn down; when it ends the other side speaks a fresh phrase. */
export function advanceLoungeChat(
  chat: LoungeChat,
  selfId: number,
  partnerId: number,
  dt: number,
  random: () => number,
): void {
  chat.timer -= dt;
  if (chat.timer > 0) return;
  Object.assign(
    chat,
    chatTurn(chat.speakerId === selfId ? partnerId : selfId, chat.phrase, random),
  );
}

/**
 * The pretend-chat bubble text per character id: only while a mingle is
 * under way (the walker resting beside a partner that is also resting), and
 * never for a character that is showing a real conversation bubble.
 */
export function loungeChatLines(characters: Iterable<Character>): Map<number, string> {
  const all = new Map<number, Character>();
  for (const c of characters) all.set(c.id, c);
  const lines = new Map<number, string>();
  for (const c of all.values()) {
    const lounge = c.lounge;
    if (lounge?.activity !== 'mingle' || lounge.phase !== 'resting' || !lounge.chat) continue;
    const partner = lounge.partnerId !== undefined ? all.get(lounge.partnerId) : undefined;
    if (partner?.lounge?.phase !== 'resting') continue;
    const speaker = lounge.chat.speakerId === c.id ? c : partner;
    if (speaker.visit?.phase === 'talking') continue;
    lines.set(speaker.id, lounge.chat.phrase);
  }
  return lines;
}

/** Begin walking to a lounge spot (the path is already on `ch.path`). */
export function beginLounge(
  ch: Character,
  activity: LoungeActivity,
  extra: { seatUid?: string; partnerId?: number; gameUid?: string; spot?: PlaySpotTile } = {},
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
    if (lounge.activity === 'play') {
      arriveAtGame(ch, partner, random);
      return 'resting';
    }
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
        lounge.chat = startLoungeChat(ch.id, partner.id, random);
      }
      return 'resting';
    }
    return 'resting';
  }
  if (partnerQuit(ch, partner)) return 'next';
  lounge.timer -= dt;
  if (lounge.chat && partner) advanceLoungeChat(lounge.chat, ch.id, partner.id, dt, random);
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
  /** Placed games (see loungePlay.ts); absent = none. */
  games?: LoungeGame[];
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
  const inUse = new Set<string>();
  for (const other of ctx.characters) {
    if (other.id === ch.id) continue;
    occupied.add(`${other.tileCol},${other.tileRow}`);
    if (other.lounge?.gameUid) inUse.add(other.lounge.gameUid);
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
  const standable = new Set(freeTiles.map((t) => `${t.col},${t.row}`));
  const canStand = (col: number, row: number) => standable.has(`${col},${row}`);
  // Someone to play against: a lounger not already at a game or on a visit.
  const opponents = partners.filter((p) => !p.lounge?.gameUid && !p.visit);
  const games = playableGames(ctx.games ?? [], canStand, inUse).filter(
    (g) => g.minPlayers < 2 || opponents.length > 0,
  );
  const activity = chooseActivity(
    {
      sit: freeSeats.length > 0,
      stroll: freeTiles.length > 0,
      mingle: partners.length > 0,
      play: games.length > 0,
    },
    random,
  );

  if (activity === 'play' && startGame(ch, pick(games), opponents, canStand, ctx, pick, random)) {
    return true;
  }

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

/**
 * Send `ch` (and, for a two-player game, a recruited opponent) to the game's
 * free spots. A game for one or two (the wide arcade) gets a second player
 * half the time when someone is free. The opponent drops whatever it was
 * doing in the lounge; its seat claim goes with its old lounge state.
 */
function startGame(
  ch: Character,
  game: LoungeGame,
  opponents: Character[],
  canStand: (col: number, row: number) => boolean,
  ctx: LoungeContext,
  pick: <T>(xs: T[]) => T,
  random: () => number,
): boolean {
  const spots = game.spots.filter((s) => canStand(s.col, s.row));
  const path = ctx.pathTo(ch, spots[0].col, spots[0].row);
  if (path.length === 0) return false;
  const duo = game.minPlayers >= 2 || (spots.length >= 2 && opponents.length > 0 && random() < 0.5);
  if (!duo) {
    ch.path = path;
    beginLounge(ch, 'play', { gameUid: game.uid, spot: spots[0] });
    return true;
  }
  const opponent = pick(opponents);
  const opponentPath = ctx.pathTo(opponent, spots[1].col, spots[1].row);
  if (opponentPath.length === 0) return false;
  ch.path = path;
  beginLounge(ch, 'play', { gameUid: game.uid, spot: spots[0], partnerId: opponent.id });
  opponent.path = opponentPath;
  beginLounge(opponent, 'play', { gameUid: game.uid, spot: spots[1], partnerId: ch.id });
  return true;
}
