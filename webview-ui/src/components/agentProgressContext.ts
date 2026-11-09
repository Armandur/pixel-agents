import { createContext } from 'react';

import { levelForXp, xpForLevel } from '../../../core/src/progress.js';
import type { AgentProgressInfo } from '../hooks/useExtensionMessages.js';

/** Lets any agent card open the progress panel without prop-drilling through
 *  the card bars. `progress` is what the mobile badge reads. */
export interface AgentProgressContextValue {
  open: (agentId: number) => void;
  progress: Record<number, AgentProgressInfo>;
}
export const AgentProgressContext = createContext<AgentProgressContextValue | null>(null);

/** "30 / 60 XP till Lvl 3": XP earned inside the level, the level's span. */
export function xpText(xp: number): string {
  const level = levelForXp(xp);
  const from = xpForLevel(level);
  return `${xp - from} / ${xpForLevel(level + 1) - from} XP till Lvl ${level + 1}`;
}
