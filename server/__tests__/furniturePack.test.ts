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
});
