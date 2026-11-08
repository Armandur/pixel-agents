import { useState } from 'react';

import { TERMINAL_SIDEBAR_WIDTH_PX } from '../constants.js';
import type { AgentAppearance, AgentCardLabel, TabStatus } from './AgentCard.js';
import { AgentCard } from './AgentCard.js';
import { cardVariant, matchesCardFilter } from './cardBar.js';
import { Button } from './ui/Button.js';

interface AgentCardBarProps {
  /** Agents to show, top to bottom. */
  agentIds: number[];
  /** The agent whose terminal pane is showing (standalone). Its card gets the
   *  accent border. */
  activeAgentId?: number | null;
  /** The agent whose character is selected in the office. Its card gets the
   *  active background; `activeAgentId` wins when both name the same agent. */
  focusedAgentId?: number | null;
  getAppearance: (agentId: number) => AgentAppearance;
  statusFor: (agentId: number) => TabStatus | null;
  labelFor: (agentId: number) => AgentCardLabel;
  onSelect: (agentId: number) => void;
  onClose: (agentId: number) => void;
  /** Card hover highlights the character in the office (null = none). */
  onHover: (agentId: number | null) => void;
}

/**
 * The column of agent cards along the office's right edge — mug shot, name,
 * activity and status dot per agent — shared by both desktop hosts, with a
 * text filter and a hide-idle toggle on top. The filter only narrows the list:
 * the office and the terminal panes are untouched.
 *
 * Transparent and borderless, drawn on top of the office space: the negative
 * margin exactly cancels the column's width, so it takes no layout room and
 * overlays the office's right edge as a flex sibling of the office region.
 * Pointer events pass through the empty parts so the office stays clickable
 * underneath; only the cards and the filter row are interactive.
 *
 * In standalone, TerminalDrawer owns the bar and the cards double as the
 * terminal panel's tabs (the panel opens to the bar's right). In VS Code the
 * bar stands alone and lists every agent in the office, external sessions
 * included; a card click raises that agent's editor terminal via focusAgent.
 */
export function AgentCardBar({
  agentIds,
  activeAgentId = null,
  focusedAgentId = null,
  getAppearance,
  statusFor,
  labelFor,
  onSelect,
  onClose,
  onHover,
}: AgentCardBarProps) {
  const [query, setQuery] = useState('');
  const [hideIdle, setHideIdle] = useState(false);

  if (agentIds.length === 0) return null;

  const shown = agentIds.filter((id) =>
    matchesCardFilter({ ...labelFor(id), status: statusFor(id) }, { query, hideIdle }),
  );

  return (
    <div
      className="relative z-30 h-full shrink-0 flex flex-col gap-4 p-4 pointer-events-none"
      style={{ width: TERMINAL_SIDEBAR_WIDTH_PX, marginLeft: -TERMINAL_SIDEBAR_WIDTH_PX }}
    >
      <div className="pointer-events-auto flex w-full gap-2 shrink-0">
        <input
          type="text"
          value={query}
          placeholder="Filter agents"
          aria-label="Filter agents"
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 text-2xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
        />
        <Button
          variant={hideIdle ? 'active' : 'default'}
          size="sm"
          onClick={() => setHideIdle((v) => !v)}
          aria-pressed={hideIdle}
          title={hideIdle ? 'Show idle agents' : 'Hide idle agents'}
          className="text-2xs! px-4! shrink-0"
        >
          {hideIdle ? 'Show idle' : 'Hide idle'}
        </Button>
      </div>
      {/* The cards scroll on their own under the fixed filter row. No flex-1:
          the list shrinks to its cards, so the office below the last card
          stays clickable; only when the cards overflow does it scroll. */}
      <div
        className="pixel-scrollbar pointer-events-auto min-h-0 overflow-y-auto flex flex-col gap-4"
        data-testid="agent-card-list"
      >
        {shown.map((agentId) => (
          <AgentCard
            key={agentId}
            agentId={agentId}
            variant={cardVariant(agentId, { activeId: activeAgentId, focusedId: focusedAgentId })}
            appearance={getAppearance(agentId)}
            status={statusFor(agentId)}
            label={labelFor(agentId)}
            onSelect={onSelect}
            onClose={onClose}
            onHover={onHover}
          />
        ))}
        {shown.length === 0 && (
          <span className="text-2xs text-text-muted text-center">No matching agents</span>
        )}
      </div>
    </div>
  );
}
