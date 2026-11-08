import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resendAgentActivity } from '../src/agentActivityResend.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { IdleSinceTracker } from '../src/idleSince.js';

describe('IdleSinceTracker', () => {
  let dir: string;
  let store: AgentStateStore;
  let tracker: IdleSinceTracker;
  let idle: Record<string, unknown>[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-idle-'));
    store = new AgentStateStore();
    tracker = new IdleSinceTracker(store);
    idle = [];
    store.on('broadcast', (m) => {
      if (m.type === 'agentIdleSince') idle.push(m);
    });
  });

  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function add(id: number, jsonlFile = ''): void {
    store.set(
      id,
      createAgentState({ id, sessionId: `s${id}`, projectDir: dir, jsonlFile, isExternal: true }),
    );
  }

  const flush = () => new Promise<void>((r) => queueMicrotask(r));

  it('a turn end starts the clock once; a new tool or active stops it', async () => {
    add(1);
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    vi.setSystemTime(1_060_000);
    // Done turning into Waiting for input keeps the original start.
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 't', status: 'Reading a.ts' });
    // Repeated active (sent per transcript line) changes nothing further.
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    await flush();

    expect(idle).toEqual([
      { type: 'agentIdleSince', id: 1, since: 1_000_000 },
      { type: 'agentIdleSince', id: 1, since: undefined },
    ]);
  });

  it('an agent that appears without activity is idle since its transcript was written', async () => {
    const file = path.join(dir, 'a.jsonl');
    fs.writeFileSync(file, '');
    fs.utimesSync(file, 500, 500);
    add(2, file);
    await flush();

    expect(idle).toEqual([{ type: 'agentIdleSince', id: 2, since: 500_000 }]);

    const resent: Record<string, unknown>[] = [];
    resendAgentActivity((m) => resent.push(m), store);
    expect(resent).toContainEqual({ type: 'agentIdleSince', id: 2, since: 500_000 });
  });
});
