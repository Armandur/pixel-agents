import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { QuotaSnapshot, QuotaWindow } from '../../../../../core/src/provider.js';
import { CLAUDE_QUOTA_CACHE_PATH } from './constants.js';

const WINDOW_KEYS = [
  ['five_hour', '5h'],
  ['seven_day', '7d'],
] as const;

function defaultCacheFile(): string {
  return path.join(os.homedir(), CLAUDE_QUOTA_CACHE_PATH);
}

/**
 * Read the quota the statusline script cached:
 * `{ rate_limits: { five_hour, seven_day: { used_percentage, resets_at } }, captured_at }`
 * (all times epoch seconds). A missing file, broken JSON or a shape that holds
 * no usable window yields undefined -- never an exception.
 */
export function readClaudeQuota(file = defaultCacheFile()): QuotaSnapshot | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const limits = (raw as { rate_limits?: Record<string, unknown> } | null)?.rate_limits;
    if (!limits || typeof limits !== 'object') return undefined;

    const windows: QuotaWindow[] = [];
    for (const [key, id] of WINDOW_KEYS) {
      const w = limits[key] as { used_percentage?: unknown; resets_at?: unknown } | null;
      const used = w?.used_percentage;
      const resetsAt = w?.resets_at;
      if (typeof used !== 'number' || !Number.isFinite(used)) continue;
      if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) continue;
      windows.push({ id, usedPercent: Math.min(100, Math.max(0, used)), resetsAt });
    }
    if (windows.length === 0) return undefined;

    const stamped = (raw as { captured_at?: unknown }).captured_at;
    const capturedAt =
      typeof stamped === 'number' && Number.isFinite(stamped)
        ? stamped
        : fs.statSync(file).mtimeMs / 1000;
    return { windows, capturedAt };
  } catch {
    return undefined;
  }
}
