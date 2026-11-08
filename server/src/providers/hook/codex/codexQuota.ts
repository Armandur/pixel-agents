import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { QuotaSnapshot, QuotaWindow } from '../../../../../core/src/provider.js';
import { QUOTA_WINDOW_MINUTES } from '../../../constants.js';
import {
  CODEX_QUOTA_MAX_ROLLOUTS,
  CODEX_QUOTA_TAIL_BYTES,
  CODEX_SESSIONS_DIR,
} from './constants.js';

function defaultSessionsDir(): string {
  return path.join(os.homedir(), CODEX_SESSIONS_DIR);
}

/** Subdirectory names that are plain numbers, newest (highest) first. */
function numericDirsDesc(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
}

/**
 * The newest rollout files, most recently modified first. Rollouts live in
 * `YYYY/MM/DD/`, so walk the date tree newest-first instead of stat-ing every
 * file ever written, and gather from the two newest populated days (a session
 * started yesterday can still be the one being written to).
 */
function newestRollouts(root: string): string[] {
  const found: Array<{ file: string; mtime: number }> = [];
  let populatedDays = 0;
  for (const y of numericDirsDesc(root)) {
    for (const m of numericDirsDesc(path.join(root, y))) {
      for (const d of numericDirsDesc(path.join(root, y, m))) {
        const dayDir = path.join(root, y, m, d);
        const before = found.length;
        try {
          for (const name of fs.readdirSync(dayDir)) {
            if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
            const file = path.join(dayDir, name);
            found.push({ file, mtime: fs.statSync(file).mtimeMs });
          }
        } catch {
          continue;
        }
        if (found.length > before) populatedDays++;
        if (populatedDays >= 2) return sortedNewest(found);
      }
    }
  }
  return sortedNewest(found);
}

function sortedNewest(found: Array<{ file: string; mtime: number }>): string[] {
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, CODEX_QUOTA_MAX_ROLLOUTS)
    .map((f) => f.file);
}

function readTail(file: string, maxBytes: number): string {
  const handle = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(handle).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    return buffer.toString('utf-8');
  } finally {
    fs.closeSync(handle);
  }
}

function windowOf(raw: unknown): QuotaWindow | undefined {
  const w = raw as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown } | null;
  if (!w || typeof w !== 'object') return undefined;
  const { used_percent: used, window_minutes: minutes, resets_at: resetsAt } = w;
  if (typeof used !== 'number' || !Number.isFinite(used)) return undefined;
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return undefined;
  const id =
    minutes === QUOTA_WINDOW_MINUTES['5h']
      ? '5h'
      : minutes === QUOTA_WINDOW_MINUTES['7d']
        ? '7d'
        : undefined;
  if (!id) return undefined;
  return { id, usedPercent: Math.min(100, Math.max(0, used)), resetsAt };
}

/** The newest `token_count` record in a rollout tail that carries rate limits. */
function snapshotFromTail(text: string, fallbackCapturedAt: number): QuotaSnapshot | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    try {
      // The first line of a tail may be cut mid-record; a parse failure skips it.
      const rec = JSON.parse(lines[i]) as {
        timestamp?: unknown;
        payload?: {
          type?: unknown;
          rate_limits?: { primary?: unknown; secondary?: unknown } | null;
        };
      };
      const limits = rec.payload?.rate_limits;
      if (rec.payload?.type !== 'token_count' || !limits) continue;
      const windows = [windowOf(limits.primary), windowOf(limits.secondary)].filter(
        (w): w is QuotaWindow => w !== undefined,
      );
      if (windows.length === 0) continue;
      const stamped = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) / 1000 : NaN;
      return { windows, capturedAt: Number.isFinite(stamped) ? stamped : fallbackCapturedAt };
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Codex writes its rate limits into every `token_count` record of the session
 * rollout. Read only the tail of the newest rollouts and map windows by length
 * (300 min -> 5h, 10080 min -> 7d). A plan without a 5 h window simply yields
 * a snapshot with only the 7 d one. Anything unreadable is undefined.
 */
export function readCodexQuota(root = defaultSessionsDir()): QuotaSnapshot | undefined {
  try {
    for (const file of newestRollouts(root)) {
      try {
        const snap = snapshotFromTail(
          readTail(file, CODEX_QUOTA_TAIL_BYTES),
          fs.statSync(file).mtimeMs / 1000,
        );
        if (snap) return snap;
      } catch {
        continue;
      }
    }
  } catch {
    // fall through to undefined
  }
  return undefined;
}
