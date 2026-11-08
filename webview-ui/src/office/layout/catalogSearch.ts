import type { FurnitureCatalogEntry } from '../types.js';

/** The palette's pack filter: everything, only bundled items, or one pack id. */
export type PackFilter = 'all' | 'builtin' | string;

/** Pack ids present in a catalog, sorted (bundled items have none). */
export function listPacks(entries: readonly FurnitureCatalogEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => (e.pack ? [e.pack] : [])))].sort();
}

/**
 * Palette items matching a pack filter and a free-text query. The query is
 * split on whitespace and every word must appear (case-insensitively) in the
 * label, the asset id or a tag, so "kaffe maskin" finds a coffee machine
 * tagged "kaffe".
 */
export function filterCatalog<T extends FurnitureCatalogEntry>(
  entries: readonly T[],
  { query, pack }: { query: string; pack: PackFilter },
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (pack === 'builtin' && e.pack) return false;
    if (pack !== 'all' && pack !== 'builtin' && e.pack !== pack) return false;
    if (words.length === 0) return true;
    const haystack = [e.label, e.type, ...(e.tags ?? [])].join(' ').toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
