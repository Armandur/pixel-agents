import { describe, expect, it } from 'vitest';

import {
  cardVariant,
  crownedFirst,
  groupSubagentsByParent,
  matchesCardFilter,
  mergeOrder,
  reorderByPointer,
  subagentRow,
} from '../src/components/cardBar.js';

describe('cardVariant', () => {
  it('the showing pane wins over the selected character', () => {
    expect(cardVariant(1, { activeId: 1, focusedId: 1 })).toBe('active');
    expect(cardVariant(2, { activeId: 1, focusedId: 2 })).toBe('focused');
    expect(cardVariant(3, { activeId: 1, focusedId: 2 })).toBe('default');
  });
});

describe('mergeOrder', () => {
  it('keeps the saved order, drops closed agents, appends new ones in creation order', () => {
    expect(mergeOrder([3, 1, 9], [1, 2, 3, 4])).toEqual([3, 1, 2, 4]);
  });

  it('is the live order when nothing was saved', () => {
    expect(mergeOrder([], [5, 6])).toEqual([5, 6]);
  });
});

describe('reorderByPointer', () => {
  // Cards 1..4 laid out 100px apart: midpoints 50, 150, 250, 350.
  const mid = (id: number) => (id - 1) * 100 + 50;

  it('inserts before the first other card whose midpoint is right of the finger', () => {
    expect(reorderByPointer([1, 2, 3, 4], 4, mid, 120)).toEqual([1, 4, 2, 3]);
  });

  it('moves the card last when the finger is past every midpoint', () => {
    expect(reorderByPointer([1, 2, 3, 4], 1, mid, 900)).toEqual([2, 3, 4, 1]);
  });

  it('moves the card first when the finger is left of every midpoint', () => {
    expect(reorderByPointer([1, 2, 3, 4], 3, mid, 0)).toEqual([3, 1, 2, 4]);
  });

  it('skips cards that are not laid out', () => {
    const partial = (id: number) => (id === 2 ? null : mid(id));
    expect(reorderByPointer([1, 2, 3], 1, partial, 200)).toEqual([2, 1, 3]);
  });
});

describe('matchesCardFilter', () => {
  const all = { query: '', hideIdle: false };

  it('matches the name case-insensitively, ignoring surrounding space', () => {
    expect(
      matchesCardFilter({ name: 'svky.se', status: 'working' }, { ...all, query: ' SVKY ' }),
    ).toBe(true);
    expect(matchesCardFilter({ name: 'infra', status: 'working' }, { ...all, query: 'svky' })).toBe(
      false,
    );
  });

  it('matches the provider too, so "codex" finds Codex agents', () => {
    expect(
      matchesCardFilter(
        { name: 'oldKbok', provider: 'Codex', status: 'working' },
        { ...all, query: 'codex' },
      ),
    ).toBe(true);
    expect(
      matchesCardFilter(
        { name: 'oldKbok', provider: 'Claude', status: 'working' },
        { ...all, query: 'codex' },
      ),
    ).toBe(false);
  });

  it('hide-idle drops idle agents and agents with no activity yet, keeps attention', () => {
    const hide = { query: '', hideIdle: true };
    expect(matchesCardFilter({ name: 'a', status: 'idle' }, hide)).toBe(false);
    expect(matchesCardFilter({ name: 'a', status: null }, hide)).toBe(false);
    expect(matchesCardFilter({ name: 'a', status: 'attention' }, hide)).toBe(true);
    expect(matchesCardFilter({ name: 'a', status: 'working' }, hide)).toBe(true);
  });
});

describe('crownedFirst', () => {
  it('moves crowned agents to the top and keeps both groups in order', () => {
    expect(crownedFirst([1, 2, 3, 4], (id) => id === 3 || id === 4)).toEqual([3, 4, 1, 2]);
  });
});

describe('groupSubagentsByParent', () => {
  it('groups by main agent in creation order and leaves childless agents out', () => {
    const subs = [
      { id: -1, parentAgentId: 1, label: 'Judge' },
      { id: -2, parentAgentId: 2, label: 'Explore' },
      { id: -3, parentAgentId: 1, label: 'Plan' },
    ];
    const grouped = groupSubagentsByParent(subs);
    expect(grouped.get(1)?.map((s) => s.id)).toEqual([-1, -3]);
    expect(grouped.get(2)?.map((s) => s.id)).toEqual([-2]);
    expect(grouped.has(3)).toBe(false);
  });
});

describe('subagentRow', () => {
  it('is null without sub-agents', () => {
    expect(subagentRow(undefined)).toBeNull();
    expect(subagentRow([])).toBeNull();
  });

  it('shows count and labels, lists all in the title, targets the first', () => {
    const row = subagentRow([
      { id: -4, parentAgentId: 1, label: 'Judge TASK-3454' },
      { id: -5, parentAgentId: 1, label: 'Explore' },
    ]);
    expect(row).toEqual({
      text: '\u21b3 2: Judge TASK-3454, Explore',
      title: 'Judge TASK-3454\nExplore',
      firstId: -4,
    });
  });

  it('falls back to a generic name for an empty label', () => {
    expect(subagentRow([{ id: -1, parentAgentId: 1, label: ' ' }])?.text).toBe(
      '\u21b3 1: Sub-agent',
    );
  });
});
