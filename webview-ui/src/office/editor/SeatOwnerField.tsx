import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';

interface SeatOwnerFieldProps {
  /** Session name the selected seat is kept for, if any. */
  owner: string | undefined;
  /** Session names in the office now, offered as suggestions. */
  names: readonly string[];
  onChange: (name: string | null) => void;
}

/**
 * "Reserved for" on a selected chair: keeps the seat for one agent by its
 * session name (see office/engine/seatOwners.ts). Commits on Enter or blur,
 * not per keystroke, since every commit sends the agent walking.
 */
export function SeatOwnerField({ owner, names, onChange }: SeatOwnerFieldProps) {
  const [draft, setDraft] = useState(owner ?? '');
  useEffect(() => setDraft(owner ?? ''), [owner]);
  const commit = () => {
    if (draft.trim() !== (owner ?? '')) onChange(draft.trim() || null);
  };
  return (
    <div className="flex gap-4 items-center">
      <span className="text-sm text-text-muted whitespace-nowrap">Reserved for</span>
      <input
        type="text"
        list="seat-owner-names"
        value={draft}
        placeholder="anyone"
        aria-label="Reserved for"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="min-w-0 flex-1 text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
      />
      <datalist id="seat-owner-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {owner && (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)} title="Free this seat">
          Clear
        </Button>
      )}
    </div>
  );
}
