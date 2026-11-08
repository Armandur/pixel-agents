import type { AgentState } from './types.js';

/**
 * Standalone: forward a character click (focusAgent) to an external endpoint,
 * e.g. a status layer that switches the operator's tmux pane to that session.
 *
 * Configured by environment, off when unset:
 *   PIXEL_AGENTS_FOCUS_URL    template with {provider} and {sessionId},
 *                             e.g. http://127.0.0.1:8026/api/sessions/{provider}/{sessionId}/fokus
 *   PIXEL_AGENTS_FOCUS_TOKEN  sent as `Authorization: Bearer <token>`
 *
 * Only privileged (tokened) clients reach this: the read-only gate in
 * handleClientMessage refuses focusAgent before it gets here.
 */
const FOCUS_TIMEOUT_MS = 2000;

export function focusUrlFor(
  template: string,
  agent: Pick<AgentState, 'sessionId' | 'providerId'>,
): string {
  return template
    .replaceAll('{provider}', encodeURIComponent(agent.providerId ?? 'claude'))
    .replaceAll('{sessionId}', encodeURIComponent(agent.sessionId));
}

export function forwardFocus(
  agent: Pick<AgentState, 'id' | 'sessionId' | 'providerId'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const template = env['PIXEL_AGENTS_FOCUS_URL'];
  if (!template || !agent?.sessionId) return;
  const token = env['PIXEL_AGENTS_FOCUS_TOKEN'];
  const url = focusUrlFor(template, agent);
  void fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(FOCUS_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[Pixel Agents] Focus forward for agent ${agent.id} answered ${res.status}`);
      }
    })
    .catch((err: unknown) => {
      console.warn(
        `[Pixel Agents] Focus forward for agent ${agent.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
