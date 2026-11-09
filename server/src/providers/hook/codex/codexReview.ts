import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CODEX_CONFIG_FILE, CODEX_REVIEW_TAIL_BYTES, CODEX_SESSIONS_DIR } from './constants.js';

const REVIEWER_IN_ROLLOUT = /"approvals_reviewer":"([a-z_]+)"/g;
const REVIEWER_IN_CONFIG = /^\s*approvals_reviewer\s*=\s*"([a-z_]+)"/m;

/** The latest approvals_reviewer a rollout recorded (its turn settings), read from its end. */
function reviewerInRollout(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, CODEX_REVIEW_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    let last: string | undefined;
    for (const m of buf.toString('utf8').matchAll(REVIEWER_IN_ROLLOUT)) last = m[1];
    return last;
  } catch {
    return undefined; // no rollout to read: fall back to the config file
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function reviewerInConfig(home: string): string | undefined {
  try {
    return REVIEWER_IN_CONFIG.exec(
      fs.readFileSync(path.join(home, CODEX_CONFIG_FILE), 'utf8'),
    )?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Whether a Codex session's approval requests are decided by Codex's own
 * reviewer model (`approvals_reviewer = "auto_review"`) rather than by the
 * user. Its PermissionRequest hook still fires, but nobody is asked. The
 * session's rollout says what it runs with; only a rollout under the Codex
 * sessions directory is read (the path comes from the hook payload).
 */
export function codexAutoReviewed(transcriptPath: unknown, home = os.homedir()): boolean {
  const sessions = path.join(home, CODEX_SESSIONS_DIR) + path.sep;
  const rollout =
    typeof transcriptPath === 'string' && path.resolve(transcriptPath).startsWith(sessions)
      ? reviewerInRollout(path.resolve(transcriptPath))
      : undefined;
  return (rollout ?? reviewerInConfig(home)) === 'auto_review';
}
