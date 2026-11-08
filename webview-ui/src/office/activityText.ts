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
