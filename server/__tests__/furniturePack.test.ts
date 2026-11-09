import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadFurnitureAssets } from '../src/assetLoader.js';

describe('loadFurnitureAssets keeps a manifest pack and tags', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-pack-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function item(id: string, manifest: Record<string, unknown>) {
    const dir = path.join(root, 'assets', 'furniture', id);
    fs.mkdirSync(dir, { recursive: true });
    const png = new PNG({ width: 16, height: 16 });
    png.data.fill(255);
    fs.writeFileSync(path.join(dir, `${id}.png`), PNG.sync.write(png));
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id,
        name: id,
        category: 'misc',
        type: 'asset',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        canPlaceOnWalls: false,
        canPlaceOnSurfaces: false,
        backgroundTiles: 0,
        ...manifest,
      }),
    );
  }

  it('passes well-formed pack and tags through and drops junk', async () => {
    item('RP_MUG', { pack: 'retropi-cafe', tags: ['kaffe', 3, ''] });
    item('PLAIN', { pack: 42 });
    const loaded = await loadFurnitureAssets(root);
    const byId = new Map(loaded!.catalog.map((a) => [a.id, a]));
    expect(byId.get('RP_MUG')).toMatchObject({ pack: 'retropi-cafe', tags: ['kaffe'] });
    expect(byId.get('PLAIN')).not.toHaveProperty('pack');
  });

  it('cuts an autotile sheet into 16 pieces keyed by neighbour mask', async () => {
    const dir = path.join(root, 'assets', 'furniture', 'CTR');
    fs.mkdirSync(dir, { recursive: true });
    const png = new PNG({ width: 64, height: 64 });
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        png.data[i] = Math.floor(y / 16) * 4 + Math.floor(x / 16); // red = mask
        png.data[i + 3] = 255;
      }
    }
    fs.writeFileSync(path.join(dir, 'CTR.png'), PNG.sync.write(png));
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ id: 'CTR', name: 'Ctr', category: 'desks', type: 'autotile' }),
    );
    const loaded = await loadFurnitureAssets(root);
    expect(loaded!.catalog.find((a) => a.id === 'CTR')).toMatchObject({
      autoTile: true,
      isDesk: true,
      footprintW: 1,
      footprintH: 1,
    });
    const red = (id: string) => parseInt(loaded!.sprites.get(id)![15][15].slice(1, 3), 16);
    expect(red('CTR#5')).toBe(5);
    expect(red('CTR#14')).toBe(14);
    expect(loaded!.sprites.get('CTR#0')).toHaveLength(16);
  });

  it('keeps well-formed play spots and a sane minPlayers, drops the rest', async () => {
    item('GAME', {
      playSpots: [
        { dc: 0, dr: 2, dir: 'up' },
        { dc: 1, dr: 2, dir: 'sideways' },
        { dc: 0.5, dr: 1, dir: 'up' },
      ],
      minPlayers: 2,
    });
    item('ODD', { playSpots: 'yes' });
    const loaded = await loadFurnitureAssets(root);
    const byId = new Map(loaded!.catalog.map((a) => [a.id, a]));
    expect(byId.get('GAME')!.playSpots).toEqual([{ dc: 0, dr: 2, dir: 'up' }]);
    expect(byId.get('GAME')).not.toHaveProperty('minPlayers'); // 2 players, 1 usable spot
    expect(byId.get('ODD')).not.toHaveProperty('playSpots');
  });
});
