import { describe, expect, it } from 'vitest';

import { filterCatalog, listPacks } from '../src/office/layout/catalogSearch.js';
import type { FurnitureCatalogEntry } from '../src/office/types.js';

const item = (type: string, label: string, extra: Partial<FurnitureCatalogEntry> = {}) =>
  ({
    type,
    label,
    footprintW: 1,
    footprintH: 1,
    sprite: [],
    isDesk: false,
    ...extra,
  }) as FurnitureCatalogEntry;

const catalog = [
  item('PC_FRONT_OFF', 'PC'),
  item('RP_COFFEE_MACHINE_A', 'Coffee machine', { pack: 'retropi-office', tags: ['kök', 'kaffe'] }),
  item('RP_CAFE_TABLE_RED', 'Cafe table', { pack: 'retropi-cafe', tags: ['fikarum', 'bord'] }),
];

describe('filterCatalog', () => {
  it('matches every query word in label, id or tags, case-insensitively', () => {
    expect(filterCatalog(catalog, { query: 'KAFFE', pack: 'all' }).map((e) => e.type)).toEqual([
      'RP_COFFEE_MACHINE_A',
    ]);
    expect(filterCatalog(catalog, { query: 'cafe bord', pack: 'all' }).map((e) => e.type)).toEqual([
      'RP_CAFE_TABLE_RED',
    ]);
    expect(filterCatalog(catalog, { query: '', pack: 'all' })).toHaveLength(3);
  });

  it('narrows to one pack or to the bundled items', () => {
    expect(filterCatalog(catalog, { query: '', pack: 'builtin' }).map((e) => e.type)).toEqual([
      'PC_FRONT_OFF',
    ]);
    expect(filterCatalog(catalog, { query: '', pack: 'retropi-cafe' }).map((e) => e.type)).toEqual([
      'RP_CAFE_TABLE_RED',
    ]);
  });

  it('lists the packs present, sorted', () => {
    expect(listPacks(catalog)).toEqual(['retropi-cafe', 'retropi-office']);
  });
});
