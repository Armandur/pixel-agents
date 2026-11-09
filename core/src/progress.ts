/**
 * Levels and achievements: the shared rules. The server counts the work and
 * decides which achievements an agent has earned; both sides derive the
 * level from XP here, so the card's bar and the server can never disagree.
 * Pure, no side effects.
 */

/** XP per unit of work. */
export const XP_PER_TOOL = 1;
export const XP_PER_TURN = 5;
export const XP_PER_SUBAGENT = 3;

/** XP needed to reach `level` (level 1 needs none): 10·N·(N−1). */
export function xpForLevel(level: number): number {
  return 10 * level * (level - 1);
}

/** The level an agent with `xp` has reached (1 and up). */
export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** How far into the current level `xp` is, 0 to 1. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  const from = xpForLevel(level);
  return (xp - from) / (xpForLevel(level + 1) - from);
}

/** Achievement ids, stable on the wire and on disk. Labels live in the webview. */
export const ACHIEVEMENT_IDS = [
  'first-tool',
  'tools-100',
  'tools-1000',
  'first-subagent',
  'team-lead',
  'marathon',
  'night-owl',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** The work counted per agent session. */
export interface ProgressCounts {
  xp: number;
  tools: number;
  turns: number;
  subagents: number;
  achievements: AchievementId[];
}

export const MARATHON_TURN_MS = 30 * 60 * 1000;
/** Local hours [start, end) that count as night. */
export const NIGHT_HOURS: readonly [number, number] = [0, 5];
export const TEAM_LEAD_SUBAGENTS = 5;

/** The achievements the counts alone earn (marathon and night owl are events). */
export function countAchievements(c: ProgressCounts): AchievementId[] {
  const out: AchievementId[] = [];
  if (c.tools >= 1) out.push('first-tool');
  if (c.tools >= 100) out.push('tools-100');
  if (c.tools >= 1000) out.push('tools-1000');
  if (c.subagents >= 1) out.push('first-subagent');
  if (c.subagents >= TEAM_LEAD_SUBAGENTS) out.push('team-lead');
  return out;
}
