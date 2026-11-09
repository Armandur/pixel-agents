import { pickDiversePalette } from '../../../../core/src/paletteUtils.js';
import {
  AUTO_ON_FACING_DEPTH,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  CONVERSATION_WAIT_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  FURNITURE_ANIM_INTERVAL_SEC,
  GREETER_ID,
  GREETER_TILE_MARGIN,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  LEVEL_UP_BUBBLE_SEC,
  MAX_PET_ID_LENGTH,
  MEETING_IDLE_SEC,
  MEETING_TALK_SEC,
  PET_HIT_HALF_WIDTH,
  PET_HIT_HEIGHT,
  SUBAGENT_DOOR_MAX_TILES,
  SUBAGENT_REPORT_MAX_SEC,
  SUBAGENT_REPORT_PHRASE,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import type { QuotaInfo } from '../quotaFormat.js';
import { getPetCount, getPetName } from '../sprites/petSpriteData.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  Pet,
  PlacedFurniture,
  PlacedPet,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, PetState, TILE_SIZE } from '../types.js';
import {
  advanceAttention,
  needsRasmus,
  pickAttentionTile,
  roleTileKeys,
  wantsAttention,
} from './attention.js';
import { animationFrameFor, collectAutoOnTiles } from './autoState.js';
import { createCharacter, updateCharacter, walkFrame } from './characters.js';
import type { VisitRequest } from './conversation.js';
import { advanceVisit, beginVisit, requestVisit, visitDestination } from './conversation.js';
import type { Entrance } from './entrance.js';
import {
  advanceDoorway,
  advanceOpenness,
  beginEntering,
  beginLeaving,
  doorBusy,
  doorFrame,
  doorWanted,
  findEntrance,
  isLeaving,
  parkForEntrance,
} from './entrance.js';
import type { LoungeContext } from './lounge.js';
import {
  advanceLounge,
  endLounge,
  loungeTileKeys,
  planLoungeActivity,
  releasePartner,
  wantsLounge,
} from './lounge.js';
import type { LoungeGame } from './loungePlay.js';
import { gamesInLayout, litGameTiles } from './loungePlay.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import {
  advanceMeetingSeat,
  advanceMeetingTalk,
  isReply,
  type Meeting,
  meetingKey,
  pickMeetingSeats,
} from './meeting.js';
import { createPet, updatePet } from './petEntity.js';
import { seatOwnedBy, seatOwners } from './seatOwners.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  characters: Map<number, Character> = new Map();
  pets: Pet[] = [];
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  private _selectedAgentId: number | null = null;
  private readonly selectionListeners = new Set<(id: number | null) => void>();
  get selectedAgentId(): number | null {
    return this._selectedAgentId;
  }
  set selectedAgentId(id: number | null) {
    if (this._selectedAgentId === id) return;
    this._selectedAgentId = id;
    for (const listener of this.selectionListeners) listener(id);
  }
  /** Observe selectedAgentId changes. React (the card bars) subscribes so
   *  imperative canvas selection can drive card highlights — everything else
   *  about selection stays out of React state. Returns the unsubscribe. */
  subscribeSelection(listener: (id: number | null) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  private readonly crownedAgentIds = new Set<number>();
  /** Session names by agent id, for seats kept for a name (seatOwners.ts). */
  private readonly sessionNames = new Map<number, string>();
  /** Generated figure seed by agent id; may arrive before the character. */
  private readonly figureById = new Map<number, string>();
  /** Latest usage quota per provider (quotaUpdate), drawn on the quota TVs. */
  quotas: Record<string, QuotaInfo> = {};
  /** Epoch ms each idle agent went idle (agentIdleSince); absent = working. */
  private readonly idleSinceById = new Map<number, number>();
  /** Lounge tile keys, cached per layout object (see loungeKeys()). */
  private loungeCache: { layout: OfficeLayout; keys: Set<string> } | null = null;
  /** Attention Area tile keys, cached per layout object (see attentionKeys()). */
  private attentionCache: { layout: OfficeLayout; keys: Set<string> } | null = null;
  private walkableKeyCache: {
    tiles: Array<{ col: number; row: number }>;
    keys: Set<string>;
  } | null = null;
  /** Meetings in progress, by meetingKey (office/engine/meeting.ts). */
  meetings = new Map<string, Meeting>();
  /** When each "from>to" pair last messaged, to tell a reply (and so a meeting). */
  private lastSent = new Map<string, number>();
  /** Meeting-room tile keys, cached per layout object. */
  private meetingCache: { layout: OfficeLayout; keys: Set<string> } | null = null;
  /** Since when (ms) each agent has needed Rasmus without a break. */
  private attentionSince = new Map<number, number>();
  /** Placed games, cached per layout object (see loungeGames()). */
  private gamesCache: { layout: OfficeLayout; games: LoungeGame[] } | null = null;
  private electronicsCache: { layout: OfficeLayout; tiles: Set<string> } | null = null;
  /** Newcomers waiting for the entrance door, in the order they were created. */
  private doorQueue: number[] = [];
  /** The newest arrival through the door (the next waits until it is clear). */
  private lastArrivalId: number | undefined;
  /** The entrance door, cached per layout object (see entrance()). */
  private entranceCache: { layout: OfficeLayout; entrance: Entrance | null } | null = null;
  /** How open the entrance door is (0 shut … 1 open), and the frame it shows. */
  private doorOpenness = 0;
  private doorFrameShown = 0;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;

  /**
   * directoryName → list of Area labels that Directory belongs to.
   * Populated by useExtensionMessages on `areaMappingsLoaded`. Consulted by
   * `findFreeSeat()` to bias new agents toward seats inside their Directory's Area.
   */
  areaMappings: Record<string, string[]> = {};

  /**
   * The first-run consent greeter, deliberately NOT in `characters`.
   *
   * `characters` means "agents": everything that iterates it — seat
   * assignment, palette diversity, the wander FSM, hit-testing, the seat
   * payload the webview persists — is asking an agent question the greeter has
   * no answer to. Holding it here instead of tagging it with a flag makes
   * every one of those loops correct by default, rather than correct as long
   * as each remembers an `isGreeter` guard. It is drawn because
   * `getCharacters()` appends it, and that is the only place it joins the
   * others.
   */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
  }

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    // Pets are built last because they need walkableTiles populated for spawn.
    this.rebuildPetsFromLayout(this.layout);
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col;
        ch.tileRow += shift.row;
        ch.x += shift.col * TILE_SIZE;
        ch.y += shift.row * TILE_SIZE;
        // Clear path since tile coords changed
        ch.path = [];
        ch.moveProgress = 0;
      }
    }

    // Shift pet positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const pet of this.pets) {
        pet.tileCol += shift.col;
        pet.tileRow += shift.row;
        pet.x += shift.col * TILE_SIZE;
        pet.y += shift.row * TILE_SIZE;
        pet.path = [];
        pet.moveProgress = 0;
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false;
    }

    // First pass: try to keep characters at their existing seats (not one
    // that is now kept for somebody else)
    const owners = seatOwners(layout);
    const displaced: Character[] = [];
    for (const ch of this.characters.values()) {
      const owner = ch.seatId ? owners.get(ch.seatId) : undefined;
      if (
        ch.seatId &&
        this.seats.has(ch.seatId) &&
        (!owner || owner === this.sessionNames.get(ch.id))
      ) {
        const seat = this.seats.get(ch.seatId)!;
        if (!seat.assigned) {
          seat.assigned = true;
          if (ch.doorway) continue; // coming in through the door: let it walk
          // Snap character to seat position
          ch.tileCol = seat.seatCol;
          ch.tileRow = seat.seatRow;
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
          ch.x = cx;
          ch.y = cy;
          ch.dir = seat.facingDir;
          continue;
        }
      }
      if (owner && ch.seatId && this.seats.has(ch.seatId)) displaced.push(ch);
      ch.seatId = null; // will be reassigned below
    }

    // Owners take their kept seats; whoever was moved off one swaps into the
    // seat its owner left (or, failing that, any free seat below)
    const freed: string[] = [];
    for (const id of this.characters.keys()) {
      const left = this.claimOwnedSeat(id);
      if (left) freed.push(left);
    }
    for (const ch of displaced) {
      const swap = freed.find((uid) => !this.seats.get(uid)?.assigned);
      if (swap) this.reassignSeat(ch.id, swap);
    }

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue;
      const seatId = this.findFreeSeat(ch.directoryName);
      if (seatId) {
        this.seats.get(seatId)!.assigned = true;
        ch.seatId = seatId;
        const seat = this.seats.get(seatId)!;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
    }

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue; // seated characters are fine
      if (
        ch.tileCol < 0 ||
        ch.tileCol >= layout.cols ||
        ch.tileRow < 0 ||
        ch.tileRow >= layout.rows
      ) {
        this.relocateCharacterToWalkable(ch);
      }
    }

    // Relocate any pets that ended up outside bounds or on non-walkable tiles
    for (const pet of this.pets) {
      if (
        pet.tileCol < 0 ||
        pet.tileCol >= layout.cols ||
        pet.tileRow < 0 ||
        pet.tileRow >= layout.rows ||
        !isWalkable(pet.tileCol, pet.tileRow, this.tileMap, this.blockedTiles)
      ) {
        if (this.walkableTiles.length > 0) {
          const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
          pet.tileCol = spawn.col;
          pet.tileRow = spawn.row;
          pet.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
          pet.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
          pet.path = [];
          pet.moveProgress = 0;
          pet.state = PetState.IDLE;
          pet.frame = 0;
          pet.frameTimer = 0;
          pet.followTargetId = null;
        }
      }
    }

    // Reconcile pets against the layout roster (handles editor add/remove)
    this.rebuildPetsFromLayout(layout);
  }

  /** Move a character to a random walkable tile */
  private relocateCharacterToWalkable(ch: Character): void {
    if (this.walkableTiles.length === 0) return;
    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.path = [];
    ch.moveProgress = 0;
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    if (key) this.blockedTiles.delete(key);
    const result = fn();
    if (key) this.blockedTiles.add(key);
    return result;
  }

  /** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
  private entrance(): Entrance | null {
    if (this.entranceCache?.layout !== this.layout) {
      this.entranceCache = { layout: this.layout, entrance: findEntrance(this.layout) };
      this.doorOpenness = 0;
    }
    return this.entranceCache.entrance;
  }

  /**
   * Walk a character out through the entrance; false when there is none, it
   * is farther than `maxTiles`, or out of reach (the caller then despawns it
   * where it stands).
   */
  private leaveViaDoor(ch: Character, maxTiles = Infinity): boolean {
    const e = this.entrance();
    if (!e) return false;
    const atDoor = ch.tileCol === e.col && ch.tileRow === e.insideRow;
    const path = atDoor
      ? []
      : this.withOwnSeatUnblocked(ch, () =>
          findPath(ch.tileCol, ch.tileRow, e.col, e.insideRow, this.tileMap, this.blockedTiles),
        );
    if ((!atDoor && path.length === 0) || path.length > maxTiles) return false;
    if (ch.lounge) this.leaveLounge(ch);
    ch.visit = undefined;
    ch.visitQueue = undefined;
    ch.reportTimer = undefined;
    ch.path = path;
    beginLeaving(ch);
    return true;
  }

  private isQueued(ch: Character): boolean {
    return this.doorQueue.includes(ch.id);
  }

  /** A newcomer comes in through the door: now when the door is free and
   *  nobody waits, else it is parked unseen and queued for its turn. The
   *  caller adds `ch` to `characters` afterwards. */
  private arriveViaDoor(ch: Character, e: Entrance): void {
    const last =
      this.lastArrivalId !== undefined ? this.characters.get(this.lastArrivalId) : undefined;
    if (
      this.doorQueue.length > 0 ||
      doorBusy(this.characters.values(), e, last, (c) => this.isQueued(c))
    ) {
      parkForEntrance(ch);
      this.doorQueue.push(ch.id);
      return;
    }
    beginEntering(ch, e);
    startMatrixEffect(ch, 'spawn');
    this.lastArrivalId = ch.id;
  }

  /** Let the first in the queue materialize once the door is free. */
  private advanceDoorQueue(): void {
    while (this.doorQueue.length > 0) {
      const ch = this.characters.get(this.doorQueue[0]);
      if (!ch) {
        this.doorQueue.shift();
        continue;
      }
      const e = this.entrance();
      if (!e) {
        // The entrance is gone: everyone waiting appears where they would sit.
        this.doorQueue.shift();
        const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
        const at = seat
          ? { col: seat.seatCol, row: seat.seatRow }
          : (this.closestFreeWalkableTile(1, 1) ?? { col: 1, row: 1 });
        ch.tileCol = at.col;
        ch.tileRow = at.row;
        ch.x = at.col * TILE_SIZE + TILE_SIZE / 2;
        ch.y = at.row * TILE_SIZE + TILE_SIZE / 2;
        startMatrixEffect(ch, 'spawn');
        continue;
      }
      const last =
        this.lastArrivalId !== undefined ? this.characters.get(this.lastArrivalId) : undefined;
      if (doorBusy(this.characters.values(), e, last, (c) => this.isQueued(c))) return;
      this.doorQueue.shift();
      beginEntering(ch, e);
      startMatrixEffect(ch, 'spawn');
      this.lastArrivalId = ch.id;
      return;
    }
  }

  /** A character still waiting for the door just leaves the queue and the
   *  office, with its seat. False when it was not waiting. */
  private dropQueued(ch: Character): boolean {
    if (!this.isQueued(ch)) return false;
    this.doorQueue = this.doorQueue.filter((q) => q !== ch.id);
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
      ch.seatId = null;
    }
    this.characters.delete(ch.id);
    if (this.selectedAgentId === ch.id) this.selectedAgentId = null;
    if (this.cameraFollowId === ch.id) this.cameraFollowId = null;
    return true;
  }

  /** A newcomer that has stepped inside walks on to its seat (a seatless
   *  sub-agent to beside its parent). */
  private walkToSeat(ch: Character): void {
    const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined;
    // A seatless sub-agent goes to stand beside its parent instead.
    const parent = ch.parentAgentId != null ? this.characters.get(ch.parentAgentId) : undefined;
    const target = seat
      ? { col: seat.seatCol, row: seat.seatRow }
      : parent
        ? this.closestFreeWalkableTile(parent.tileCol, parent.tileRow, 1)
        : null;
    if (!target) return;
    ch.path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, target.col, target.row, this.tileMap, this.blockedTiles),
    );
    ch.moveProgress = 0;
    ch.state = ch.path.length > 0 ? CharacterState.WALK : CharacterState.IDLE;
  }

  /** buildElectronicsTileSet, cached per layout object (auto-state runs often). */
  private electronicsTiles(): Set<string> {
    if (this.electronicsCache?.layout !== this.layout) {
      this.electronicsCache = { layout: this.layout, tiles: this.buildElectronicsTileSet() };
    }
    return this.electronicsCache.tiles;
  }

  private buildElectronicsTileSet(): Set<string> {
    const out = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          out.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    return out;
  }

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    const seat = this.seats.get(uid);
    if (!seat) return null;
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const idx = seat.seatRow * this.layout.cols + seat.seatCol;
    if (idx < 0 || idx >= tiles.length) return null;
    return tiles[idx] ?? null;
  }

  /**
   * Does this seat face an electronics tile (PC, monitor)? Mirrors the
   * forward-and-flanking scan used by furniture auto-state.
   */
  private isSeatFacingElectronics(seat: Seat, electronicsTiles: Set<string>): boolean {
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
      const tileCol = seat.seatCol + dCol * d;
      const tileRow = seat.seatRow + dRow * d;
      if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
      if (dCol !== 0) {
        if (
          electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
          electronicsTiles.has(`${tileCol},${tileRow + 1}`)
        ) {
          return true;
        }
      } else if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Random-pick a seat from a candidate list, biased toward seats that face an
   * electronics tile. Returns null when the candidate list is empty.
   */
  private pickFromSeats(seatUids: string[], electronicsTiles: Set<string>): string | null {
    if (seatUids.length === 0) return null;
    const pcSeats: string[] = [];
    const otherSeats: string[] = [];
    for (const uid of seatUids) {
      const seat = this.seats.get(uid);
      if (!seat) continue;
      if (this.isSeatFacingElectronics(seat, electronicsTiles)) {
        pcSeats.push(uid);
      } else {
        otherSeats.push(uid);
      }
    }
    if (pcSeats.length > 0) return pcSeats[Math.floor(Math.random() * pcSeats.length)];
    if (otherSeats.length > 0) return otherSeats[Math.floor(Math.random() * otherSeats.length)];
    return null;
  }

  /**
   * 3-stage seat picker for top-level agents.
   *
   *   Stage 1: If `directoryName` is given and `areaMappings[directoryName]` lists
   *            Area labels, prefer free seats whose tile is labeled with one
   *            of those areas.
   *   Stage 2: Prefer free seats whose tile has NO area label (unzoned).
   *   Stage 3: Any free seat.
   *
   * Each stage routes through `pickFromSeats` for the PC-bias rule. Returns
   * null only when every seat is already occupied. Passing `undefined`
   * preserves pre-Areas single-stage behavior (skips Stage 1; Stage 2 picks
   * unzoned seats from a layout without `areaTiles`, which is every seat).
   */
  private findFreeSeat(directoryName?: string): string | null {
    const electronicsTiles = this.buildElectronicsTileSet();
    const freeSeats: string[] = [];
    const kept = seatOwners(this.layout);
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned && !kept.has(uid)) freeSeats.push(uid);
    }
    if (freeSeats.length === 0) return null;

    const areaLabels = directoryName ? this.areaMappings[directoryName] : undefined;

    // Stage 1 — in-area seats for the Directory's mapped Area labels.
    if (areaLabels && areaLabels.length > 0) {
      const wanted = new Set(areaLabels);
      const inArea = freeSeats.filter((uid) => {
        const label = this.seatZone(uid);
        return label !== null && wanted.has(label);
      });
      const pick = this.pickFromSeats(inArea, electronicsTiles);
      if (pick) return pick;
    }

    // Stage 2 — unzoned seats (no area label, or layout has no areas at all).
    const unzoned = freeSeats.filter((uid) => this.seatZone(uid) === null);
    const pick2 = this.pickFromSeats(unzoned, electronicsTiles);
    if (pick2) return pick2;

    // Stage 3 — any free seat, the lounge's and the meeting room's last.
    const roomKeys = new Set([...this.loungeKeys(), ...this.meetingKeys()]);
    const outside = freeSeats.filter((uid) => {
      const s = this.seats.get(uid)!;
      return !roomKeys.has(`${s.seatCol},${s.seatRow}`);
    });
    return (
      this.pickFromSeats(outside, electronicsTiles) ??
      this.pickFromSeats(freeSeats, electronicsTiles)
    );
  }

  /** Closest walkable tile to (col,row) not occupied by another character, at
   *  least `minDistance` tiles away (1 = beside it, never on it), or null. */
  private closestFreeWalkableTile(
    col: number,
    row: number,
    minDistance = 0,
  ): { col: number; row: number } | null {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) {
      occupied.add(`${ch.tileCol},${ch.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    for (const tile of this.walkableTiles) {
      if (occupied.has(`${tile.col},${tile.row}`)) continue;
      const d = Math.abs(tile.col - col) + Math.abs(tile.row - row);
      if (d >= minDistance && d < bestDist) {
        best = tile;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette (0-5)
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    return pickDiversePalette(paletteCount, counts);
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    directoryName?: string,
    nearAgentId?: number,
  ): void {
    if (this.characters.has(id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Try preferred seat first, then (for teammates) the seat closest to the
    // anchor agent, then any free seat. anchorTile resolves to the anchor's SEAT
    // (stable from creation) rather than its live tile, so a teammate placed while
    // the lead is still walking to its seat still clusters around the final seat.
    const anchor = nearAgentId !== undefined ? this.characters.get(nearAgentId) : undefined;
    const anchorAt = anchorTile(anchor, this.seats);
    let seatId: string | null = null;
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      if (!seat.assigned) {
        seatId = preferredSeatId;
      }
    }
    if (!seatId && anchorAt) {
      seatId = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    }
    if (!seatId) {
      seatId = this.findFreeSeat(directoryName);
    }

    let ch: Character;
    if (seatId) {
      const seat = this.seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, hueShift);
    } else {
      // No seats — teammates spawn beside their anchor, others at a random walkable tile
      let spawn = anchorAt ? this.closestFreeWalkableTile(anchorAt.col, anchorAt.row) : null;
      if (!spawn) {
        spawn =
          this.walkableTiles.length > 0
            ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
            : { col: 1, row: 1 };
      }
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (directoryName) {
      ch.directoryName = directoryName;
    }
    if (!skipSpawnEffect) {
      // A newcomer materializes in the entrance doorway and walks in (a
      // teammate placed beside its lead appears there, as before).
      const e = nearAgentId === undefined ? this.entrance() : null;
      if (e) this.arriveViaDoor(ch, e);
      else startMatrixEffect(ch, 'spawn');
    }
    ch.crowned = this.crownedAgentIds.has(id);
    ch.figure = this.figureById.get(id);
    this.characters.set(id, ch);
    this.claimOwnedSeat(id);
  }

  // ── Greeter ───────────────────────────────────────────────────
  // The Intro is diegetic: a char_0 character stands near the office's
  // bottom-left corner and "speaks" the tour through a DOM bubble
  // (IntroBubble). It is not an agent — see the `greeter` field.

  /** Spawn the greeter near the office's bottom-left corner: target tile
   *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
   *  back to the closest walkable tile when the target is a seat, furniture,
   *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
   *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
   *  revives it. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    if (this.greeter) {
      if (this.greeter.matrixEffect === 'despawn') startMatrixEffect(this.greeter, 'spawn');
      return;
    }
    const spawn = this.closestFreeWalkableTile(
      GREETER_TILE_MARGIN,
      this.layout.rows - 1 - GREETER_TILE_MARGIN,
    );
    if (!spawn) return; // no walkable tile — IntroBubble falls back to a fixed panel
    const ch = createCharacter(GREETER_ID, 0, null, null, 0);
    ch.isGreeter = true;
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.dir = Direction.DOWN;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    startMatrixEffect(ch, 'spawn');
    this.greeter = ch;
  }

  /** Start the greeter's despawn effect and release the greeter camera. The
   *  character is dropped once the effect finishes (see update()).
   *  Idempotent — every close path (answer, Escape, hooksStatus) funnels here. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    if (!this.greeter || this.greeter.matrixEffect === 'despawn') return;
    startMatrixEffect(this.greeter, 'despawn');
  }

  /** Per-frame update from the bubble overlay; ignored once the user panned. */
  setGreeterCameraTarget(p: { x: number; y: number }): void {
    if (!this.greeterCameraCancelled) this.greeterCameraTarget = p;
  }

  /** Manual pan during the ask: stop re-centering until the next spawn. */
  cancelGreeterCamera(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = true;
  }

  /** Every manual pan (mouse, wheel, touch) takes the camera back from both
   *  automatic drivers: character follow and the greeter's ask. */
  breakCameraFollow(): void {
    this.cameraFollowId = null;
    this.cancelGreeterCamera();
  }

  /** Select an agent's character and have the camera follow it — what a card
   *  tap does to the office. No-op for an agent with no character. */
  selectAndFollow(id: number): void {
    if (!this.characters.has(id)) return;
    this.selectedAgentId = id;
    this.cameraFollowId = id;
  }

  /** The agent that owns `id`'s terminal: a sub-agent's parent, else itself. */
  terminalOwnerOf(id: number): number {
    return this.subagentMeta.get(id)?.parentAgentId ?? id;
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (this.dropQueued(ch)) return;
    if (ch.matrixEffect === 'despawn' || isLeaving(ch)) return; // already on its way out
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    ch.bubbleType = null;
    // Out through the entrance when there is one, else despawn where it is.
    // The path is found before the seat is freed (the seat tile is blocked).
    const left = this.leaveViaDoor(ch);
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
      ch.seatId = null;
    }
    if (!left) startMatrixEffect(ch, 'despawn');
    this.rebuildFurnitureInstances(); // its screen goes dark with it
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /**
   * Move a just-linked teammate to the free seat closest to its lead, so teams
   * cluster. Only moves when that seat is strictly closer than the teammate's
   * current one — a teammate created as a plain external agent (seated by an
   * arbitrary findFreeSeat) and tagged as a teammate only after tag discovery
   * would otherwise keep its arbitrary seat, unlike an inline teammate seated
   * next to the lead at creation.
   */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const teammate = this.characters.get(teammateId);
    const lead = this.characters.get(leadId);
    if (!teammate || !lead) return;
    const anchorAt = anchorTile(lead, this.seats);
    if (!anchorAt) return;
    const target = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    if (!target || target === teammate.seatId) return;
    const targetSeat = this.seats.get(target)!;
    const targetDist =
      Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
    const currentSeat = teammate.seatId ? this.seats.get(teammate.seatId) : undefined;
    const currentDist = currentSeat
      ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
      : Infinity;
    if (targetDist < currentDist) {
      this.reassignSeat(teammateId, target);
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    // Find the closest walkable tile to the parent, avoiding tiles occupied by other characters
    const parentCol = parentCh ? parentCh.tileCol : 0;
    const parentRow = parentCh ? parentCh.tileRow : 0;
    let spawn = { col: parentCol, row: parentRow };
    if (this.walkableTiles.length > 0) {
      spawn = this.closestFreeWalkableTile(parentCol, parentRow) ?? this.walkableTiles[0];
    }

    const ch = createCharacter(id, palette, null, null, hueShift);
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    // Face the same direction as the parent agent
    if (parentCh) ch.dir = parentCh.dir;
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    ch.figure = parentCh?.figure;
    // Standing, not the character default TYPE: TYPE on the spawn tile is the
    // sitting pose on bare floor, and an active TYPE never stands up again.
    ch.state = CharacterState.IDLE;
    // It works at a free computer near its parent (it walks there from the
    // spawn tile); freed again when it is removed.
    const seatId = this.subagentSeat(parentCh);
    if (seatId) {
      this.seats.get(seatId)!.assigned = true;
      ch.seatId = seatId;
    }
    // Like any newcomer it comes in through the entrance, when that is not
    // too far from its parent; otherwise it appears beside the parent.
    const e = this.entrance();
    if (
      e &&
      parentCh &&
      Math.abs(parentCh.tileCol - e.col) + Math.abs(parentCh.tileRow - e.insideRow) <=
        SUBAGENT_DOOR_MAX_TILES
    ) {
      this.arriveViaDoor(ch, e);
    } else {
      startMatrixEffect(ch, 'spawn');
    }
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** The free seat a new sub-agent takes: the closest one facing a computer,
   *  measured from its parent's seat (or tile); else the closest free seat of
   *  any kind; null when the office is full. */
  private subagentSeat(parent: Character | undefined): string | null {
    const anchor = anchorTile(parent, this.seats) ?? { col: 0, row: 0 };
    const electronics = this.buildElectronicsTileSet();
    const free = new Map([...this.seats].filter(([, s]) => !s.assigned));
    const atComputer = new Map(
      [...free].filter(([, s]) => this.isSeatFacingElectronics(s, electronics)),
    );
    return (
      closestFreeSeat(atComputer, anchor.col, anchor.row) ??
      closestFreeSeat(free, anchor.col, anchor.row)
    );
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch && this.dropQueued(ch)) {
      this.subagentIdMap.delete(key);
      this.subagentMeta.delete(id);
      return;
    }
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
        ch.seatId = null;
      }
      ch.bubbleType = null;
      const lead = this.characters.get(parentAgentId);
      if (lead && !lead.matrixEffect && !isLeaving(lead) && !ch.matrixEffect) {
        // Done: walk over to the lead and report before vanishing.
        ch.isActive = false;
        ch.reportTimer = SUBAGENT_REPORT_MAX_SEC;
        this.startVisit(ch, { targetId: parentAgentId, summary: SUBAGENT_REPORT_PHRASE });
      } else {
        // Start despawn animation — keep character in map for rendering
        startMatrixEffect(ch, 'despawn');
      }
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch && this.dropQueued(ch)) {
          this.subagentMeta.delete(id);
          toRemove.push(key);
          continue;
        }
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          // Start despawn animation
          startMatrixEffect(ch, 'despawn');
          ch.bubbleType = null;
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.isActive = active;
      if (!active) {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        // Prevents the WALK handler from setting a 2-4 min rest on arrival.
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
      }
      this.rebuildFurnitureInstances();
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Electronics turn ON only in front of an agent working at its desk
    const electronics = this.electronicsTiles();
    const autoOnTiles = collectAutoOnTiles(
      this.characters.values(),
      this.seats,
      (id) => this.idleSinceById.has(id),
      (col, row) => electronics.has(`${col},${row}`),
    );
    // ...and a lounge game lights up while its players are at it
    for (const tile of litGameTiles(this.characters.values(), this.loungeGames())) {
      autoOnTiles.add(tile);
    }

    const door = this.entrance();
    if (autoOnTiles.size === 0 && this.doorFrameShown === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture);
      return;
    }

    // Build modified furniture list with auto-state and animation applied
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      if (door && item.uid === door.uid) {
        // The entrance shows the opening frame its openness calls for.
        const frames = getAnimationFrames(getOnStateType(item.type)) ?? [];
        return this.doorFrameShown > 0 && frames.length > 0
          ? { ...item, type: frames[Math.min(frames.length, this.doorFrameShown) - 1] }
          : item;
      }
      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            let onType = getOnStateType(item.type);
            if (onType !== item.type) {
              // Check if the on-state type has animation frames
              const frames = getAnimationFrames(onType);
              if (frames && frames.length > 1) {
                const frameIdx = animationFrameFor(item.uid, animFrame, frames.length);
                onType = frames[frameIdx];
              }
              return { ...item, type: onType };
            }
            return item;
          }
        }
      }
      return item;
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.waitingAwaitingInput = awaitingInput;
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  // ── Pets ──────────────────────────────────────────────────────

  /**
   * Add a pet to the live runtime. Spawns at a uniformly-random walkable tile.
   * Mirror in `this.layout.pets` so debounced saveLayout serialises the roster.
   * Bounds-checks petType against the loaded sprite count to defend against stale layouts.
   */
  addPet(placedPet: PlacedPet): void {
    // Defensive guards (upstream 5e6c0a0)
    if (
      typeof placedPet.id !== 'string' ||
      placedPet.id.length === 0 ||
      placedPet.id.length > MAX_PET_ID_LENGTH
    ) {
      return;
    }
    if (
      !Number.isInteger(placedPet.petType) ||
      placedPet.petType < 0 ||
      placedPet.petType >= getPetCount()
    ) {
      return;
    }
    if (this.pets.some((p) => p.id === placedPet.id)) return; // de-dupe
    if (this.walkableTiles.length === 0) return; // no spawn space — silently drop

    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    const pet = createPet(placedPet.id, placedPet.petType, spawn.col, spawn.row);
    pet.name = getPetName(placedPet.petType);
    this.pets.push(pet);
    this.syncLayoutPets();
  }

  /** Remove a pet by id. Idempotent. */
  removePet(id: string): void {
    const before = this.pets.length;
    this.pets = this.pets.filter((p) => p.id !== id);
    if (this.pets.length !== before) {
      this.syncLayoutPets();
    }
  }

  /** Shallow snapshot for external consumers (renderer, hooks). */
  getPets(): Pet[] {
    return this.pets.slice();
  }

  /** Unique petType values currently placed. Used by the Pets toolbar to mark active rows. */
  getActivePetTypes(): number[] {
    const seen = new Set<number>();
    for (const p of this.pets) seen.add(p.petType);
    return Array.from(seen);
  }

  /**
   * Hit-test pets at a pixel world position. Sorts back-to-front (largest y wins on tie)
   * so the visually-frontmost pet receives the click.
   * Returns the pet id or null.
   */
  getPetAt(worldX: number, worldY: number): string | null {
    const ordered = this.pets.slice().sort((a, b) => b.y - a.y);
    for (const pet of ordered) {
      const left = pet.x - PET_HIT_HALF_WIDTH;
      const right = pet.x + PET_HIT_HALF_WIDTH;
      const top = pet.y - PET_HIT_HEIGHT;
      const bottom = pet.y;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return pet.id;
      }
    }
    return null;
  }

  /** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
  showPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet) return;
    pet.bubbleType = 'heart';
    pet.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  }

  /** Dismiss the heart bubble on click; collapses timer to a fast fade. */
  dismissPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet || !pet.bubbleType) return;
    pet.bubbleTimer = Math.min(pet.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
  }

  /**
   * Reconcile `this.pets` to match the layout's placed-pet roster.
   * - Pets in layout but not in runtime → spawn via addPet().
   * - Pets in runtime but not in layout → remove.
   * - Pets in both → keep existing runtime state (position, FSM).
   *
   * Called from constructor and rebuildFromLayout. Always runs AFTER walkableTiles
   * is populated.
   */
  private rebuildPetsFromLayout(layout: OfficeLayout): void {
    const placed = layout.pets ?? [];
    const placedIds = new Set(placed.map((p) => p.id));

    // 1. Remove pets no longer in layout
    this.pets = this.pets.filter((p) => placedIds.has(p.id));

    // 2. Add pets that exist in layout but not in runtime
    const existingIds = new Set(this.pets.map((p) => p.id));
    for (const p of placed) {
      if (existingIds.has(p.id)) continue;
      this.addPet(p); // pushes onto this.pets, calls syncLayoutPets()
    }
    // syncLayoutPets() inside addPet keeps this.layout.pets coherent; one final
    // sync handles the removal-only branch where addPet was never called.
    this.syncLayoutPets();
  }

  /**
   * Re-export the current pet roster into `this.layout.pets`. Called only from
   * mutating methods (addPet / removePet / rebuildPetsFromLayout) — NEVER from
   * getLayout(), which runs on every render frame.
   */
  private syncLayoutPets(): void {
    this.layout.pets = this.pets.map((p) => ({ id: p.id, petType: p.petType }));
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    const wasUnlinked = ch.leadAgentId === undefined;
    ch.teamName = teamName;
    ch.agentName = agentName;
    ch.isTeamLead = isTeamLead;
    ch.leadAgentId = leadAgentId;
    if (teamUsesTmux !== undefined) {
      ch.teamUsesTmux = teamUsesTmux;
    }
    // A teammate is not a headless agent: clicking it focuses its lead's terminal.
    // Adopted sessions are marked headless at creation and only later discovered
    // to be teammates, so drop the mark once the link lands.
    if (leadAgentId !== undefined) {
      ch.isHeadless = false;
    }
    // A teammate discovered only after its plain external session was adopted is
    // linked here, not at creation, so it never went through the seat-next-to-lead
    // path addAgent runs for inline teammates. Cluster it now, once, on first link.
    if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
      this.reseatNextToLead(id, leadAgentId);
    }
  }

  /** Mark an agent as headless (adopted, no terminal to focus). */
  setHeadless(id: number, headless: boolean): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isHeadless = headless;
  }

  /** Record which hook provider the agent comes from (drives the Codex badge). */
  setProvider(id: number, providerId: string | undefined): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.providerId = providerId;
  }

  /**
   * `fromId` sent `toId` a message: walk the sender to the free walkable tile
   * closest to the recipient and have it say `summary` there. A sender that is
   * already on a visit queues it (see requestVisit); unknown or sub-agent
   * characters are ignored.
   */
  startConversation(fromId: number, toId: number, summary?: string): void {
    const ch = this.characters.get(fromId);
    const to = this.characters.get(toId);
    if (!ch || ch.isSubagent || fromId === toId || !to || isLeaving(to) || isLeaving(ch)) return;
    const now = Date.now();
    const meetingOn = this.meetings.has(meetingKey(fromId, toId));
    const reply = isReply(this.lastSent, fromId, toId, now);
    this.lastSent.set(`${fromId}>${toId}`, now);
    if ((meetingOn || reply) && this.meet(ch, to, summary, now)) return;
    if (requestVisit(ch, { targetId: toId, summary }) === 'start') {
      this.startVisit(ch, { targetId: toId, summary });
    }
  }

  private startVisit(ch: Character, req: VisitRequest): void {
    const target = this.characters.get(req.targetId);
    if (!target) return;
    if (ch.lounge) this.leaveLounge(ch); // a message beats a coffee
    const anchor = this.visitAnchor(ch, target);
    ch.path = this.visitPath(ch, target, anchor);
    beginVisit(ch, req, anchor);
  }

  private visitAnchor(ch: Character, target: Character): { col: number; row: number } {
    // Answering an agent that is visiting you: stay put, it is coming here.
    if (target.visit?.targetId === ch.id) return { col: ch.tileCol, row: ch.tileRow };
    return visitDestination(target, target.seatId ? this.seats.get(target.seatId) : undefined);
  }

  private visitPath(
    ch: Character,
    target: Character,
    anchor: { col: number; row: number },
  ): Array<{ col: number; row: number }> {
    return target.visit?.targetId === ch.id ? [] : this.pathNextTo(ch, anchor);
  }

  /** Path to the free walkable tile closest to `anchor` (empty if already there). */
  private pathNextTo(
    ch: Character,
    anchor: { col: number; row: number },
  ): Array<{ col: number; row: number }> {
    // Beside the destination, never on it: the recipient will stand there.
    const spot = this.closestFreeWalkableTile(anchor.col, anchor.row, 1);
    if (!spot || (spot.col === ch.tileCol && spot.row === ch.tileRow)) return [];
    return this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, spot.col, spot.row, this.tileMap, this.blockedTiles),
    );
  }

  /** A walking sender whose recipient changed course re-aims, at a tile
   *  boundary so the walk does not jump back mid-step. */
  private retargetVisit(ch: Character): void {
    const visit = ch.visit;
    const target = visit && this.characters.get(visit.targetId);
    if (!visit || !target || visit.phase !== 'going' || ch.moveProgress !== 0) return;
    // After one re-aim, follow where the recipient IS rather than where it
    // was heading (heading somewhere it never reached is why we re-aimed).
    let anchor = visit.retried
      ? { col: target.tileCol, row: target.tileRow }
      : this.visitAnchor(ch, target);
    const sameAnchor =
      visit.anchor && anchor.col === visit.anchor.col && anchor.row === visit.anchor.row;
    if (!visit.retried && visit.waited >= CONVERSATION_WAIT_SEC) {
      // Waited too long beside where it was heading: aim at where it IS.
      anchor = { col: target.tileCol, row: target.tileRow };
      visit.retried = true;
      visit.waited = 0;
    } else if (sameAnchor) {
      return;
    }
    visit.anchor = anchor;
    ch.path = this.visitPath(ch, target, anchor);
    ch.state = ch.path.length > 0 ? CharacterState.WALK : CharacterState.IDLE;
  }

  /** Since when an agent has been idle (agentIdleSince); undefined = working. */
  /** "Lvl N!" over figures that just went up a level: level and seconds left. */
  levelUps = new Map<number, { level: number; timer: number }>();

  showLevelUp(id: number, level: number): void {
    this.levelUps.set(id, { level, timer: LEVEL_UP_BUBBLE_SEC });
  }

  setAgentIdleSince(id: number, since: number | undefined): void {
    if (since === undefined) this.idleSinceById.delete(id);
    else this.idleSinceById.set(id, since);
    this.rebuildFurnitureInstances();
  }

  private loungeKeys(): Set<string> {
    if (this.loungeCache?.layout !== this.layout) {
      this.loungeCache = { layout: this.layout, keys: loungeTileKeys(this.layout) };
    }
    return this.loungeCache.keys;
  }

  /**
   * Idle-in-the-lounge step for one character. Returns true when the lounge
   * drove it this frame (skip the FSM), false to let the FSM run — which is
   * also how an agent that turned active walks back to its own seat.
   */
  private updateLounge(ch: Character, dt: number, now: number): boolean {
    const wants = this.loungeKeys().size > 0 && wantsLounge(ch, this.idleSinceById.get(ch.id), now);
    if (!wants) {
      if (ch.lounge) this.leaveLounge(ch);
      return false;
    }
    if (!ch.lounge) {
      // Don't cut a walk short; start from a standstill or a seat.
      if (ch.state === CharacterState.WALK) return false;
      if (!planLoungeActivity(ch, this.loungeContext(), Math.random)) return false;
    }
    const lounge = ch.lounge!;
    const partner =
      lounge.partnerId !== undefined ? this.characters.get(lounge.partnerId) : undefined;
    if (advanceLounge(ch, dt, this.seats, partner, walkFrame, Math.random) === 'next') {
      if (!planLoungeActivity(ch, this.loungeContext(), Math.random)) {
        endLounge(ch);
        return false;
      }
    }
    return true;
  }

  private meetingKeys(): Set<string> {
    if (this.meetingCache?.layout !== this.layout) {
      this.meetingCache = { layout: this.layout, keys: roleTileKeys(this.layout, 'meeting') };
    }
    return this.meetingCache.keys;
  }

  /**
   * Seat two agents that are writing back and forth in the meeting room, or
   * (already meeting) let the new message speak. False when there is no
   * meeting room or no two free chairs: the caller falls back to a visit.
   */
  private meet(from: Character, to: Character, summary: string | undefined, now: number): boolean {
    const key = meetingKey(from.id, to.id);
    let m = this.meetings.get(key);
    if (!m) {
      const keys = this.meetingKeys();
      if (keys.size === 0) return false;
      const claimed = new Set<string>();
      for (const c of this.characters.values()) if (c.meeting) claimed.add(c.meeting.seatUid);
      const pair = pickMeetingSeats(this.seats.values(), keys, claimed);
      if (!pair) return false;
      m = { a: from.id, b: to.id, lastAt: now, talkTimer: 0, pending: [] };
      this.meetings.set(key, m);
      // The message that started it all, if the desk visit never got to say it.
      for (const ch of [from, to]) {
        const other = ch === from ? to : from;
        if (ch.visit?.targetId === other.id && ch.visit.phase === 'going') {
          m.pending.push({ speakerId: ch.id, summary: ch.visit.summary });
        }
      }
      for (const [ch, seat] of [
        [from, pair[0]],
        [to, pair[1]],
      ] as const) {
        // Their desk visit to each other is replaced by the meeting.
        if (ch.visit && (ch.visit.targetId === from.id || ch.visit.targetId === to.id)) {
          ch.visit = undefined;
        }
        if (ch.visitQueue) {
          ch.visitQueue = ch.visitQueue.filter(
            (r) => r.targetId !== from.id && r.targetId !== to.id,
          );
        }
        if (ch.lounge) this.leaveLounge(ch);
        ch.meeting = { seatUid: seat.uid, arrived: false };
        const chairKey = `${seat.seatCol},${seat.seatRow}`;
        const wasBlocked = this.blockedTiles.delete(chairKey);
        ch.path = this.withOwnSeatUnblocked(ch, () =>
          findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            this.tileMap,
            this.blockedTiles,
          ),
        );
        if (wasBlocked) this.blockedTiles.add(chairKey);
        ch.moveProgress = 0;
      }
    }
    m.lastAt = now;
    m.pending.push({ speakerId: from.id, summary });
    return true;
  }

  /** End meetings nobody has written in for MEETING_IDLE_SEC, or that lost a participant. */
  private advanceMeetings(dt: number, now: number): void {
    for (const [key, m] of this.meetings) {
      const a = this.characters.get(m.a);
      const b = this.characters.get(m.b);
      const seated = !!a?.meeting?.arrived && !!b?.meeting?.arrived;
      advanceMeetingTalk(m, seated, dt, MEETING_TALK_SEC);
      // Silence counts from the last line said, not from when it was written.
      if (m.talkTimer > 0 || m.pending.length > 0) m.lastAt = Math.max(m.lastAt, now - 1);
      const gone = (c: Character | undefined) => !c || isLeaving(c) || c.matrixEffect === 'despawn';
      if (now - m.lastAt < MEETING_IDLE_SEC * 1000 && !gone(a) && !gone(b)) continue;
      this.meetings.delete(key);
      for (const c of [a, b]) {
        if (c?.meeting) {
          c.meeting = undefined;
          c.path = [];
          c.state = CharacterState.IDLE; // the FSM walks it back to its own seat
        }
      }
    }
  }

  /** In a meeting: walk to the meeting chair and sit. True when it drove the character this frame. */
  private updateMeeting(ch: Character, dt: number): boolean {
    if (!ch.meeting) return false;
    advanceMeetingSeat(ch, this.seats.get(ch.meeting.seatUid), dt, walkFrame);
    return true;
  }

  /** The bubble a meeting speaker shows now, if any (ToolOverlay). */
  meetingLine(id: number): string | undefined {
    for (const m of this.meetings.values()) {
      if (m.speakerId === id && m.talkTimer > 0) return m.summary ?? '...';
    }
    return undefined;
  }

  /** "col,row" keys of the attention Area (väntezonen), cached per layout object. */
  private attentionKeys(): Set<string> {
    if (this.attentionCache?.layout !== this.layout) {
      this.attentionCache = { layout: this.layout, keys: roleTileKeys(this.layout, 'attention') };
    }
    return this.attentionCache.keys;
  }

  /**
   * Waiting-on-Rasmus step for one character. Returns true when the zone
   * drove it this frame (skip the lounge and the FSM). An answer or an
   * approval clears it, and the FSM walks the agent back to its seat.
   */
  private updateAttention(ch: Character, dt: number, now: number): boolean {
    const keys = this.attentionKeys();
    const needs = keys.size > 0 && needsRasmus(ch);
    if (!needs) {
      this.attentionSince.delete(ch.id);
      if (ch.attention) {
        ch.attention = undefined;
        ch.path = [];
      }
      return false;
    }
    if (!this.attentionSince.has(ch.id)) this.attentionSince.set(ch.id, now);
    if (!ch.attention) {
      if (!wantsAttention(this.attentionSince.get(ch.id), now)) return false;
      if (ch.state === CharacterState.WALK) return false; // don't cut a walk short
      const spot = pickAttentionTile(ch, keys, this.walkableKeys(), this.characters.values());
      if (!spot) return false; // the zone is full: wait where it is
      const path = this.withOwnSeatUnblocked(ch, () =>
        findPath(ch.tileCol, ch.tileRow, spot.col, spot.row, this.tileMap, this.blockedTiles),
      );
      if (path.length === 0 && (ch.tileCol !== spot.col || ch.tileRow !== spot.row)) return false;
      if (ch.lounge) this.leaveLounge(ch);
      ch.attention = { ...spot, arrived: false };
      ch.path = path;
      ch.moveProgress = 0;
    }
    advanceAttention(ch, dt, walkFrame);
    return true;
  }

  private walkableKeys(): Set<string> {
    if (this.walkableKeyCache?.tiles !== this.walkableTiles) {
      this.walkableKeyCache = {
        tiles: this.walkableTiles,
        keys: new Set(this.walkableTiles.map((t) => `${t.col},${t.row}`)),
      };
    }
    return this.walkableKeyCache.keys;
  }

  /** Stop lounging, turning a seated chat partner back to its seat first. */
  private leaveLounge(ch: Character): void {
    const partnerId = ch.lounge?.partnerId;
    releasePartner(
      ch,
      partnerId !== undefined ? this.characters.get(partnerId) : undefined,
      this.seats,
    );
    endLounge(ch);
  }

  /** The map, as the lounge rules see it (see planLoungeActivity). */
  private loungeGames(): LoungeGame[] {
    if (this.gamesCache?.layout !== this.layout) {
      this.gamesCache = { layout: this.layout, games: gamesInLayout(this.layout.furniture) };
    }
    return this.gamesCache.games;
  }

  private loungeContext(): LoungeContext {
    return {
      keys: this.loungeKeys(),
      games: this.loungeGames(),
      characters: this.characters.values(),
      seats: this.seats.values(),
      walkableTiles: this.walkableTiles,
      pathTo: (ch, col, row) => {
        // A lounge seat is a chair tile, blocked for walking: open it (and
        // the agent's own seat) for this one search.
        const key = `${col},${row}`;
        const wasBlocked = this.blockedTiles.delete(key);
        const path = this.withOwnSeatUnblocked(ch, () =>
          findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
        );
        if (wasBlocked) this.blockedTiles.add(key);
        return path;
      },
      freeTileBeside: (col, row) => this.closestFreeWalkableTile(col, row, 1),
    };
  }

  /** Crown an agent (config crownedSessions). Remembered for an agent whose
   *  character does not exist yet: the session name can arrive before the
   *  layout has placed it, and addAgent applies it then. */
  /** An agent's session name arrived: remember it, and if a seat is kept for
   *  that name, walk there. Like crowning, it may arrive before the character. */
  setAgentSessionName(id: number, name: string): void {
    if (this.sessionNames.get(id) === name) return;
    this.sessionNames.set(id, name);
    this.claimOwnedSeat(id);
  }

  /** Move an agent to the seat kept for its name, swapping anyone sitting
   *  there into the owner's old seat. Returns the owner's old seat when it is
   *  left free. No-op (null) without a kept seat or when already there. */
  private claimOwnedSeat(id: number): string | null {
    const ch = this.characters.get(id);
    const seatUid = seatOwnedBy(this.layout, this.sessionNames.get(id));
    const seat = seatUid ? this.seats.get(seatUid) : undefined;
    if (!ch || ch.isSubagent || isLeaving(ch) || !seatUid || !seat || ch.seatId === seatUid)
      return null;
    // Whoever sits there swaps: it takes the owner's old seat (or any free one).
    const sitter = seat.assigned
      ? [...this.characters.values()].find((c) => c.seatId === seatUid)
      : undefined;
    const ownersOld = ch.seatId;
    if (sitter) {
      seat.assigned = false;
      sitter.seatId = null;
    }
    this.reassignSeat(id, seatUid);
    if (sitter) {
      const other =
        ownersOld && !this.seats.get(ownersOld)?.assigned
          ? ownersOld
          : this.findFreeSeat(sitter.directoryName);
      if (other) this.reassignSeat(sitter.id, other);
    }
    return ownersOld && !this.seats.get(ownersOld)?.assigned ? ownersOld : null;
  }

  /** An agent's generated figure arrived: it and its sub-agents draw with it. */
  setAgentFigure(id: number, seed: string): void {
    this.figureById.set(id, seed);
    for (const ch of this.characters.values()) {
      if (ch.id === id || (ch.isSubagent && ch.parentAgentId === id)) ch.figure = seed;
    }
  }

  setAgentCrowned(id: number, crowned: boolean): void {
    if (crowned) this.crownedAgentIds.add(id);
    else this.crownedAgentIds.delete(id);
    const ch = this.characters.get(id);
    if (ch) ch.crowned = crowned;
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.contextTokens = contextTokens;
    ch.maxContextTokens = maxContextTokens;
  }

  update(dt: number): void {
    for (const [id, up] of this.levelUps) {
      up.timer -= dt;
      if (up.timer <= 0) this.levelUps.delete(id);
    }
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    // The entrance door swings toward open while someone passes through
    const door = this.entrance();
    let doorMoved = false;
    if (door) {
      this.doorOpenness = advanceOpenness(
        this.doorOpenness,
        doorWanted(this.characters.values(), door),
        dt,
      );
      const frames =
        getAnimationFrames(
          getOnStateType(this.layout.furniture.find((f) => f.uid === door.uid)?.type ?? ''),
        ) ?? [];
      const frame = doorFrame(this.doorOpenness, frames.length);
      doorMoved = frame !== this.doorFrameShown;
      this.doorFrameShown = frame;
    }
    if (newFrame !== prevFrame || doorMoved) {
      this.rebuildFurnitureInstances();
    }

    // The greeter materializes and dematerializes like anyone else, but runs
    // no FSM — it stands where it spawned for as long as the ask is up.
    if (this.greeter && advanceMatrixEffect(this.greeter, dt) === 'despawned') {
      this.greeter = null;
    }

    // Recipients being talked to hold still (position and facing) for the
    // talk; while the sender is still walking over they carry on as usual.
    const heldForTalk = new Set<number>();
    for (const ch of this.characters.values()) {
      if (ch.visit?.phase === 'talking') heldForTalk.add(ch.visit.targetId);
    }

    const now = Date.now();
    const toDelete: number[] = [];
    this.advanceDoorQueue();
    this.advanceMeetings(dt, now);
    for (const ch of this.characters.values()) {
      if (this.isQueued(ch)) continue; // waiting its turn at the door, unseen
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      if (ch.doorway) {
        // Coming in or going out through the entrance replaces the FSM.
        const e = this.entrance();
        const r = e ? advanceDoorway(ch, e, this.doorOpenness, dt, walkFrame) : 'timeout';
        if (r === 'entered') this.walkToSeat(ch);
        if (r === 'out' || r === 'timeout') {
          ch.doorway = undefined;
          startMatrixEffect(ch, 'despawn');
        }
        continue;
      }
      if (ch.reportTimer !== undefined && (ch.reportTimer -= dt) <= 0) {
        ch.visit = undefined; // never got there: vanish where it stands
        startMatrixEffect(ch, 'despawn');
        continue;
      }
      if (ch.visit) {
        // Delivering a message: the visit replaces the FSM until it ends.
        this.retargetVisit(ch);
        const target = this.characters.get(ch.visit.targetId);
        const reported = advanceVisit(ch, target, dt, walkFrame) === 'done';
        if (reported && ch.reportTimer !== undefined) {
          // A sub-agent's report is its last act: out through the door if it
          // is close enough, else it vanishes where it stands.
          if (!this.leaveViaDoor(ch, SUBAGENT_DOOR_MAX_TILES)) startMatrixEffect(ch, 'despawn');
        } else if (reported) {
          const next = ch.visitQueue?.shift();
          if (next) this.startVisit(ch, next);
        }
      } else if (
        !heldForTalk.has(ch.id) &&
        !this.updateAttention(ch, dt, now) &&
        !this.updateMeeting(ch, dt) &&
        !this.updateLounge(ch, dt, now)
      ) {
        // Temporarily unblock own seat so character can pathfind to it
        this.withOwnSeatUnblocked(ch, () =>
          updateCharacter(ch, dt, this.walkableTiles, this.seats, this.tileMap, this.blockedTiles),
        );
      }

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
    }

    // ── Pet FSM ────────────────────────────────────────────────
    for (const pet of this.pets) {
      updatePet(pet, dt, this.walkableTiles, this.characters, this.tileMap, this.blockedTiles);

      // Tick heart bubble timer (mirrors character waiting-bubble pattern)
      if (pet.bubbleType) {
        pet.bubbleTimer -= dt;
        if (pet.bubbleTimer <= 0) {
          pet.bubbleType = null;
          pet.bubbleTimer = 0;
        }
      }
    }
  }

  /** The `saveAgentSeats` payload: palette, hue and seat for every agent worth
   *  restoring. Sub-agents are excluded because they are derived state the
   *  runtime re-materializes, and the greeter never reaches here at all —
   *  it is not in `characters`. */
  getPersistableSeats(): Record<
    number,
    { palette: number; hueShift: number; seatId: string | null }
  > {
    const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
    }
    return seats;
  }

  /** Everything the renderer draws: the agents plus, while the first-run ask
   *  is up, the consent greeter. This is the ONE place the greeter joins the
   *  agents — every other consumer reads `characters` and gets agents only. */
  getCharacters(): Character[] {
    const chars = Array.from(this.characters.values());
    if (this.greeter) chars.push(this.greeter);
    return chars;
  }

  /** Get character at pixel position (for hit testing). Returns id or null.
   *  Agents only: clicks pass straight through the consent greeter, which is
   *  a prop, not something to select or follow. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = Array.from(this.characters.values()).sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      // Skip characters that are despawning
      if (ch.matrixEffect === 'despawn') continue;
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchorY = ch.y + sittingOffset;
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }
}
