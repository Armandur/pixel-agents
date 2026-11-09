import { useEffect, useState } from 'react';

import { SIGN_MAX_CHARS } from '../../constants.js';

interface SignTextFieldProps {
  /** The selected sign's text, if any. */
  text: string | undefined;
  onChange: (text: string | null) => void;
}

/** "Sign text" on a selected sign. Commits on Enter or blur, one undo step per edit. */
export function SignTextField({ text, onChange }: SignTextFieldProps) {
  const [draft, setDraft] = useState(text ?? '');
  useEffect(() => setDraft(text ?? ''), [text]);
  const commit = () => {
    if (draft.trim() !== (text ?? '')) onChange(draft.trim() || null);
  };
  return (
    <div className="flex gap-4 items-center">
      <span className="text-sm text-text-muted whitespace-nowrap">Sign text</span>
      <input
        type="text"
        value={draft}
        maxLength={SIGN_MAX_CHARS}
        placeholder="e.g. Kyrkan"
        aria-label="Sign text"
        data-testid="sign-text-input"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Keep R/T/arrows/Delete from reaching the editor shortcuts while typing.
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="min-w-0 flex-1 text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
      />
    </div>
  );
}
