import { useEffect } from 'react';

import { QUOTA_PANEL_Z_INDEX } from '../../constants.js';
import {
  QUOTA_PANEL_MARGIN_PX,
  QUOTA_PANEL_WIDTH_PX,
  type QuotaInfo,
  type QuotaLevel,
  quotaPanelWindows,
  quotaUpdatedText,
} from '../quotaFormat.js';

interface QuotaPanelProps {
  title: string;
  info: QuotaInfo | undefined;
  nowSec: number;
  left: number;
  top: number;
  /** Width of the office area, so the panel never outgrows a phone. */
  maxWidth: number;
  /** Pinned panels take clicks and show the close button. */
  pinned: boolean;
  onClose: () => void;
}

const LEVEL_COLOR: Record<QuotaLevel, string> = {
  ok: 'var(--quota-ok)',
  warn: 'var(--quota-warn)',
  danger: 'var(--quota-danger)',
  unknown: 'var(--quota-unknown)',
};

/** Detail panel of a quota TV: per window percent bar, reset time, data age. */
export function QuotaPanel({
  title,
  info,
  nowSec,
  left,
  top,
  maxWidth,
  pinned,
  onClose,
}: QuotaPanelProps) {
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned, onClose]);

  const windows = quotaPanelWindows(info, nowSec);
  const updated = quotaUpdatedText(info, nowSec);

  return (
    <div
      className={`absolute bg-bg border-2 border-border text-text p-6 ${pinned ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        left,
        top,
        width: Math.min(QUOTA_PANEL_WIDTH_PX, maxWidth - 2 * QUOTA_PANEL_MARGIN_PX),
        boxShadow: 'var(--pixel-shadow)',
        zIndex: QUOTA_PANEL_Z_INDEX,
      }}
      data-testid="quota-panel"
      role="dialog"
      aria-label={`Kvot ${title}`}
    >
      <div className="flex items-center justify-between mb-4">
        <b>{title}</b>
        {pinned && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="px-4 cursor-pointer bg-transparent text-text border-0"
          >
            ×
          </button>
        )}
      </div>
      {!info && <div style={{ color: LEVEL_COLOR.unknown }}>Ingen kvotdata ännu</div>}
      {info &&
        windows.map((w) => (
          <div key={w.label} className="mb-4" data-testid="quota-panel-window">
            <div className="flex justify-between">
              <span>{w.label}</span>
              <span style={{ color: LEVEL_COLOR[w.level] }}>{w.value}</span>
            </div>
            <div className="flex gap-1 my-2" aria-hidden>
              {w.cellColors.map((color, i) => (
                <span key={i} className="flex-1 h-6" style={{ backgroundColor: color }} />
              ))}
            </div>
            <div style={{ color: 'var(--quota-reset)' }}>
              {w.relative ? `Återställs ${w.relative} (${w.clock})` : 'Återställning okänd'}
            </div>
          </div>
        ))}
      {updated && <div style={{ color: 'var(--quota-reset)' }}>{updated}</div>}
    </div>
  );
}
