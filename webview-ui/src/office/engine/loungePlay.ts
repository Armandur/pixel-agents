import {
  LOUNGE_PLAY_MAX_SEC,
  LOUNGE_PLAY_MIN_SEC,
  LOUNGE_PLAY_WAIT_MAX_SEC,
} from '../../constants.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import type { Character, PlacedFurniture } from '../types.js';
import { CharacterState, Direction } from '../types.js';

/**
 * Games in the lounge: idle agents walk up to a game (arcade, air hockey) and
 * play it. A game names where its players stand (`playSpots` in its
 * manifest); one needing two players recruits another lounger, the first to
 * arrive waits, and the game is lit (its ON animation) only while every
 * player is at it. Pure rules; OfficeState supplies the games from the layout.
 */

export interface PlaySpotTile {
  col: number;
  row: number;
  dir: Direction;
}

export interface LoungeGame {
  uid: string;
  /** "col,row" of the item's top-left tile: what auto-state turns on. */
  tile: string;
  spots: PlaySpotTile[];
  minPlayers: number;
}

const DIRS = {
  up: Direction.UP,
  down: Direction.DOWN,
  left: Direction.LEFT,
  right: Direction.RIGHT,
} as const;

/** Every placed game, its spots resolved to tiles. */
export function gamesInLayout(furniture: readonly PlacedFurniture[]): LoungeGame[] {
  const games: LoungeGame[] = [];
  for (const f of furniture) {
    const spots = getCatalogEntry(f.type)?.playSpots;
    if (!spots?.length) continue;
    games.push({
      uid: f.uid,
      tile: `${f.col},${f.row}`,
      spots: spots.map((s) => ({ col: f.col + s.dc, row: f.row + s.dr, dir: DIRS[s.dir] })),
      minPlayers: getCatalogEntry(f.type)?.minPlayers ?? 1,
    });
  }
  return games;
}

/**
 * Games an agent could start now: not being played, and enough of its spots
 * free to stand on (inside the lounge, walkable, nobody there) for its
 * minimum. A two-player air hockey with a wall at one end is never offered.
 */
export function playableGames(
  games: readonly LoungeGame[],
  canStand: (col: number, row: number) => boolean,
  inUse: ReadonlySet<string>,
): LoungeGame[] {
  return games.filter(
    (g) =>
      !inUse.has(g.uid) && g.spots.filter((s) => canStand(s.col, s.row)).length >= g.minPlayers,
  );
}

/** Uids of the games someone is playing or walking to. */
export function gamesInUse(characters: Iterable<Character>): Set<string> {
  const uids = new Set<string>();
  for (const c of characters) if (c.lounge?.gameUid) uids.add(c.lounge.gameUid);
  return uids;
}

/** At its spot, facing the game. */
function atSpot(c: Character | undefined, gameUid: string): boolean {
  const l = c?.lounge;
  return l?.activity === 'play' && l.gameUid === gameUid && l.phase === 'resting';
}

/**
 * Arrival at a play spot: face the game. Alone, or the partner already
 * waiting → a round starts for both; otherwise wait for the partner.
 */
export function arriveAtGame(ch: Character, partner: Character | undefined, random: () => number) {
  const lounge = ch.lounge!;
  ch.state = CharacterState.IDLE;
  if (lounge.spot) ch.dir = lounge.spot.dir;
  if (lounge.partnerId === undefined || atSpot(partner, lounge.gameUid!)) {
    const round = LOUNGE_PLAY_MIN_SEC + random() * (LOUNGE_PLAY_MAX_SEC - LOUNGE_PLAY_MIN_SEC);
    lounge.timer = round;
    if (partner?.lounge) partner.lounge.timer = round;
  } else {
    lounge.timer = LOUNGE_PLAY_WAIT_MAX_SEC;
  }
}

/** The partner left the game (turned active, or went elsewhere): stop too. */
export function partnerQuit(ch: Character, partner: Character | undefined): boolean {
  const l = ch.lounge;
  if (l?.activity !== 'play' || l.partnerId === undefined) return false;
  return partner?.lounge?.activity !== 'play' || partner.lounge.gameUid !== l.gameUid;
}

/** Top-left tiles of the games being played right now (every player at it). */
export function litGameTiles(
  characters: Iterable<Character>,
  games: readonly LoungeGame[],
): Set<string> {
  const all = new Map<number, Character>();
  for (const c of characters) all.set(c.id, c);
  const tiles = new Set<string>();
  for (const c of all.values()) {
    const l = c.lounge;
    if (!l?.gameUid || !atSpot(c, l.gameUid)) continue;
    if (l.partnerId !== undefined && !atSpot(all.get(l.partnerId), l.gameUid)) continue;
    const game = games.find((g) => g.uid === l.gameUid);
    if (game) tiles.add(game.tile);
  }
  return tiles;
}
