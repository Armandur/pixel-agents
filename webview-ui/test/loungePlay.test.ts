/** Games in the lounge: who plays where, waiting for the opponent, and when the game lights up. */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import type { LoungeContext } from '../src/office/engine/lounge.js';
import { advanceLounge, planLoungeActivity } from '../src/office/engine/lounge.js';
import { gamesInLayout, litGameTiles } from '../src/office/engine/loungePlay.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { Character } from '../src/office/types.js';
import { CharacterState, Direction } from '../src/office/types.js';

beforeAll(() => {
  const base = {
    label: '',
    width: 32,
    height: 48,
    footprintW: 2,
    footprintH: 3,
    isDesk: false,
    category: 'electronics',
  };
  const catalog = [
    {
      ...base,
      id: 'HOCKEY',
      minPlayers: 2,
      playSpots: [
        { dc: 0, dr: -1, dir: 'down' as const },
        { dc: 1, dr: 3, dir: 'up' as const },
      ],
    },
    {
      ...base,
      id: 'ARCADE',
      footprintW: 1,
      footprintH: 2,
      playSpots: [{ dc: 0, dr: 2, dir: 'up' as const }],
    },
    {
      ...base,
      id: 'WIDE',
      footprintW: 2,
      footprintH: 2,
      playSpots: [
        { dc: 0, dr: 2, dir: 'up' as const },
        { dc: 1, dr: 2, dir: 'up' as const },
      ],
    },
  ];
  assert.ok(
    buildDynamicCatalog({ catalog, sprites: { HOCKEY: [['h']], ARCADE: [['a']], WIDE: [['w']] } }),
  );
});

function lounger(id: number, col: number, row: number): Character {
  return {
    id,
    tileCol: col,
    tileRow: row,
    x: col * 16,
    y: row * 16,
    path: [],
    state: CharacterState.IDLE,
    dir: Direction.DOWN,
    isSubagent: false,
    lounge: { phase: 'resting', activity: 'stroll', timer: 5 },
  } as unknown as Character;
}

function ctx(
  chars: Character[],
  furniture: Array<{ uid: string; type: string; col: number; row: number }>,
): LoungeContext {
  const tiles: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) tiles.push({ col: c, row: r });
  return {
    keys: new Set(tiles.map((t) => `${t.col},${t.row}`)),
    characters: chars,
    seats: [],
    walkableTiles: tiles,
    pathTo: (_ch, col, row) => [{ col, row }],
    freeTileBeside: () => null,
    games: gamesInLayout(furniture),
  };
}

const play = () => 0.99; // weights sit 0, stroll 3, mingle 2, play 3 → the last bucket

test('a two-player game recruits a lounger: both walk to opposite ends', () => {
  const a = lounger(1, 0, 0);
  const b = lounger(2, 5, 5);
  const c = ctx([a, b], [{ uid: 'h', type: 'HOCKEY', col: 3, row: 3 }]);
  assert.ok(planLoungeActivity(a, c, play));
  assert.equal(a.lounge?.activity, 'play');
  assert.equal(b.lounge?.gameUid, 'h');
  assert.deepEqual(
    [a.path.at(-1), b.path.at(-1)],
    [
      { col: 3, row: 2 },
      { col: 4, row: 6 },
    ],
  );
});

test('the first to arrive waits; the game lights only with both at it; a quitter ends it', () => {
  const a = lounger(1, 0, 0);
  const b = lounger(2, 5, 5);
  const c = ctx([a, b], [{ uid: 'h', type: 'HOCKEY', col: 3, row: 3 }]);
  planLoungeActivity(a, c, play);
  const step = (ch: Character) => {
    ch.path = [];
  };
  advanceLounge(a, 0.1, new Map(), b, step, () => 0.5); // takes its step
  advanceLounge(a, 0.1, new Map(), b, step, () => 0.5); // arrives
  assert.equal(a.lounge?.phase, 'resting');
  assert.equal(a.dir, Direction.DOWN);
  assert.equal(litGameTiles([a, b], c.games!).size, 0, 'one player: the game stays dark');
  advanceLounge(b, 0.1, new Map(), a, step, () => 0.5);
  advanceLounge(b, 0.1, new Map(), a, step, () => 0.5);
  assert.deepEqual([...litGameTiles([a, b], c.games!)], ['3,3']);
  assert.equal(a.lounge?.timer, b.lounge?.timer, 'one round for both');
  b.lounge = undefined; // b turned active
  assert.equal(
    advanceLounge(a, 0.1, new Map(), b, step, () => 0.5),
    'next',
  );
});

test('a game whose spot is not standable is never offered, and solo games need nobody', () => {
  const a = lounger(1, 0, 0);
  const c = ctx(
    [a],
    [
      { uid: 'h', type: 'HOCKEY', col: 3, row: 3 },
      { uid: 'x', type: 'ARCADE', col: 7, row: 0 },
    ],
  );
  c.walkableTiles = c.walkableTiles.filter((t) => !(t.col === 7 && t.row === 2));
  assert.equal(planLoungeActivity(a, c, play), true);
  assert.notEqual(
    a.lounge?.activity,
    'play',
    'hockey has no opponent and the arcade spot is walled off',
  );
});

test('each machine starts its animation loop at its own frame, and advances one per tick', async () => {
  const { animationFrameFor } = await import('../src/office/engine/autoState.js');
  const a = animationFrameFor('f-a', 0, 60);
  const b = animationFrameFor('f-b', 0, 60);
  assert.notEqual(a, b, 'two machines are not in lockstep');
  assert.equal(animationFrameFor('f-a', 1, 60), (a + 1) % 60);
  assert.equal(animationFrameFor('f-a', 0, 60), a, 'stable for the same uid');
});

test('a game for one or two is played alone, or with a recruited second player', () => {
  const wide = [{ uid: 'w', type: 'WIDE', col: 3, row: 3 }];
  const solo = [lounger(1, 0, 0), lounger(2, 6, 6)];
  // random: 0.99 picks play; the invite roll comes next
  const rolls = (invite: number) => {
    const seq = [0.99, 0, invite, 0];
    return () => seq.shift() ?? 0;
  };
  assert.ok(planLoungeActivity(solo[0], ctx(solo, wide), rolls(0.9)));
  assert.equal(solo[0].lounge?.partnerId, undefined, 'alone');
  const duo = [lounger(1, 0, 0), lounger(2, 6, 6)];
  assert.ok(planLoungeActivity(duo[0], ctx(duo, wide), rolls(0.1)));
  assert.equal(duo[1].lounge?.gameUid, 'w', 'second player recruited');
});
