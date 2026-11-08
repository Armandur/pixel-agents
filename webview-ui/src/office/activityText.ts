import type { Character, ToolActivity } from './types.js';

/** The label of an agent with nothing running and nothing pending. */
export const IDLE_ACTIVITY_TEXT = 'Idle';

// Both turn-end states show the green checkmark bubble. A finished turn (Stop)
// shows ONLY the checkmark (the label falls through to its normal idle text);
// going idle waiting on the user (Notification(idle_prompt)) additionally
// surfaces this label. Driven by Character.waitingAwaitingInput.
export const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

const NEEDS_APPROVAL_TEXT = 'Needs approval';

/** Short human-readable activity of a (non-sub) agent, shared by the office
 *  overlay and the agent cards so the two never disagree. */
export function getActivityText(
  tools: ToolActivity[] | undefined,
  isActive: boolean,
  bubbleType: 'permission' | 'waiting' | null,
  waitingAwaitingInput: boolean,
): string {
  if (bubbleType === 'permission') return NEEDS_APPROVAL_TEXT;
  // Only the idle case ("Waiting for input") gets a dedicated label. A finished
  // turn (Stop, waitingAwaitingInput=false) falls through so the checkmark alone
  // signals "done", same as the original behavior.
  if (bubbleType === 'waiting' && waitingAwaitingInput) return WAITING_INPUT_ACTIVITY_TEXT;

  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return NEEDS_APPROVAL_TEXT;
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return IDLE_ACTIVITY_TEXT;
}

/** The activity of a character as the overlay would show it. */
export function characterActivityText(ch: Character, tools: ToolActivity[] | undefined): string {
  return getActivityText(tools, ch.isActive, ch.bubbleType, ch.waitingAwaitingInput ?? false);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "<1 min", "12 min", "3 h", "2 d" — coarse on purpose: the card re-renders
 *  on a slow tick, and "how long" matters more than the exact minute. */
export function formatIdleDuration(ms: number): string {
  if (ms < MINUTE_MS) return '<1 min';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < 2 * DAY_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.floor(ms / DAY_MS)} d`;
}

/** An idle or waiting agent's activity with how long it has been so
 *  ("Idle · 12 min"); any other activity, or no known start, is unchanged. */
export function withIdleDuration(activity: string, since: number | undefined, now: number): string {
  if (since === undefined) return activity;
  if (activity !== IDLE_ACTIVITY_TEXT && activity !== WAITING_INPUT_ACTIVITY_TEXT) return activity;
  return `${activity} · ${formatIdleDuration(Math.max(0, now - since))}`;
}

/** What to call an agent on its card: team role, then the CLI's session
 *  name, then the Directory, then the id. */
export function agentDisplayName(
  agentId: number,
  ch: Character | undefined,
  sessionName?: string,
): string {
  const own = sessionName || ch?.directoryName;
  if (ch?.isTeamLead) return own ? `LEAD · ${own}` : 'LEAD';
  return ch?.agentName || own || `Agent ${agentId}`;
}
