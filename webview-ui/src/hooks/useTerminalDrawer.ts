import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { levelProgress } from '../../../core/src/progress.js';
import type {
  AgentActivity,
  AgentAppearance,
  AgentCardLabel,
  TabStatus,
} from '../components/AgentCard.js';
import {
  providerBadge,
  TERMINAL_DRAWER_DEFAULT_WIDTH_PX,
  TERMINAL_DRAWER_MAX_WIDTH_RATIO,
  TERMINAL_DRAWER_MIN_WIDTH_PX,
  TERMINAL_SIDEBAR_WIDTH_PX,
} from '../constants.js';
import {
  agentDisplayName,
  characterActivityText,
  IDLE_ACTIVITY_TEXT,
  withIdleDuration,
} from '../office/activityText.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import type { TerminalConnectionStatus } from '../terminal/terminalClient.js';
import type { AgentProgressInfo } from './useExtensionMessages.js';

/** A character not (yet) in the office — the mug shot falls back to palette 0. */
const DEFAULT_APPEARANCE: AgentAppearance = { palette: 0, hueShift: 0 };

interface TerminalDrawerInputs {
  /** Agent ids with a live server-side PTY, in open order (control plane). */
  terminalAgentIds: number[];
  getOfficeState: () => OfficeState;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  agentAwaitingInput: Record<number, boolean>;
  agentSeenActivity: Record<number, boolean>;
  agentSessionNames: Record<number, string>;
  agentCrowned: Record<number, boolean>;
  agentIdleSince: Record<number, number>;
  agentProgress: Record<number, AgentProgressInfo>;
}

export interface TerminalDrawerController {
  activeAgentId: number | null;
  /** The pane actually showing: the active agent's, or the first terminal
   *  when the active agent has no PTY (an external session's character was
   *  clicked). null only when there are no terminals. Both shells and the
   *  mobile key bar read this one resolution. */
  shownAgentId: number | null;
  isOpen: boolean;
  widthPx: number;
  /** The newest terminal the drawer saw appear (launch answered, or a reload
   *  re-announcing live sessions) — it became the active tab. `seq` makes
   *  every appearance a distinct value for effects to key on. */
  lastOpened: { agentId: number; seq: number } | null;
  /** Show an agent's terminal if it has one; no-op otherwise. The office's
   *  character click routes here: standalone has no editor panel to raise, so
   *  "focus the agent" means "open its tab", mirroring VS Code's terminalRef.show(). */
  reveal: (agentId: number) => void;
  /** Card click: open the tab AND select + follow the character, so the card
   *  and the office stay in sync. */
  select: (agentId: number) => void;
  /** Select + follow a character in the office without touching the tabs
   *  (a card's sub-agent row selects the sub-agent's figure). */
  selectCharacter: (characterId: number) => void;
  close: () => void;
  onResizeStart: (e: ReactMouseEvent) => void;
  getAppearance: (agentId: number) => AgentAppearance;
  /** Card status dot: 'disconnected' (red) for a terminal whose socket
   *  dropped, otherwise the agent's activity; null before its first activity. */
  statusFor: (agentId: number) => TabStatus | null;
  /** Card name + activity, the same activity text the office overlay shows. */
  labelFor: (agentId: number) => AgentCardLabel;
  /** Card hover: highlight the character (the same outline + label a canvas
   *  hover gives), so a card can be matched to a walking agent. */
  hover: (agentId: number | null) => void;
  /** Each TerminalPane reports its socket state here. */
  onStatusChange: (agentId: number, status: TerminalConnectionStatus) => void;
}

/**
 * The drawer width that fits a viewport: the office keeps at least the card
 * bar's width (the cards overlay its right edge, and they are the only way to
 * switch agents), so on a narrow screen the minimum gives way to that.
 */
export function clampDrawerWidth(preferredPx: number, viewportPx: number): number {
  const maxPx = Math.min(
    viewportPx * TERMINAL_DRAWER_MAX_WIDTH_RATIO,
    viewportPx - TERMINAL_SIDEBAR_WIDTH_PX,
  );
  return Math.max(0, Math.min(maxPx, Math.max(TERMINAL_DRAWER_MIN_WIDTH_PX, preferredPx)));
}

/**
 * All state and derivations behind the standalone terminal panes, on both
 * shells: which tab is active (and which pane that resolves to), whether the
 * desktop panel is open, its width and drag-resize gesture, each pane's socket
 * state, and the per-agent lookups the cards render from. App only composes it.
 */
export function useTerminalDrawer({
  terminalAgentIds,
  getOfficeState,
  agentTools,
  agentStatuses,
  agentAwaitingInput,
  agentSeenActivity,
  agentSessionNames,
  agentCrowned,
  agentIdleSince,
  agentProgress,
}: TerminalDrawerInputs): TerminalDrawerController {
  const [activeAgentId, setActiveAgentId] = useState<number | null>(null);
  const [lastOpened, setLastOpened] = useState<{ agentId: number; seq: number } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // The width the user asked for; what renders is that clamped to the
  // viewport, re-derived on every window resize so a window that narrows
  // while the drawer is open never pushes the office (and its cards) out.
  const [preferredWidthPx, setPreferredWidthPx] = useState(TERMINAL_DRAWER_DEFAULT_WIDTH_PX);
  const [viewportPx, setViewportPx] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportPx(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const widthPx = clampDrawerWidth(preferredWidthPx, viewportPx);
  const [connStatuses, setConnStatuses] = useState<Record<number, TerminalConnectionStatus>>({});

  const shownAgentId =
    activeAgentId !== null && terminalAgentIds.includes(activeAgentId)
      ? activeAgentId
      : (terminalAgentIds[0] ?? null);

  // Reveal a newly-opened terminal. Launching is async — the toolbar sends
  // launchAgent and the server answers with terminalSessionOpened once the PTY
  // is up — so "open the drawer on launch" is expressed as "open it when a
  // terminal we hadn't seen appears". This also restores the drawer after a
  // reload, when webviewReady re-announces the live sessions.
  const knownIdsRef = useRef<number[]>([]);
  useEffect(() => {
    const added = terminalAgentIds.filter((id) => !knownIdsRef.current.includes(id));
    knownIdsRef.current = terminalAgentIds;
    if (added.length === 0) return;
    const newest = added[added.length - 1];
    setActiveAgentId(newest);
    setIsOpen(true);
    setLastOpened((prev) => ({ agentId: newest, seq: (prev?.seq ?? 0) + 1 }));
  }, [terminalAgentIds]);

  const reveal = useCallback(
    (agentId: number) => {
      if (!terminalAgentIds.includes(agentId)) return;
      setActiveAgentId(agentId);
      setIsOpen(true);
    },
    [terminalAgentIds],
  );

  const select = useCallback(
    (agentId: number) => {
      setActiveAgentId(agentId);
      setIsOpen(true);
      getOfficeState().selectAndFollow(agentId);
    },
    [getOfficeState],
  );

  const selectCharacter = useCallback(
    (characterId: number) => getOfficeState().selectAndFollow(characterId),
    [getOfficeState],
  );

  const close = useCallback(() => setIsOpen(false), []);

  // Drag the panel's left edge to resize. The office region is flex-1 beside it,
  // so it reflows to fill whatever width is left — the canvas ResizeObserver
  // repaints and re-centres the camera on the smaller region automatically.
  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthPx;
      const onMove = (ev: MouseEvent) => {
        // Dragging left (smaller clientX) widens the panel.
        const next = startWidth + (startX - ev.clientX);
        setPreferredWidthPx(clampDrawerWidth(next, window.innerWidth));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      };
      // Suppress text selection while dragging over the terminal/office.
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [widthPx],
  );

  // A terminal tab shows the agent's character (front-facing mug shot), so it
  // reads the same palette/hueShift the office assigned that character.
  const getAppearance = useCallback(
    (id: number): AgentAppearance => {
      const ch = getOfficeState().characters.get(id);
      return ch
        ? {
            palette: ch.palette,
            hueShift: ch.hueShift,
            figure: ch.figure,
            providerId: ch.providerId,
          }
        : DEFAULT_APPEARANCE;
    },
    [getOfficeState],
  );

  // Activity for the tab status dot (green idle / blue working / yellow needs
  // attention). null until the agent's first activity, so the dot stays empty.
  const getActivity = useCallback(
    (id: number): AgentActivity | null => {
      if (!agentSeenActivity[id]) return null;
      const tools = agentTools[id];
      if (tools?.some((t) => t.permissionWait && !t.done)) return 'attention';
      if (tools?.some((t) => !t.done)) return 'working';
      if (agentAwaitingInput[id]) return 'attention';
      if (agentStatuses[id] === 'waiting') return 'idle';
      return 'working';
    },
    [agentSeenActivity, agentTools, agentStatuses, agentAwaitingInput],
  );

  // Reads the character's live state, like the overlay does. The cards
  // re-render on the same React state changes (agentTools, agentStatuses)
  // that accompany every character mutation.
  const labelFor = useCallback(
    (id: number): AgentCardLabel => {
      const ch = getOfficeState().characters.get(id);
      return {
        name: agentDisplayName(id, ch, agentSessionNames[id]),
        crowned: agentCrowned[id] === true,
        // The provider shows as the mug shot's badge, not in the name; the
        // filter still matches it ("codex").
        provider: providerBadge(ch?.providerId)?.label,
        activity: withIdleDuration(
          ch ? characterActivityText(ch, agentTools[id]) : IDLE_ACTIVITY_TEXT,
          agentIdleSince[id],
          Date.now(),
        ),
        level: agentProgress[id] && {
          level: agentProgress[id].level,
          progress: levelProgress(agentProgress[id].xp),
          achievements: agentProgress[id].achievements,
        },
      };
    },
    [getOfficeState, agentTools, agentSessionNames, agentCrowned, agentIdleSince, agentProgress],
  );

  const hover = useCallback(
    (agentId: number | null) => {
      // The renderer and ToolOverlay read this every frame; the canvas's own
      // mousemove overwrites it as soon as the pointer is back on the office.
      getOfficeState().hoveredAgentId = agentId;
    },
    [getOfficeState],
  );

  const onStatusChange = useCallback((agentId: number, status: TerminalConnectionStatus) => {
    setConnStatuses((prev) => (prev[agentId] === status ? prev : { ...prev, [agentId]: status }));
  }, []);

  // Broken connection (red) wins over activity, for agents that have a pane.
  const statusFor = useCallback(
    (id: number): TabStatus | null => {
      const conn = connStatuses[id];
      if (terminalAgentIds.includes(id) && (conn === 'closed' || conn === 'reconnecting')) {
        return 'disconnected';
      }
      return getActivity(id);
    },
    [connStatuses, terminalAgentIds, getActivity],
  );

  return {
    activeAgentId,
    shownAgentId,
    lastOpened,
    isOpen,
    widthPx,
    reveal,
    select,
    selectCharacter,
    close,
    onResizeStart,
    getAppearance,
    statusFor,
    labelFor,
    hover,
    onStatusChange,
  };
}
