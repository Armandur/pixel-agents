import type { QuotaUpdate } from '../../core/src/messages.js';
import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { QUOTA_STALE_AFTER_SEC } from './constants.js';

/** Build the wire message for one provider's snapshot. `stale` is only set
 *  when true, so a fresh snapshot compares equal tick after tick. */
export function quotaMessage(provider: HookProvider, nowSec: number): QuotaUpdate | undefined {
  const snap = provider.readQuota?.();
  if (!snap) return undefined;
  const msg: QuotaUpdate = {
    type: 'quotaUpdate',
    provider: provider.id,
    windows: snap.windows,
    capturedAt: snap.capturedAt,
  };
  if (nowSec - snap.capturedAt > QUOTA_STALE_AFTER_SEC) msg.stale = true;
  return msg;
}

/**
 * Keeps the latest quota message per provider. `refresh` re-reads every
 * provider and broadcasts only the messages that changed (including a fresh
 * snapshot turning stale); `messages` is what a connecting client is sent.
 */
export class QuotaTracker {
  private readonly latest = new Map<string, QuotaUpdate>();

  constructor(
    private readonly store: AgentStateStore,
    private readonly providers: readonly HookProvider[],
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  refresh(): void {
    const nowSec = this.now();
    for (const provider of this.providers) {
      const msg = quotaMessage(provider, nowSec);
      if (!msg) continue;
      const prev = this.latest.get(provider.id);
      if (prev && JSON.stringify(prev) === JSON.stringify(msg)) continue;
      this.latest.set(provider.id, msg);
      this.store.broadcast({ ...msg });
    }
  }

  messages(): Array<Record<string, unknown>> {
    return [...this.latest.values()].map((m) => ({ ...m }));
  }
}
