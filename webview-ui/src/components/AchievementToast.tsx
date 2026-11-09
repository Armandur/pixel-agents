import { useEffect } from 'react';

import {
  ACHIEVEMENT_LABELS,
  ACHIEVEMENT_TOAST_SEC,
  ACHIEVEMENT_TOAST_Z_INDEX,
} from '../constants.js';
import type { AchievementNotice } from '../hooks/useExtensionMessages.js';

interface AchievementToastProps {
  /** The queue; only its head shows, the rest wait their turn. */
  notices: AchievementNotice[];
  nameFor: (agentId: number) => string;
  onDone: () => void;
  /** Below the mobile shell's top buttons, which share the office's top edge. */
  belowTopButtons?: boolean;
}

/** "★ Dirigent: Lagledare" at the top of the office, one achievement at a time. */
export function AchievementToast({
  notices,
  nameFor,
  onDone,
  belowTopButtons,
}: AchievementToastProps) {
  const head = notices[0];
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(onDone, ACHIEVEMENT_TOAST_SEC * 1000);
    return () => clearTimeout(t);
  }, [head, onDone]);
  if (!head) return null;
  return (
    <div
      key={head.seq}
      className={`absolute left-1/2 -translate-x-1/2 ${belowTopButtons ? 'top-64' : 'top-10'} pixel-panel border-gold px-10 py-4 flex items-center gap-8 whitespace-nowrap overflow-hidden max-w-[90%] pointer-events-none text-base`}
      style={{ zIndex: ACHIEVEMENT_TOAST_Z_INDEX }}
      data-testid="achievement-toast"
      role="status"
    >
      <span className="text-gold">★</span>
      <span className="min-w-0 overflow-hidden text-ellipsis">
        {nameFor(head.agentId)}:{' '}
        <span className="text-gold">
          {ACHIEVEMENT_LABELS[head.achievement] ?? head.achievement}
        </span>
      </span>
    </div>
  );
}
