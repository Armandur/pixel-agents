import { useEffect } from 'react';

import { ACHIEVEMENT_IDS, levelForXp, xpForLevel } from '../../../core/src/progress.js';
import { ACHIEVEMENT_LABELS, AGENT_PROGRESS_PANEL_Z_INDEX } from '../constants.js';
import type { AgentProgressInfo } from '../hooks/useExtensionMessages.js';
import { xpText } from './agentProgressContext.js';

interface AgentProgressPanelProps {
  name: string;
  progress: AgentProgressInfo;
  onClose: () => void;
}

/** One agent's level, XP and achievements. Closes on ×, Escape or a click outside. */
export function AgentProgressPanel({ name, progress, onClose }: AgentProgressPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const level = levelForXp(progress.xp);
  const from = xpForLevel(level);
  const fraction = (progress.xp - from) / (xpForLevel(level + 1) - from);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-16"
      style={{ zIndex: AGENT_PROGRESS_PANEL_Z_INDEX }}
      onClick={onClose}
    >
      <div
        className="pixel-panel border-gold! w-full max-w-280 p-10 flex flex-col gap-8"
        data-testid="agent-progress-panel"
        role="dialog"
        aria-label={`Nivå och achievements för ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-8">
          <span className="text-base text-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {name}
          </span>
          <span className="shrink-0 bg-gold text-bg text-2xs leading-none px-4 py-1">
            Lvl {level}
          </span>
          <button
            type="button"
            className="shrink-0 bg-transparent border-0 text-text text-lg leading-none cursor-pointer p-2"
            title="Stäng"
            aria-label="Stäng"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-xs text-text-muted">{xpText(progress.xp)}</span>
          <span className="block h-3 bg-bg-dark">
            <span
              className="block h-full bg-accent-bright"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </span>
        </div>
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {ACHIEVEMENT_IDS.map((id) => {
            const got = progress.achievements.includes(id);
            return (
              <li key={id} className={`text-sm ${got ? 'text-gold' : 'text-text-muted'}`}>
                {got ? '★' : '☆'} {ACHIEVEMENT_LABELS[id] ?? id}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
