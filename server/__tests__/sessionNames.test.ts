import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { resendAgentActivity } from '../src/agentActivityResend.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { readClaudeSessionNames } from '../src/providers/hook/claude/claudeSessionRegistry.js';
import { refreshSessionNames } from '../src/sessionNames.js';

describe('readClaudeSessionNames', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-sessions-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function entry(file: string, body: Record<string, unknown>): void {
    fs.writeFileSync(path.join(dir, file), JSON.stringify(body));
  }

  it('maps session id to name and never opens the .key secrets beside them', () => {
    entry(`${process.pid}.json`, {
      pid: process.pid,
      sessionId: 'sess-a',
      name: 'Kistvakt',
      updatedAt: 1,
    });
    // Shaped like an entry, so reading it would show up as a second name.
    entry(`${process.pid}.abc.key`, { pid: process.pid, sessionId: 'sess-key', name: 'LEAKED' });

    expect(readClaudeSessionNames(dir)).toEqual(new Map([['sess-a', 'Kistvakt']]));
  });

  it("a live pid's entry beats a crashed run's stale entry for the same session", () => {
    // A pid that is not running: well above any real pid range.
    entry('99999991.json', { pid: 99999991, sessionId: 'sess-b', name: 'old', updatedAt: 9 });
    entry(`${process.pid}.json`, {
      pid: process.pid,
      sessionId: 'sess-b',
      name: 'new',
      updatedAt: 1,
    });

    expect(readClaudeSessionNames(dir).get('sess-b')).toBe('new');
  });

  it('a missing registry is no names, not an error', () => {
    expect(readClaudeSessionNames(path.join(dir, 'absent')).size).toBe(0);
  });
});

describe('refreshSessionNames', () => {
  function storeWith(...ids: number[]): {
    store: AgentStateStore;
    sent: Record<string, unknown>[];
  } {
    const store = new AgentStateStore();
    for (const id of ids) {
      store.set(
        id,
        createAgentState({
          id,
          sessionId: `sess-${id}`,
          projectDir: '/p',
          jsonlFile: `/p/${id}.jsonl`,
          isExternal: true,
        }),
      );
    }
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));
    return { store, sent };
  }

  const provider = (names: Record<string, string>) =>
    ({
      id: 'claude',
      sessionNames: () => new Map(Object.entries(names)),
    }) as unknown as HookProvider;

  it('broadcasts a name once, again only when it changes, and keeps it after the session ends', () => {
    const { store, sent } = storeWith(1);

    refreshSessionNames(store, [provider({ 'sess-1': 'dirigent-9a' })]);
    refreshSessionNames(store, [provider({ 'sess-1': 'dirigent-9a' })]);
    refreshSessionNames(store, [provider({ 'sess-1': 'Dirigent' })]);
    refreshSessionNames(store, [provider({})]);

    expect(sent).toEqual([
      { type: 'agentSessionName', id: 1, sessionName: 'dirigent-9a', crowned: false },
      { type: 'agentSessionName', id: 1, sessionName: 'Dirigent', crowned: false },
    ]);
    expect(store.get(1)?.sessionName).toBe('Dirigent');
  });

  it('a reconnecting client is re-sent the known name', () => {
    const { store } = storeWith(2);
    refreshSessionNames(store, [provider({ 'sess-2': 'Kistvakt' })]);

    const resent: Record<string, unknown>[] = [];
    resendAgentActivity((m) => resent.push(m), store);

    expect(resent).toContainEqual({
      type: 'agentSessionName',
      id: 2,
      sessionName: 'Kistvakt',
      crowned: false,
    });
  });

  it('crowns a listed name case-insensitively, and re-broadcasts when the list changes', () => {
    const { store, sent } = storeWith(3);
    const names = provider({ 'sess-3': 'Dirigent' });

    refreshSessionNames(store, [names], ['dirigent']);
    refreshSessionNames(store, [names], ['dirigent']);
    refreshSessionNames(store, [names], []);

    expect(sent).toEqual([
      { type: 'agentSessionName', id: 3, sessionName: 'Dirigent', crowned: true },
      { type: 'agentSessionName', id: 3, sessionName: 'Dirigent', crowned: false },
    ]);
  });
});
