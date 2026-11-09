import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { codexAutoReviewed } from '../src/providers/hook/codex/codexReview.js';

describe('codexAutoReviewed', () => {
  let home: string;
  let rollout: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-codex-'));
    fs.mkdirSync(path.join(home, '.codex/sessions/2026/11/09'), { recursive: true });
    rollout = path.join(home, '.codex/sessions/2026/11/09/rollout-x.jsonl');
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const turn = (reviewer: string) =>
    JSON.stringify({
      type: 'turn_context',
      payload: { approval_policy: 'on-request', approvals_reviewer: reviewer },
    }) + '\n';

  it('the session rollout decides, its latest turn settings winning', () => {
    fs.writeFileSync(rollout, turn('user') + turn('auto_review'));
    expect(codexAutoReviewed(rollout, home)).toBe(true);
    fs.writeFileSync(rollout, turn('auto_review') + turn('user'));
    expect(codexAutoReviewed(rollout, home)).toBe(false);
  });

  it('falls back to config.toml when the rollout says nothing', () => {
    fs.writeFileSync(rollout, '{"type":"event_msg"}\n');
    expect(codexAutoReviewed(rollout, home)).toBe(false);
    fs.writeFileSync(
      path.join(home, '.codex/config.toml'),
      'model = "x"\napprovals_reviewer = "auto_review"\n',
    );
    expect(codexAutoReviewed(rollout, home)).toBe(true);
  });

  it('never reads a path outside the Codex sessions directory', () => {
    const outside = path.join(home, 'elsewhere.jsonl');
    fs.writeFileSync(outside, turn('auto_review'));
    expect(codexAutoReviewed(outside, home)).toBe(false);
    expect(codexAutoReviewed(path.join(home, '.codex/sessions/../../elsewhere.jsonl'), home)).toBe(
      false,
    );
  });
});
