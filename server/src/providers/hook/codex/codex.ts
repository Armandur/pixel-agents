import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';
import { claudeProvider } from '../claude/claude.js';

/**
 * Codex CLI (0.164+) as an observe-only hook provider.
 *
 * Codex hook payloads use the same field names as Claude Code
 * (hook_event_name, session_id, cwd, tool_name, tool_input), so normalization
 * delegates to the Claude provider with three differences:
 *
 * - `transcript_path` is dropped. Codex rollout files are not Claude JSONL, so
 *   the session is adopted hooks-only and its state comes from hook events.
 * - `Interrupt` (Esc in the TUI) ends the turn.
 * - Hooks are never installed by Pixel Agents. They are owned by whatever
 *   forwards Codex events here (an external status layer), so installHooks is
 *   a no-op and the provider is kept out of the consent/install loop.
 */
function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  if (raw.hook_event_name === 'Interrupt') {
    const sessionId = raw.session_id;
    if (typeof sessionId !== 'string' || !sessionId) return null;
    return { sessionId, event: { kind: 'turnEnd' } };
  }
  const { transcript_path: _ignored, ...rest } = raw;
  return claudeProvider.normalizeHookEvent(rest);
}

export const codexProvider: HookProvider = {
  kind: 'hook',
  id: 'codex',
  displayName: 'Codex',
  protocolVersion: 1,

  normalizeHookEvent,

  installHooks: () => Promise.resolve(),
  uninstallHooks: () => Promise.resolve(),
  areHooksInstalled: () => Promise.resolve(false),
  consentDisclosure: () => ({
    headline: 'Codex hooks are managed externally',
    disclosure:
      'Pixel Agents does not modify ~/.codex/hooks.json. It only displays Codex events it receives.',
  }),

  formatToolStatus: claudeProvider.formatToolStatus,
  permissionExemptTools: new Set(['request_user_input']),
  subagentToolNames: new Set<string>(),
  readingTools: new Set<string>(),
};
