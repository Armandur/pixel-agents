import type { AchievementId, ProgressCounts } from '../../core/src/progress.js';
import {
  countAchievements,
  levelForXp,
  MARATHON_TURN_MS,
  NIGHT_HOURS,
  XP_PER_SUBAGENT,
  XP_PER_TOOL,
  XP_PER_TURN,
} from '../../core/src/progress.js';
import type { AgentStateStore } from './agentStateStore.js';

/** How many credited tool ids an agent remembers, to skip re-sent starts. */
const SEEN_TOOL_IDS_MAX = 500;

interface Live {
  seenToolIds: Set<string>;
  turnStartedAt?: number;
}

/**
 * Counts each agent's work into XP and achievements, published as
 * `agentProgress`. Like IdleSinceTracker it listens to the store's own
 * broadcasts rather than the many places that send them:
 * - a tool start credits a tool once per tool id (background spawns are
 *   re-sent at every turn end; the id set skips them),
 * - a spawn tool also credits a sub-agent,
 * - the active → waiting edge credits a turn (waiting is sent more than once
 *   per turn; only a turn that started counts).
 * Persisted at turn end and on a new achievement, not per tool.
 */
export class ProgressTracker {
  private readonly live = new Map<number, Live>();

  private readonly onBroadcast = (message: Record<string, unknown>): void => {
    const id = message.id;
    if (typeof id !== 'number' || id < 0) return;
    const agent = this.store.get(id);
    if (!agent) return;
    const live = this.liveFor(id);
    const now = this.now();
    if (message.type === 'agentToolStart' && typeof message.toolId === 'string') {
      if (live.seenToolIds.has(message.toolId)) return;
      live.seenToolIds.add(message.toolId);
      if (live.seenToolIds.size > SEEN_TOOL_IDS_MAX) {
        live.seenToolIds.delete(live.seenToolIds.values().next().value!);
      }
      live.turnStartedAt ??= now;
      const p = this.counts(id)!;
      p.tools++;
      p.xp += XP_PER_TOOL;
      if (typeof message.toolName === 'string' && this.subagentToolNames.has(message.toolName)) {
        p.subagents++;
        p.xp += XP_PER_SUBAGENT;
      }
      const hour = new Date(now).getHours();
      const night = hour >= NIGHT_HOURS[0] && hour < NIGHT_HOURS[1];
      this.publish(id, night ? ['night-owl'] : []);
    } else if (message.type === 'agentStatus') {
      if (message.status === 'active') {
        live.turnStartedAt ??= now;
      } else if (message.status === 'waiting' && live.turnStartedAt !== undefined) {
        const long = now - live.turnStartedAt >= MARATHON_TURN_MS;
        live.turnStartedAt = undefined;
        const p = this.counts(id)!;
        p.turns++;
        p.xp += XP_PER_TURN;
        this.publish(id, long ? ['marathon'] : [], true);
      }
    }
  };

  // A restored lead's live spawns are re-sent at its next turn end: they
  // were credited before the restart, so they start out seen.
  private readonly onAdded = (id: number, agent: { backgroundAgentToolIds: Set<string> }): void => {
    for (const toolId of agent.backgroundAgentToolIds) this.liveFor(id).seenToolIds.add(toolId);
  };

  private readonly onRemoved = (id: number): void => {
    this.live.delete(id);
  };

  constructor(
    private readonly store: AgentStateStore,
    private readonly subagentToolNames: ReadonlySet<string>,
    private readonly now: () => number = Date.now,
  ) {
    store.on('broadcast', this.onBroadcast);
    store.on('agentAdded', this.onAdded);
    store.on('agentRemoved', this.onRemoved);
  }

  private liveFor(id: number): Live {
    let live = this.live.get(id);
    if (!live) {
      live = { seenToolIds: new Set() };
      this.live.set(id, live);
    }
    return live;
  }

  private counts(id: number): ProgressCounts | undefined {
    const agent = this.store.get(id);
    if (!agent) return undefined;
    agent.progress ??= { xp: 0, tools: 0, turns: 0, subagents: 0, achievements: [] };
    return agent.progress;
  }

  private publish(id: number, earned: AchievementId[], turnEnd = false): void {
    const p = this.counts(id)!;
    const fresh = [...countAchievements(p), ...earned].filter((a) => !p.achievements.includes(a));
    p.achievements.push(...fresh);
    if (turnEnd || fresh.length > 0) this.store.persist();
    // Deferred so the message lands after the one that triggered it.
    queueMicrotask(() =>
      this.store.broadcast({
        type: 'agentProgress',
        id,
        xp: p.xp,
        level: levelForXp(p.xp),
        achievements: [...p.achievements],
      }),
    );
  }

  dispose(): void {
    this.store.off('broadcast', this.onBroadcast);
    this.store.off('agentAdded', this.onAdded);
    this.store.off('agentRemoved', this.onRemoved);
  }
}
