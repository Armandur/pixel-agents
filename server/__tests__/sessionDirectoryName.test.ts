import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessionDirectoryName } from '../src/sessionDirectoryName.js';

describe('sessionDirectoryName', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-dirname-')),
      '-home-rasmus-workspace-kyrkohandboken-new',
    );
    fs.mkdirSync(projectDir);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(projectDir), { recursive: true, force: true });
  });

  function transcript(lines: unknown[]): string {
    const file = path.join(projectDir, 'session.jsonl');
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return file;
  }

  it('names the session after the cwd the transcript records', () => {
    const file = transcript([
      { type: 'file-history-snapshot' },
      { type: 'user', cwd: '/home/rasmus/workspace/kyrkohandboken-new' },
    ]);
    expect(sessionDirectoryName(file, projectDir)).toBe('kyrkohandboken-new');
  });

  it("prefers the hook's cwd over the transcript", () => {
    const file = transcript([{ type: 'user', cwd: '/elsewhere/other' }]);
    expect(sessionDirectoryName(file, projectDir, '/home/rasmus/workspace/svky.se')).toBe(
      'svky.se',
    );
  });

  it('falls back to the hash segment when no cwd is recorded', () => {
    const file = transcript([{ type: 'user' }]);
    expect(sessionDirectoryName(file, projectDir)).toBe('new');
  });
});
