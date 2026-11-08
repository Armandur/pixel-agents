/** Pure rules shared by the agent card bars — highlight tier and the mobile
 *  bar's drag-to-reorder order (DOM-free, so they run on the Node runner). */

/** Card highlight tiers: 'focused' = the agent's character is selected in the
 *  office (active background, no border); 'active' = its terminal pane is the
 *  one showing (background + accent border). */
export type CardVariant = 'default' | 'focused' | 'active';

/** One rule for both card bars: the showing terminal pane wins, then the
 *  character selected in the office. Pass activeId null where no pane shows
 *  (VS Code, or the mobile office page). */
export function cardVariant(
  agentId: number,
  { activeId, focusedId }: { activeId: number | null; focusedId: number | null },
): CardVariant {
  if (agentId === activeId) return 'active';
  if (agentId === focusedId) return 'focused';
  return 'default';
}

/** Saved order first (dropping closed agents), then any new agents appended
 *  in creation order — so a reorder survives launches and closes. */
export function mergeOrder(saved: readonly number[], live: readonly number[]): number[] {
  const liveSet = new Set(live);
  const ordered = saved.filter((id) => liveSet.has(id));
  const seen = new Set(ordered);
  for (const id of live) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * The order with `dragId` moved to where the finger is: before the first
 * other card whose horizontal midpoint lies right of `x`, else last.
 * `midpointOf` returns a card's midpoint in the same coordinate space as `x`
 * (null for a card that isn't laid out, which is skipped).
 */
export function reorderByPointer(
  ids: readonly number[],
  dragId: number,
  midpointOf: (id: number) => number | null,
  x: number,
): number[] {
  const others = ids.filter((id) => id !== dragId);
  let insertAt = others.length;
  for (let i = 0; i < others.length; i++) {
    const mid = midpointOf(others[i]);
    if (mid !== null && x < mid) {
      insertAt = i;
      break;
    }
  }
  return [...others.slice(0, insertAt), dragId, ...others.slice(insertAt)];
}

/** The card-bar filter: a case-insensitive text match on the card's name or
 *  provider, and optionally only agents that are not idle. An agent with no
 *  activity yet (status null, typical of adopted sessions) counts as idle. */
export function matchesCardFilter(
  { name, provider, status }: { name: string; provider?: string; status: string | null },
  { query, hideIdle }: { query: string; hideIdle: boolean },
): boolean {
  if (hideIdle && (status === null || status === 'idle')) return false;
  const q = query.trim().toLowerCase();
  return q === '' || `${name} ${provider ?? ''}`.toLowerCase().includes(q);
}

/** Crowned agents first, everyone else after, each group in its given order. */
export function crownedFirst(ids: number[], isCrowned: (id: number) => boolean): number[] {
  return [...ids.filter(isCrowned), ...ids.filter((id) => !isCrowned(id))];
}

/** A sub-agent as the card bar needs it (structurally a SubagentCharacter). */
export interface SubagentRef {
  id: number;
  parentAgentId: number;
  label: string;
}

/** Shown when a sub-agent has no label yet (its Subtask status carried none). */
const SUBAGENT_FALLBACK_LABEL = 'Sub-agent';

/** Sub-agents grouped by their main agent, in creation order. Agents with no
 *  sub-agents have no entry. */
export function groupSubagentsByParent(
  subagents: readonly SubagentRef[],
): Map<number, SubagentRef[]> {
  const byParent = new Map<number, SubagentRef[]>();
  for (const sub of subagents) {
    const list = byParent.get(sub.parentAgentId);
    if (list) list.push(sub);
    else byParent.set(sub.parentAgentId, [sub]);
  }
  return byParent;
}

/** The card's extra row for one agent's sub-agents: `text` is the visible line
 *  (CSS ellipsis cuts it to the card width), `title` lists every label, and
 *  `firstId` is the character a click selects. null when there are none. */
export function subagentRow(
  subagents: readonly SubagentRef[] | undefined,
): { text: string; title: string; firstId: number } | null {
  if (!subagents || subagents.length === 0) return null;
  const labels = subagents.map((s) => s.label.trim() || SUBAGENT_FALLBACK_LABEL);
  return {
    text: `\u21b3 ${subagents.length}: ${labels.join(', ')}`,
    title: labels.join('\n'),
    firstId: subagents[0].id,
  };
}
