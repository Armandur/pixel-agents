import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';

/**
 * Copy each provider's session names onto its agents, broadcasting
 * `agentSessionName` only for a name that changed. A session that ends drops
 * out of the registry; its agent keeps the last name it was seen under.
 */
export function refreshSessionNames(
  store: AgentStateStore,
  providers: readonly HookProvider[],
): void {
  const byProvider = new Map<string, Map<string, string>>();
  for (const provider of providers) {
    const names = provider.sessionNames?.();
    if (names) byProvider.set(provider.id, names);
  }
  if (byProvider.size === 0) return;

  for (const [id, agent] of store) {
    const name = byProvider.get(agent.providerId ?? 'claude')?.get(agent.sessionId);
    if (!name || name === agent.sessionName) continue;
    agent.sessionName = name;
    store.broadcast({ type: 'agentSessionName', id, sessionName: name });
  }
}
