import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CLAUDE_SESSION_REGISTRY_DIR } from './constants.js';

interface RegistryEntry {
  pid?: unknown;
  sessionId?: unknown;
  name?: unknown;
  updatedAt?: unknown;
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

/**
 * Session names ("Kistvakt", "dirigent-9a") by session id, from Claude Code's
 * live-session registry: one `<pid>.json` per running CLI. Only `*.json` is
 * read — the directory also holds `*.key` files, which are secrets and never
 * opened. A crash leaves a stale entry and a resumed session gets a new pid,
 * so a live pid wins over a dead one, then the newest `updatedAt`.
 */
export function readClaudeSessionNames(
  dir = path.join(os.homedir(), CLAUDE_SESSION_REGISTRY_DIR),
): Map<string, string> {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return new Map();
  }
  const best = new Map<string, { name: string; alive: boolean; updatedAt: number }>();
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
      best.set(entry.sessionId, { name: entry.name, alive, updatedAt });
    }
  }
  return new Map([...best].map(([id, v]) => [id, v.name]));
}
