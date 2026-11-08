import * as fs from 'fs';

import type { AgentStateStore } from './agentStateStore.js';
import type { AgentState } from './types.js';

/**
 * Tracks since when each agent has been idle — waiting on the user or done
 * with its turn — and publishes it as `agentIdleSince`. It listens to the
 * store's own broadcasts rather than hooking the six places that send
 * `agentStatus`: entering `waiting` starts the clock (once; a Done that turns
 * into Waiting for input keeps it), `active` or a new tool stops it. An agent
 * that appears with no activity yet is seeded from its transcript's mtime.
 */
export class IdleSinceTracker {
  private readonly onBroadcast = (message: Record<string, unknown>): void => {
    const id = message.id;
    if (typeof id !== 'number') return;
    if (message.type === 'agentStatus') {
      if (message.status === 'waiting') {
        if (this.store.get(id)?.idleSince === undefined) this.set(id, Date.now());
      } else {
        this.set(id, undefined);
      }
    } else if (message.type === 'agentToolStart') {
      this.set(id, undefined);
    }
  };

  private readonly onAdded = (id: number, agent: AgentState): void => {
    if (agent.idleSince !== undefined || !agent.jsonlFile) return;
    try {
      this.set(id, Math.round(fs.statSync(agent.jsonlFile).mtimeMs));
    } catch {
      // No transcript yet (a fresh launch): the first turn end starts the clock.
    }
  };

  constructor(private readonly store: AgentStateStore) {
    store.on('broadcast', this.onBroadcast);
    store.on('agentAdded', this.onAdded);
  }

  private set(id: number, since: number | undefined): void {
    const agent = this.store.get(id);
    if (!agent || agent.idleSince === since) return;
    agent.idleSince = since;
    // Deferred so the message lands after the one that triggered it.
    queueMicrotask(() => this.store.broadcast({ type: 'agentIdleSince', id, since }));
  }

  dispose(): void {
    this.store.off('broadcast', this.onBroadcast);
    this.store.off('agentAdded', this.onAdded);
  }
}
