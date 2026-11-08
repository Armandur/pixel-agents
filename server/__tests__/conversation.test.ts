import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { HookEventHandler } from '../src/hookEventHandler.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { SessionRouter } from '../src/sessionRouter.js';

/**
 * Cross-session SendMessage → agentConversation, through the Claude provider's
 * real normalizeHookEvent (which resolves the recipient in the session
 * registry under $HOME) and the real HookEventHandler.
 */
describe('SendMessage between sessions', () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-conv-'));
    process.env.HOME = home;
    const dir = path.join(home, '.claude', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    const entry = (file: string, body: Record<string, unknown>) =>
      fs.writeFileSync(path.join(dir, file), JSON.stringify(body));
    entry(`${process.pid}.json`, {
      pid: process.pid,
      sessionId: 'sess-dirigent',
      name: 'Dirigent',
      messagingSocketPath: '/run/user/1000/cc-socks/42.sock',
    });
    // A secret beside the entries, shaped like one: reading it would resolve "LEAKED".
    entry(`${process.pid}.abc.key`, { pid: process.pid, sessionId: 'sess-key', name: 'LEAKED' });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const sendMessage = (to: string, summary?: string) => ({
    hook_event_name: 'PreToolUse',
    session_id: 'sess-pixel',
    tool_name: 'SendMessage',
    tool_input: { to, summary, message: 'hej' },
  });

  const messageTo = (raw: Record<string, unknown>) => {
    const out = claudeProvider.normalizeHookEvent(raw);
    return out?.event.kind === 'toolStart' ? out.event.messageTo : 'not a toolStart';
  };

  it('resolves the recipient by name, by name with a [ref], and by socket', () => {
    const expected = { sessionId: 'sess-dirigent', summary: 'Uppdrag' };
    expect(messageTo(sendMessage('Dirigent', 'Uppdrag'))).toEqual(expected);
    expect(messageTo(sendMessage('Dirigent [40043a]', 'Uppdrag'))).toEqual(expected);
    expect(messageTo(sendMessage('uds:/run/user/1000/cc-socks/42.sock', 'Uppdrag'))).toEqual(
      expected,
    );
  });

  it('leaves an unknown recipient, a .key entry and other tools unresolved', () => {
    expect(messageTo(sendMessage('cloud-peer'))).toBeUndefined();
    expect(messageTo(sendMessage('LEAKED'))).toBeUndefined();
    expect(
      messageTo({
        hook_event_name: 'PreToolUse',
        session_id: 'sess-pixel',
        tool_name: 'Bash',
        tool_input: { to: 'Dirigent' },
      }),
    ).toBeUndefined();
  });

  function office(...sessions: Array<[number, string]>) {
    const store = new AgentStateStore();
    const handler = new HookEventHandler(
      store,
      new Map(),
      new Map(),
      claudeProvider,
      new SessionRouter(),
    );
    for (const [id, sessionId] of sessions) {
      store.set(
        id,
        createAgentState({ id, sessionId, projectDir: '/p', jsonlFile: '', isExternal: true }),
      );
      handler.registerAgent(sessionId, id);
    }
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => {
      if (m.type === 'agentConversation') sent.push(m);
    });
    return { handler, sent };
  }

  it('broadcasts agentConversation from the sender to the tracked recipient', () => {
    const { handler, sent } = office([1, 'sess-pixel'], [2, 'sess-dirigent']);
    handler.handleEvent('claude', sendMessage('Dirigent', 'Klart'));
    expect(sent).toEqual([{ type: 'agentConversation', fromId: 1, toId: 2, summary: 'Klart' }]);
  });

  it('broadcasts nothing when the recipient is not in the office, or is the sender', () => {
    const missing = office([1, 'sess-pixel']);
    missing.handler.handleEvent('claude', sendMessage('Dirigent', 'Klart'));
    expect(missing.sent).toEqual([]);

    const self = office([2, 'sess-dirigent']);
    self.handler.handleEvent('claude', { ...sendMessage('Dirigent'), session_id: 'sess-dirigent' });
    expect(self.sent).toEqual([]);
  });
});
