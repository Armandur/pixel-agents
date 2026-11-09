import { ACHIEVEMENT_LABELS, CROWNED_NAME_COLOR, providerBadge } from '../constants.js';
import type { CardVariant, SubagentRef } from './cardBar.js';
import { subagentRow } from './cardBar.js';
import { CharacterMugShot } from './CharacterMugShot.js';
import { Button } from './ui/Button.js';

/** How a given agent's character looks, for the tab mug shot. */
export interface AgentAppearance {
  palette: number;
  hueShift: number;
  /** Generated figure seed, when the agent has one. */
  figure?: string;
  /** Hook provider ('codex' gets a badge). Undefined means claude. */
  providerId?: string;
}

/** The text beside a desktop card's mug shot: who the agent is and what it does. */
export interface AgentCardLabel {
  name: string;
  activity: string;
  /** Provider label ("Claude", "Codex") for the filter; shown as the badge. */
  provider?: string;
  /** Session listed in config crownedSessions: gold name, sorted first. */
  crowned?: boolean;
  /** Its level and how far into it (0-1), once the server reported any work. */
  level?: { level: number; progress: number; achievements: string[] };
}

/** The level badge's and XP bar's tooltip: progress, then achievements. */
function levelTitle(l: NonNullable<AgentCardLabel['level']>): string {
  const names = l.achievements.map((a) => ACHIEVEMENT_LABELS[a] ?? a);
  return `${Math.round(l.progress * 100)} % till Lvl ${l.level + 1}${names.length ? `\n${names.join(', ')}` : ''}`;
}

/** Agent activity reflected by the tab's status dot. */
export type AgentActivity = 'idle' | 'working' | 'attention';

/** Activity plus the drawer-owned "connection broken" state. */
export type TabStatus = AgentActivity | 'disconnected';

const STATUS_DOT: Record<TabStatus, string> = {
  idle: 'bg-status-success', // green — turn complete, nothing pending
  working: 'bg-accent-bright', // blue — actively running
  attention: 'bg-status-permission', // yellow — needs permission or input
  disconnected: 'bg-status-error', // red — terminal socket dropped
};

const CARD_VARIANT: Record<CardVariant, string> = {
  default: 'bg-btn-bg border-transparent hover:bg-btn-hover',
  focused: 'bg-active-bg border-transparent',
  active: 'bg-active-bg border-accent',
};

interface AgentCardProps {
  agentId: number;
  variant: CardVariant;
  appearance: AgentAppearance;
  status: TabStatus | null;
  /** Name + activity beside the mug shot. Omitted on mobile, whose cards are
   *  mug shots only. */
  label?: AgentCardLabel;
  /** When false the × is invisible (not removed — the card keeps its width so
   *  the bar doesn't reflow). Mobile only shows it on the active terminal tab
   *  to keep a stray tap from killing an agent. */
  showClose?: boolean;
  onSelect: (agentId: number) => void;
  onClose: (agentId: number) => void;
  /** Pointer entered (agentId) or left (null) the card: highlights the
   *  character in the office. */
  onHover?: (agentId: number | null) => void;
  /** This agent's sub-agents; a non-empty list adds a row under the activity. */
  subagents?: readonly SubagentRef[];
  /** Select a sub-agent's character in the office (the row's click). */
  onSelectSubagent?: (subagentId: number) => void;
}

/** One agent's card in the terminal sidebar — mug shot beside a
 *  close-button/status-dot column. The cards double as the terminal panel's
 *  tabs: clicking one selects that agent's pane. */
export function AgentCard({
  agentId,
  variant,
  appearance,
  status,
  label,
  showClose = true,
  onSelect,
  onClose,
  onHover,
  subagents,
  onSelectSubagent,
}: AgentCardProps) {
  const subRow = subagentRow(subagents);
  const badge = providerBadge(appearance.providerId);
  return (
    <div
      className={`pointer-events-auto flex items-stretch gap-1 p-1 cursor-pointer border-2 shrink-0 ${label ? 'w-full' : ''} ${CARD_VARIANT[variant]}`}
      onClick={() => onSelect(agentId)}
      onMouseEnter={onHover && (() => onHover(agentId))}
      onMouseLeave={onHover && (() => onHover(null))}
      title={badge ? `Agent ${agentId} (${badge.label})` : `Agent ${agentId}`}
    >
      <div className="relative shrink-0">
        <CharacterMugShot
          palette={appearance.palette}
          hueShift={appearance.hueShift}
          figure={appearance.figure}
        />
        {/* Mobile's mug-shot-only cards mark the provider with a small
            colour square; desktop cards carry it beside the name instead,
            where it covers nothing. */}
        {badge && !label && (
          <span
            className="absolute bottom-0 left-0 size-6 border-2"
            style={{ background: badge.fill, borderColor: badge.border }}
            aria-label={badge.label}
          />
        )}
      </div>
      {label && (
        <div
          className="flex flex-col justify-center gap-2 min-w-0 flex-1 px-2 leading-none"
          data-testid="agent-card-label"
          title={`${label.name}: ${label.activity}`}
        >
          <span className="flex items-center gap-4 min-w-0">
            <span
              className="text-sm text-text overflow-hidden text-ellipsis whitespace-nowrap"
              style={label.crowned ? { color: CROWNED_NAME_COLOR } : undefined}
            >
              {label.name}
            </span>
            {badge && (
              <span
                className="shrink-0 size-14 border-2 flex items-center justify-center text-2xs leading-none"
                style={{ background: badge.fill, borderColor: badge.border, color: badge.border }}
                aria-label={badge.label}
                title={badge.label}
              >
                {badge.glyph}
              </span>
            )}
            {label.level && (
              <span
                className="ml-auto shrink-0 bg-gold text-bg text-2xs leading-none px-4 py-1"
                data-testid="agent-card-level"
                title={levelTitle(label.level)}
              >
                Lvl {label.level.level}
              </span>
            )}
          </span>
          <span className="text-2xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">
            {label.activity}
          </span>
          {label.level && (
            <span
              className="block h-3 bg-bg-dark"
              title={levelTitle(label.level)}
              data-testid="agent-card-xp"
            >
              <span
                className="block h-full bg-accent-bright"
                style={{ width: `${Math.round(label.level.progress * 100)}%` }}
              />
            </span>
          )}
          {subRow && (
            <button
              type="button"
              className="block w-0 min-w-full text-left text-2xs leading-none overflow-hidden text-ellipsis whitespace-nowrap text-text-muted hover:text-text cursor-pointer bg-transparent border-0 p-0"
              title={subRow.title}
              data-testid="agent-card-subagents"
              onClick={(e) => {
                // Select the sub-agent's figure, not this card's tab.
                e.stopPropagation();
                onSelectSubagent?.(subRow.firstId);
              }}
            >
              {subRow.text}
            </button>
          )}
        </div>
      )}
      {/* Close on top, status dot at the bottom, both centred over the
          same column beside the mug shot. */}
      <div className="flex flex-col items-center justify-between shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            // Don't also select the tab we're about to remove.
            e.stopPropagation();
            onClose(agentId);
          }}
          title="Close agent"
          className={`leading-none ${showClose ? '' : 'invisible'}`}
        >
          ×
        </Button>
        {/* 1px left: optically centres the solid square under the pixel-font ×
            glyph, which sits a hair left in its cell. mb (not pb) lifts it off
            the card's bottom edge: the span is a fixed-size empty box, so
            padding is invisible — only margin moves it. */}
        <span
          className={`size-6 shrink-0 relative -left-1 mb-2 ${status ? STATUS_DOT[status] : ''}`}
        />
      </div>
    </div>
  );
}
