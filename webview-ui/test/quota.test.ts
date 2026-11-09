import { describe, expect, it } from 'vitest';

import { QUOTA_BAR_EMPTY, QUOTA_BAR_RAMP } from '../src/constants.js';
import {
  formatAge,
  formatClock,
  formatPercent,
  formatRelative,
  formatReset,
  placeQuotaPanel,
  quotaBars,
  type QuotaInfo,
  quotaLevel,
  quotaPanelWindows,
  quotaRows,
  quotaTitle,
  quotaUpdatedText,
} from '../src/office/quotaFormat.js';

/** Epoch seconds for a LOCAL date, so clock assertions hold in any timezone. */
const local = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime() / 1000;

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(63.4)).toBe('63 %');
    expect(formatPercent(63.5)).toBe('64 %');
    expect(formatPercent(0)).toBe('0 %');
    expect(formatPercent(100)).toBe('100 %');
  });
});

describe('quotaLevel', () => {
  it('is green below 60, yellow from 60, red from 85', () => {
    expect(quotaLevel(0)).toBe('ok');
    expect(quotaLevel(59.9)).toBe('ok');
    expect(quotaLevel(60)).toBe('warn');
    expect(quotaLevel(84.9)).toBe('warn');
    expect(quotaLevel(85)).toBe('danger');
    expect(quotaLevel(100)).toBe('danger');
  });
});

describe('formatRelative', () => {
  it('uses at most two units', () => {
    expect(formatRelative(5 * 60)).toBe('om 5 min');
    expect(formatRelative(2 * 3600 + 14 * 60 + 30)).toBe('om 2 h 14 min');
    expect(formatRelative(3 * 86400 + 4 * 3600 + 59 * 60)).toBe('om 3 d 4 h');
    expect(formatRelative(3600)).toBe('om 1 h 0 min');
  });

  it('says "nu" when under a minute or already past', () => {
    expect(formatRelative(59)).toBe('nu');
    expect(formatRelative(-30)).toBe('nu');
  });
});

describe('formatClock', () => {
  const now = local(2026, 11, 8, 12, 0); // a Sunday

  it('shows only the time for a reset today', () => {
    expect(formatClock(local(2026, 11, 8, 21, 40), now)).toBe('21:40');
    expect(formatClock(local(2026, 11, 8, 9, 5), now)).toBe('09:05');
  });

  it('prefixes the weekday for another day', () => {
    expect(formatClock(local(2026, 11, 12, 17, 10), now)).toBe('tors 17:10');
    expect(formatClock(local(2026, 11, 9, 0, 0), now)).toBe('mån 00:00');
  });

  it('combines relative time and clock', () => {
    expect(formatReset(local(2026, 11, 8, 14, 14), now)).toBe('om 2 h 14 min · 14:14');
  });
});

describe('quotaRows', () => {
  const now = local(2026, 11, 8, 12, 0);
  const info = (over: Partial<QuotaInfo> = {}): QuotaInfo => ({
    windows: [
      { id: '5h', usedPercent: 63, resetsAt: now + 2 * 3600 },
      { id: '7d', usedPercent: 20, resetsAt: now + 3 * 86400 },
    ],
    capturedAt: now - 10,
    ...over,
  });

  it('shows percent, reset text and level per window', () => {
    const [h5, d7] = quotaRows(info(), now);
    expect(h5).toMatchObject({ label: '5 h', value: '63 %', level: 'warn' });
    expect(h5.reset).toMatch(/^om 2 h 0 min · \d\d:\d\d$/);
    expect(d7).toMatchObject({ label: '7 d', value: '20 %', level: 'ok' });
    expect(d7.reset).toMatch(/^om 3 d 0 h · \S+ \d\d:\d\d$/);
  });

  it('says "5 h saknas" when the plan has only a 7 d window', () => {
    const rows = quotaRows(
      info({ windows: [{ id: '7d', usedPercent: 20, resetsAt: now + 99999 }] }),
      now,
    );
    expect(rows[0]).toEqual({ label: '5 h', value: 'saknas', reset: '', level: 'unknown' });
    expect(rows[1].value).toBe('20 %');
  });

  it('says "okänt" for no data', () => {
    const rows = quotaRows(undefined, now);
    expect(rows.map((r) => r.value)).toEqual(['okänt', 'okänt']);
    expect(rows.every((r) => r.level === 'unknown' && r.reset === '')).toBe(true);
  });

  it('keeps showing stale numbers (a quota only moves when used) and dates the title', () => {
    const stale = info({ stale: true, capturedAt: now - 7200 });
    expect(quotaRows(stale, now).map((r) => r.value)).toEqual(
      quotaRows(info({}), now).map((r) => r.value),
    );
    expect(quotaTitle('Codex', stale, now)).toBe(`Codex · ${formatClock(now - 7200, now)}`);
    expect(quotaTitle('Codex', info({}), now)).toBe('Codex');
  });

  it('says "okänt" for a window whose reset time has passed', () => {
    const rows = quotaRows(
      info({
        windows: [
          { id: '5h', usedPercent: 90, resetsAt: now - 1 },
          { id: '7d', usedPercent: 20, resetsAt: now + 86400 },
        ],
      }),
      now,
    );
    expect(rows[0].value).toBe('okänt');
    expect(rows[1].value).toBe('20 %');
  });
});

describe('quotaBars', () => {
  const now = 1_800_000_000;
  const info = (windows: QuotaInfo['windows']): QuotaInfo => ({ windows, capturedAt: now - 10 });

  it('fills cells by percent along the green → red ramp, keeping the rest empty', () => {
    const [five, seven] = quotaBars(
      info([
        { id: '5h', usedPercent: 35, resetsAt: now + 3600 },
        { id: '7d', usedPercent: 100, resetsAt: now + 86400 },
      ]),
      now,
    );
    expect(five.filled).toBe(4);
    expect(five.cellColors.slice(0, 4)).toEqual(
      QUOTA_BAR_RAMP.slice(0, 4).map((_, i) => QUOTA_BAR_RAMP[Math.round((i * 10) / 9)]),
    );
    expect(five.cellColors[4]).toBe(QUOTA_BAR_EMPTY);
    expect(seven.filled).toBe(10);
    expect(seven.cellColors[9]).toBe(QUOTA_BAR_RAMP[10]);
    expect(five.title).toContain('5 h 35 %');
  });

  it('a missing 5 h window is an empty bar whose title says so', () => {
    const [five] = quotaBars(info([{ id: '7d', usedPercent: 20, resetsAt: now + 86400 }]), now);
    expect(five.filled).toBe(0);
    expect(five.title).toBe('5 h saknas');
  });
});

describe('quota panel helpers', () => {
  const now = local(2026, 11, 9, 19, 26);
  const info: QuotaInfo = {
    windows: [
      { id: '5h', usedPercent: 63, resetsAt: now + 2 * 3600 + 14 * 60 },
      { id: '7d', usedPercent: 10, resetsAt: now - 5 },
    ],
    capturedAt: now - 300,
    stale: false,
  };

  it('formatAge reads minutes, hours, days and nyss', () => {
    expect(formatAge(20)).toBe('nyss');
    expect(formatAge(300)).toBe('för 5 min sedan');
    expect(formatAge(2 * 3600 + 60)).toBe('för 2 h sedan');
    expect(formatAge(3 * 86400)).toBe('för 3 d sedan');
  });

  it('quotaPanelWindows splits relative and clock, expired window is unknown', () => {
    const [h5, d7] = quotaPanelWindows(info, now);
    expect(h5).toMatchObject({
      value: '63 %',
      percent: 63,
      relative: 'om 2 h 14 min',
      clock: '21:40',
    });
    expect(d7).toMatchObject({ level: 'unknown', relative: '', clock: '' });
    expect(d7.percent).toBeUndefined();
  });

  it('quotaUpdatedText is undefined without data', () => {
    expect(quotaUpdatedText(undefined, now)).toBeUndefined();
    expect(quotaUpdatedText(info, now)).toBe('uppdaterad för 5 min sedan');
  });

  it('placeQuotaPanel centres under the anchor and clamps to the bounds (390 px)', () => {
    const panel = { width: 260, height: 190 };
    const bounds = { width: 390, height: 600 };
    const mid = placeQuotaPanel({ left: 150, top: 100, width: 40, height: 12 }, panel, bounds);
    expect(mid).toEqual({ left: 40, top: 120 });
    const edge = placeQuotaPanel({ left: 370, top: 100, width: 40, height: 12 }, panel, bounds);
    expect(edge.left).toBe(390 - 260 - 8);
    const low = placeQuotaPanel({ left: 0, top: 560, width: 40, height: 12 }, panel, bounds);
    expect(low.left).toBe(8);
    expect(low.top).toBe(560 - 190 - 8);
  });
});
