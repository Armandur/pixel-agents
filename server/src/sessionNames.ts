import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import { mintFigure } from './figures/index.js';

/**
 * Copy each provider's session names onto its agents, broadcasting
 * `agentSessionName` only for a name (or crown) that changed. A session that
 * ends drops out of the registry; its agent keeps the last name it was seen
 * under. `crownedSessions` are the names, matched case-insensitively, whose
 * agents wear a crown.
 */
export function refreshSessionNames(
  store: AgentStateStore,
  providers: readonly HookProvider[],
  crownedSessions: readonly string[] = [],
): void {
  const crowned = new Set(crownedSessions.map((n) => n.toLowerCase()));
  const byProvider = new Map<string, Map<string, string>>();
  for (const provider of providers) {
    const names = provider.sessionNames?.();
    if (names) byProvider.set(provider.id, names);
  }
  if (byProvider.size === 0) return;
  let minted = false;

  for (const [id, agent] of store) {
    const name =
      byProvider.get(agent.providerId ?? 'claude')?.get(agent.sessionId) ?? agent.sessionName;
    if (!name) continue;
    const isCrowned = crowned.has(name.toLowerCase());
    if (name !== agent.sessionName || isCrowned !== !!agent.crowned) {
      agent.sessionName = name;
      agent.crowned = isCrowned;
      store.broadcast({ type: 'agentSessionName', id, sessionName: name, crowned: isCrowned });
    }
    if (mintFigure(store, id, agent)) minted = true;
  }
  if (minted) store.persist();
}
