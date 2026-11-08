import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HookProvider, QuotaSnapshot } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { readClaudeQuota } from '../src/providers/hook/claude/claudeQuota.js';
import { readCodexQuota } from '../src/providers/hook/codex/codexQuota.js';
import { QuotaTracker } from '../src/quota.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-quota-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readClaudeQuota', () => {
  const file = () => path.join(dir, 'claude-quota.json');

  it('maps five_hour and seven_day to 5h and 7d', () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 63.5, resets_at: 1000 },
          seven_day: { used_percentage: 20, resets_at: 2000 },
        },
        captured_at: 500.25,
      }),
    );
    expect(readClaudeQuota(file())).toEqual({
      windows: [
        { id: '5h', usedPercent: 63.5, resetsAt: 1000 },
        { id: '7d', usedPercent: 20, resetsAt: 2000 },
      ],
      capturedAt: 500.25,
    });
  });

  it('keeps the window that exists when the other is missing', () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({
        rate_limits: { five_hour: null, seven_day: { used_percentage: 5, resets_at: 9 } },
        captured_at: 1,
      }),
    );
    expect(readClaudeQuota(file())?.windows.map((w) => w.id)).toEqual(['7d']);
  });

  it('returns undefined for a missing file, broken JSON, or no usable window', () => {
    expect(readClaudeQuota(file())).toBeUndefined();
    fs.writeFileSync(file(), '{"rate_limits": {');
    expect(readClaudeQuota(file())).toBeUndefined();
    fs.writeFileSync(
      file(),
      JSON.stringify({ rate_limits: { five_hour: { used_percentage: 'x' } } }),
    );
    expect(readClaudeQuota(file())).toBeUndefined();
    fs.writeFileSync(file(), 'null');
    expect(readClaudeQuota(file())).toBeUndefined();
  });

  it('falls back to the file mtime when captured_at is absent', () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1, resets_at: 9 } } }),
    );
    const snap = readClaudeQuota(file());
    expect(Math.abs((snap?.capturedAt ?? 0) - Date.now() / 1000)).toBeLessThan(60);
  });
});

describe('readCodexQuota', () => {
  function rollout(day: string, name: string, lines: string[], mtimeSec?: number): string {
    const d = path.join(dir, ...day.split('-'));
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, `rollout-${name}.jsonl`);
    fs.writeFileSync(f, lines.join('\n') + '\n');
    if (mtimeSec) fs.utimesSync(f, mtimeSec, mtimeSec);
    return f;
  }
  const tokenCount = (limits: unknown, timestamp = '2026-11-08T19:38:15.066Z') =>
    JSON.stringify({
      timestamp,
      type: 'event_msg',
      payload: { type: 'token_count', info: null, rate_limits: limits },
    });

  it('reads primary as 7d when window_minutes is 10080 and secondary is null', () => {
    rollout('2026-11-08', 'a', [
      JSON.stringify({ type: 'session_meta' }),
      tokenCount({
        primary: { used_percent: 20.0, window_minutes: 10080, resets_at: 1794415818 },
        secondary: null,
      }),
    ]);
    expect(readCodexQuota(dir)).toEqual({
      windows: [{ id: '7d', usedPercent: 20, resetsAt: 1794415818 }],
      capturedAt: Date.parse('2026-11-08T19:38:15.066Z') / 1000,
    });
  });

  it('maps by window length, so a 300 minute window becomes 5h', () => {
    rollout('2026-11-08', 'a', [
      tokenCount({
        primary: { used_percent: 10, window_minutes: 300, resets_at: 1 },
        secondary: { used_percent: 40, window_minutes: 10080, resets_at: 2 },
      }),
    ]);
    expect(readCodexQuota(dir)?.windows).toEqual([
      { id: '5h', usedPercent: 10, resetsAt: 1 },
      { id: '7d', usedPercent: 40, resetsAt: 2 },
    ]);
  });

  it('uses the last record in the tail, not the first', () => {
    const w = (p: number) => ({
      primary: { used_percent: p, window_minutes: 10080, resets_at: 3 },
    });
    rollout('2026-11-08', 'a', [tokenCount(w(10)), tokenCount(w(30))]);
    expect(readCodexQuota(dir)?.windows[0].usedPercent).toBe(30);
  });

  it('skips a newer rollout without a usable token_count', () => {
    const good = tokenCount({ primary: { used_percent: 7, window_minutes: 10080, resets_at: 3 } });
    rollout('2026-11-07', 'old', [good], 1000);
    rollout(
      '2026-11-08',
      'fresh',
      [JSON.stringify({ type: 'session_meta' }), '{"rate_limits": {'],
      2000,
    );
    expect(readCodexQuota(dir)?.windows[0].usedPercent).toBe(7);
  });

  it('is undefined for a missing directory, an empty tree, or junk', () => {
    expect(readCodexQuota(path.join(dir, 'nope'))).toBeUndefined();
    expect(readCodexQuota(dir)).toBeUndefined();
    rollout('2026-11-08', 'a', ['not json', tokenCount(null), tokenCount({ primary: 'x' })]);
    expect(readCodexQuota(dir)).toBeUndefined();
  });
});

describe('QuotaTracker', () => {
  function setup(now: { t: number }) {
    const store = new AgentStateStore();
    const sent: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m: Record<string, unknown>) => sent.push(m));
    const snap: { current: QuotaSnapshot | undefined } = { current: undefined };
    const provider = { id: 'claude', readQuota: () => snap.current } as unknown as HookProvider;
    const tracker = new QuotaTracker(store, [provider], () => now.t);
    return { tracker, sent, snap };
  }
  const snapAt = (pct: number, capturedAt: number): QuotaSnapshot => ({
    windows: [{ id: '7d', usedPercent: pct, resetsAt: 99 }],
    capturedAt,
  });

  it('broadcasts only on change and says nothing without a source', () => {
    const now = { t: 1000 };
    const { tracker, sent, snap } = setup(now);
    tracker.refresh();
    expect(sent).toEqual([]);

    snap.current = snapAt(10, 990);
    tracker.refresh();
    tracker.refresh();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'quotaUpdate', provider: 'claude', capturedAt: 990 });
    expect(sent[0]).not.toHaveProperty('stale');

    snap.current = snapAt(11, 995);
    tracker.refresh();
    expect(sent).toHaveLength(2);
    expect(tracker.messages()).toHaveLength(1);
  });

  it('marks a snapshot older than 15 minutes stale and re-broadcasts when it turns stale', () => {
    const now = { t: 1000 };
    const { tracker, sent, snap } = setup(now);
    snap.current = snapAt(10, 1000);
    tracker.refresh();
    expect(sent[0]).not.toHaveProperty('stale');

    now.t = 1000 + 15 * 60 + 1;
    tracker.refresh();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ stale: true });
  });
});

describe('webviewReady', () => {
  let originalHome: string | undefined;
  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = dir;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('sends the latest quotaUpdate to a connecting client', () => {
    const cache = path.join(dir, '.cache', 'agentkontoret');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
      path.join(cache, 'claude-quota.json'),
      JSON.stringify({
        rate_limits: { seven_day: { used_percentage: 42, resets_at: 777 } },
        captured_at: Date.now() / 1000,
      }),
    );
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    try {
      runtime.startQuotaPolling();
      const sent: Array<Record<string, unknown>> = [];
      handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), {
        store,
        runtime,
        cache: null,
        privileged: true,
      });
      expect(sent.find((m) => m.type === 'quotaUpdate')).toEqual({
        type: 'quotaUpdate',
        provider: 'claude',
        windows: [{ id: '7d', usedPercent: 42, resetsAt: 777 }],
        capturedAt: expect.any(Number),
      });
    } finally {
      runtime.dispose();
    }
  });
});
