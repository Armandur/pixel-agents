import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { focusUrlFor, forwardFocus } from '../src/focusForwarder.js';
import { HookEventHandler } from '../src/hookEventHandler.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { codexProvider } from '../src/providers/hook/codex/codex.js';
import { hookProviders, observedProviders } from '../src/providers/index.js';
import { SessionRouter } from '../src/sessionRouter.js';

describe('codexProvider', () => {
  it('drops transcript_path so the session is adopted hooks-only', () => {
    const out = codexProvider.normalizeHookEvent({
      hook_event_name: 'SessionStart',
      session_id: 'c1',
      source: 'startup',
      cwd: '/w/proj',
      transcript_path: '/home/u/.codex/sessions/rollout-c1.jsonl',
    });
    expect(out?.event).toMatchObject({ kind: 'sessionStart', cwd: '/w/proj' });
    expect(out?.event).not.toHaveProperty('transcriptPath', expect.any(String));
  });

  it('treats Interrupt as the end of the turn', () => {
    expect(
      codexProvider.normalizeHookEvent({ hook_event_name: 'Interrupt', session_id: 'c1' }),
    ).toEqual({ sessionId: 'c1', event: { kind: 'turnEnd' } });
  });

  it('is observe-only: never offered for consent or install', () => {
    expect(observedProviders).toContain(codexProvider);
    expect(hookProviders).not.toContain(codexProvider);
  });

  it('adopts a Codex session with its provider id', () => {
    const handler = new HookEventHandler(
      new AgentStateStore(),
      new Map(),
      new Map(),
      claudeProvider,
      new SessionRouter(),
      { current: true },
      observedProviders,
    );
    const onExternalSessionDetected = vi.fn();
    handler.setLifecycleCallbacks({ onExternalSessionDetected });
    handler.handleEvent('codex', {
      hook_event_name: 'SessionStart',
      session_id: 'c1',
      cwd: '/w/proj',
      transcript_path: '/rollout-c1.jsonl',
    });
    handler.handleEvent('codex', { hook_event_name: 'Stop', session_id: 'c1' });
    expect(onExternalSessionDetected).toHaveBeenCalledWith('c1', undefined, '/w/proj', 'codex');
  });
});

describe('focusForwarder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills provider and session id into the URL template', () => {
    const template = 'http://127.0.0.1:8026/api/sessions/{provider}/{sessionId}/fokus';
    expect(focusUrlFor(template, { sessionId: 'a b', providerId: 'codex' })).toBe(
      'http://127.0.0.1:8026/api/sessions/codex/a%20b/fokus',
    );
    expect(focusUrlFor(template, { sessionId: 's1', providerId: undefined })).toBe(
      'http://127.0.0.1:8026/api/sessions/claude/s1/fokus',
    );
  });

  it('posts with the bearer token only when configured', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const agent = { id: 3, sessionId: 's1', providerId: 'claude' };
    forwardFocus(agent, {});
    expect(fetchMock).not.toHaveBeenCalled();
    forwardFocus(agent, {
      PIXEL_AGENTS_FOCUS_URL: 'http://x/{provider}/{sessionId}',
      PIXEL_AGENTS_FOCUS_TOKEN: 'tok',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://x/claude/s1',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer tok' } }),
    );
  });
});
