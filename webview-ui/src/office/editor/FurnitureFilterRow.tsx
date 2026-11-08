import type { PackFilter } from '../layout/catalogSearch.js';

interface FurnitureFilterRowProps {
  query: string;
  onQueryChange: (query: string) => void;
  pack: PackFilter;
  onPackChange: (pack: PackFilter) => void;
  /** Pack ids in the loaded catalog; the pack picker hides when there are none. */
  packs: readonly string[];
}

/** Search field and pack picker above the furniture palette. A query searches
 *  every category; the pack picker narrows to one asset pack (or bundled). */
export function FurnitureFilterRow({
  query,
  onQueryChange,
  pack,
  onPackChange,
  packs,
}: FurnitureFilterRowProps) {
  return (
    <div className="flex gap-4 items-center">
      <input
        type="text"
        value={query}
        placeholder="Search furniture"
        aria-label="Search furniture"
        onChange={(e) => onQueryChange(e.target.value)}
        className="min-w-0 flex-1 text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
      />
      {packs.length > 0 && (
        <select
          value={pack}
          onChange={(e) => onPackChange(e.target.value)}
          aria-label="Asset pack"
          className="text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
        >
          <option value="all">All packs</option>
          <option value="builtin">Built-in</option>
          {packs.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
