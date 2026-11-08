import { describe, expect, it } from 'vitest';

import {
  agentDisplayName,
  getActivityText,
  IDLE_ACTIVITY_TEXT,
  WAITING_INPUT_ACTIVITY_TEXT,
} from '../src/office/activityText.js';
import type { Character, ToolActivity } from '../src/office/types.js';

const tool = (status: string, done = false): ToolActivity => ({ toolId: status, status, done });

describe('getActivityText', () => {
  it('is Idle with nothing running or pending', () => {
    expect(getActivityText(undefined, false, null, false)).toBe(IDLE_ACTIVITY_TEXT);
    // A finished turn (checkmark without awaiting input) also reads Idle.
    expect(getActivityText([tool('Running: x', true)], false, 'waiting', false)).toBe(
      IDLE_ACTIVITY_TEXT,
    );
  });

  it('waiting for input and permission are their own, non-idle labels', () => {
    expect(getActivityText(undefined, false, 'waiting', true)).toBe(WAITING_INPUT_ACTIVITY_TEXT);
    expect(getActivityText(undefined, true, 'permission', false)).toBe('Needs approval');
  });

  it('shows the newest running tool', () => {
    expect(
      getActivityText([tool('Reading a.ts', true), tool('Running: npm test')], true, null, false),
    ).toBe('Running: npm test');
  });
});

describe('agentDisplayName', () => {
  const ch = (fields: Partial<Character>) => fields as Character;

  it('prefers the team role, then the Directory, then the id', () => {
    expect(agentDisplayName(1, ch({ isTeamLead: true, directoryName: 'infra' }))).toBe(
      'LEAD · infra',
    );
    expect(agentDisplayName(2, ch({ agentName: 'reviewer', directoryName: 'infra' }))).toBe(
      'reviewer',
    );
    expect(agentDisplayName(3, ch({ directoryName: 'svky.se' }))).toBe('svky.se');
    expect(agentDisplayName(4, undefined)).toBe('Agent 4');
  });
});
