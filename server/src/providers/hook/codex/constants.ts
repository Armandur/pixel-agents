/** Codex's session rollouts, relative to the home directory: `YYYY/MM/DD/rollout-*.jsonl`. */
export const CODEX_SESSIONS_DIR = '.codex/sessions';
/** How much of a rollout's end is read to find the latest rate limits. */
export const CODEX_QUOTA_TAIL_BYTES = 256 * 1024;
/** How many of the newest rollouts are tried before giving up (a fresh
 *  session has no `token_count` record yet). */
export const CODEX_QUOTA_MAX_ROLLOUTS = 5;
