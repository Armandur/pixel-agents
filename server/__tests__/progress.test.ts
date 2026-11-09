import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { levelForXp, levelProgress, xpForLevel } from '../../core/src/progress.js';
import { resendAgentActivity } from '../src/agentActivityResend.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { IdleSinceTracker } from '../src/idleSince.js';
import { ProgressTracker } from '../src/progress.js';

describe('levels', () => {
  it('level N needs 10·N·(N−1) XP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(19)).toBe(1);
    expect(levelForXp(20)).toBe(2);
    expect(levelForXp(60)).toBe(3);
    expect(levelForXp(200)).toBe(5);
    expect(levelForXp(900)).toBe(10);
    expect(xpForLevel(10)).toBe(900);
    expect(levelProgress(40)).toBe(0.5);
  });
});

describe('ProgressTracker', () => {
  let store: AgentStateStore;
  let tracker: ProgressTracker;
  let now: number;
  let sent: Record<string, unknown>[];

  beforeEach(() => {
    store = new AgentStateStore();
    now = new Date(2026, 10, 9, 12, 0).getTime(); // midday: no night owl
    tracker = new ProgressTracker(store, new Set(['Agent', 'Task']), () => now);
    sent = [];
    store.on('broadcast', (m) => {
      if (m.type === 'agentProgress') sent.push(m);
    });
    store.set(
      1,
      createAgentState({
        id: 1,
        sessionId: 's1',
        projectDir: '/p',
        jsonlFile: '',
        isExternal: true,
      }),
    );
  });

  afterEach(() => tracker.dispose());

  const flush = () => new Promise<void>((r) => queueMicrotask(r));
  const tool = (toolId: string, toolName = 'Read') =>
    store.broadcast({ type: 'agentToolStart', id: 1, toolId, status: 's', toolName });
  const status = (s: string) => store.broadcast({ type: 'agentStatus', id: 1, status: s });

  it('a tool is credited once, even when its start is sent again', async () => {
    tool('a');
    tool('a');
    tool('b');
    await flush();
    expect(store.get(1)!.progress).toMatchObject({ tools: 2, xp: 2 });
    expect(sent.at(-1)).toMatchObject({ xp: 2, level: 1, achievements: ['first-tool'] });
  });

  it('a turn is credited on the active → waiting edge only', async () => {
    status('active');
    tool('a');
    status('waiting');
    status('waiting'); // Done turning into Waiting for input
    await flush();
    expect(store.get(1)!.progress).toMatchObject({ turns: 1, xp: 1 + 5 });
  });

  it('waiting with no turn begun credits nothing (an adopted agent idling)', async () => {
    const idle = new IdleSinceTracker(store);
    status('waiting');
    await flush();
    expect(store.get(1)!.progress).toBeUndefined();
    expect(sent).toEqual([]);
    idle.dispose();
  });

  it('a spawn re-sent at every turn end counts as one sub-agent', async () => {
    tool('spawn', 'Agent');
    status('waiting');
    tool('spawn', 'Agent'); // the turn-end re-send
    status('waiting');
    await flush();
    expect(store.get(1)!.progress).toMatchObject({ subagents: 1, tools: 1, turns: 1 });
    expect(store.get(1)!.progress!.achievements).toContain('first-subagent');
  });

  it('five sub-agents make a team lead; a long turn a marathon; night work a night owl', async () => {
    for (let i = 0; i < 5; i++) tool(`s${i}`, 'Task');
    now += 31 * 60 * 1000;
    status('waiting');
    now = new Date(2026, 10, 10, 2, 0).getTime();
    tool('late');
    await flush();
    expect(store.get(1)!.progress!.achievements).toEqual(
      expect.arrayContaining(['team-lead', 'marathon', 'night-owl']),
    );
  });

  it("a restored lead's live spawns are not credited again at its next turn end", async () => {
    const lead = createAgentState({
      id: 2,
      sessionId: 's2',
      projectDir: '/p',
      jsonlFile: '',
      isExternal: true,
    });
    lead.backgroundAgentToolIds.add('spawn');
    store.set(2, lead);
    store.broadcast({
      type: 'agentToolStart',
      id: 2,
      toolId: 'spawn',
      status: 's',
      toolName: 'Agent',
    });
    await flush();
    expect(store.get(2)!.progress).toBeUndefined();
  });

  it('sub-agent ids (negative) are never counted', async () => {
    store.broadcast({ type: 'agentToolStart', id: -1, toolId: 'x', status: 's' });
    await flush();
    expect(sent).toEqual([]);
  });

  it('progress is re-sent on webviewReady from the agent state, without counting again', () => {
    store.get(1)!.progress = {
      xp: 25,
      tools: 10,
      turns: 3,
      subagents: 0,
      achievements: ['first-tool'],
    };
    const out: Record<string, unknown>[] = [];
    resendAgentActivity((m) => out.push(m), store);
    expect(out.find((m) => m.type === 'agentProgress')).toEqual({
      type: 'agentProgress',
      id: 1,
      xp: 25,
      level: 2,
      achievements: ['first-tool'],
    });
    expect(store.get(1)!.progress!.tools).toBe(10);
  });
});
