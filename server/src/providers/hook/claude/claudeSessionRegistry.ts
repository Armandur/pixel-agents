import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CLAUDE_SESSION_REGISTRY_DIR } from './constants.js';

interface RegistryEntry {
  pid?: unknown;
  sessionId?: unknown;
  name?: unknown;
  updatedAt?: unknown;
  messagingSocketPath?: unknown;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface SessionEntry {
  sessionId: string;
  name: string;
  socketPath?: string;
}

/**
 * Claude Code's live-session registry: one `<pid>.json` per running CLI,
 * carrying the session's id, name and messaging socket. Only `*.json` is read
 * — the directory also holds `*.key` files, which are secrets and never
 * opened. A crash leaves a stale entry and a resumed session gets a new pid,
 * so per session a live pid wins over a dead one, then the newest `updatedAt`.
 */
function readClaudeSessionEntries(dir: string): SessionEntry[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const best = new Map<string, SessionEntry & { alive: boolean; updatedAt: number }>();
  for (const file of files) {
    let entry: RegistryEntry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as RegistryEntry;
    } catch {
      continue; // Written while we read, or not ours to parse.
    }
    if (typeof entry.sessionId !== 'string' || typeof entry.name !== 'string' || !entry.name) {
      continue;
    }
    const alive = typeof entry.pid === 'number' && isAlive(entry.pid);
    const updatedAt = typeof entry.updatedAt === 'number' ? entry.updatedAt : 0;
    const prev = best.get(entry.sessionId);
    if (!prev || (alive && !prev.alive) || (alive === prev.alive && updatedAt > prev.updatedAt)) {
      best.set(entry.sessionId, {
        sessionId: entry.sessionId,
        name: entry.name,
        socketPath:
          typeof entry.messagingSocketPath === 'string' ? entry.messagingSocketPath : undefined,
        alive,
        updatedAt,
      });
    }
  }
  return [...best.values()];
}

const defaultRegistryDir = () => path.join(os.homedir(), CLAUDE_SESSION_REGISTRY_DIR);

/** Session names ("Kistvakt", "Dirigent") by session id. */
export function readClaudeSessionNames(dir = defaultRegistryDir()): Map<string, string> {
  return new Map(readClaudeSessionEntries(dir).map((e) => [e.sessionId, e.name]));
}

/**
 * The session a SendMessage `to` addresses: a session name, a name with the
 * " [ref]" disambiguation suffix, or `uds:<socket path>`. Undefined when no
 * running session matches (a cloud peer, a teammate, a typo).
 */
export function resolveClaudeSessionTarget(
  to: string,
  dir = defaultRegistryDir(),
): string | undefined {
  const entries = readClaudeSessionEntries(dir);
  if (to.startsWith('uds:')) {
    const socket = to.slice('uds:'.length);
    return entries.find((e) => e.socketPath === socket)?.sessionId;
  }
  const name = to.replace(/\s+\[[^\]]*\]$/, '');
  return entries.find((e) => e.name === name)?.sessionId;
}
