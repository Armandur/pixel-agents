/**
 * Pure formatting for the quota TV screens: percent, time to reset, colour
 * level, and the rows a screen shows. DOM-free so Node tests can cover it.
 */

import type { QuotaUpdate } from '../../../core/src/messages.js';
import {
  QUOTA_BAR_CELLS,
  QUOTA_BAR_EMPTY,
  QUOTA_BAR_RAMP,
  QUOTA_DANGER_PERCENT,
  QUOTA_TEXT_NO_5H,
  QUOTA_TEXT_UNKNOWN,
  QUOTA_WARN_PERCENT,
  QUOTA_WEEKDAYS,
} from '../constants.js';

export type QuotaLevel = 'ok' | 'warn' | 'danger' | 'unknown';

/** What the screens keep of a `quotaUpdate`. */
export type QuotaInfo = Pick<QuotaUpdate, 'windows' | 'capturedAt' | 'stale'>;

export interface QuotaRow {
  label: '5 h' | '7 d';
  /** "63 %", or the reason there is no number ("okänt", "5 h saknas"). */
  value: string;
  /** "om 2 h 14 min · 21:40"; empty when there is nothing to say. */
  reset: string;
  level: QuotaLevel;
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)} %`;
}

export function quotaLevel(percent: number): QuotaLevel {
  if (percent >= QUOTA_DANGER_PERCENT) return 'danger';
  if (percent >= QUOTA_WARN_PERCENT) return 'warn';
  return 'ok';
}

/** "om 2 h 14 min", "om 3 d 4 h", "om 5 min", "nu". Two units at most. */
export function formatRelative(secondsLeft: number): string {
  const minutes = Math.floor(secondsLeft / 60);
  if (minutes < 1) return 'nu';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `om ${days} d ${hours} h`;
  if (hours > 0) return `om ${hours} h ${minutes % 60} min`;
  return `om ${minutes} min`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local clock time ("21:40"), prefixed with the weekday ("tors 17:10") when
 *  the reset is not today. */
export function formatClock(resetsAtSec: number, nowSec: number): string {
  const at = new Date(resetsAtSec * 1000);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const now = new Date(nowSec * 1000);
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? clock : `${QUOTA_WEEKDAYS[at.getDay()]} ${clock}`;
}

export function formatReset(resetsAtSec: number, nowSec: number): string {
  return `${formatRelative(resetsAtSec - nowSec)} · ${formatClock(resetsAtSec, nowSec)}`;
}

const unknownRow = (label: QuotaRow['label']): QuotaRow => ({
  label,
  value: QUOTA_TEXT_UNKNOWN,
  reset: '',
  level: 'unknown',
});

/**
 * The two rows of a TV. No data -> both "okänt". Stale data still shows its
 * numbers: a quota only moves when the account is used, and every use writes
 * fresh numbers, so an old snapshot is right until its window resets (the
 * title says how old it is, see quotaTitle). A window the
 * plan lacks -> "5 h saknas" (only the 5 h row: every plan has a 7 d window).
 * A window whose reset time has passed describes a window that no longer
 * exists, so it reads "okänt" until the provider writes new numbers.
 */
export function quotaRows(info: QuotaInfo | undefined, nowSec: number): QuotaRow[] {
  if (!info) return [unknownRow('5 h'), unknownRow('7 d')];
  return (['5h', '7d'] as const).map((id): QuotaRow => {
    const label = id === '5h' ? '5 h' : '7 d';
    const w = info.windows.find((x) => x.id === id);
    if (!w) {
      return id === '5h'
        ? { label, value: QUOTA_TEXT_NO_5H, reset: '', level: 'unknown' }
        : unknownRow(label);
    }
    if (w.resetsAt <= nowSec) return unknownRow(label);
    return {
      label,
      value: formatPercent(w.usedPercent),
      reset: formatReset(w.resetsAt, nowSec),
      level: quotaLevel(w.usedPercent),
    };
  });
}

/** The screen's title, with when the numbers were taken once they are old
 *  ("Codex · 17:18"). */
export function quotaTitle(title: string, info: QuotaInfo | undefined, nowSec: number): string {
  if (!info?.stale) return title;
  return `${title} · ${formatClock(info.capturedAt, nowSec)}`;
}

/** One usage bar: how many cells are filled, each cell's ramp colour, and the
 *  full text for the hover title ("5 h 63 % · om 2 h 14 min · 21:40"). */
export interface QuotaBar {
  label: QuotaRow['label'];
  filled: number;
  cellColors: string[];
  title: string;
}

/** The two bars of a TV, from the same rows the text used: a missing or
 *  unknown window is an empty bar whose title says why. */
export function quotaBars(info: QuotaInfo | undefined, nowSec: number): QuotaBar[] {
  return quotaRows(info, nowSec).map((row) => {
    const w = info?.windows.find((x) => (x.id === '5h' ? '5 h' : '7 d') === row.label);
    const known = row.level !== 'unknown' && w !== undefined;
    const filled = known
      ? Math.min(
          QUOTA_BAR_CELLS,
          Math.max(w.usedPercent > 0 ? 1 : 0, Math.round((w.usedPercent / 100) * QUOTA_BAR_CELLS)),
        )
      : 0;
    const cellColors = Array.from({ length: QUOTA_BAR_CELLS }, (_, i) =>
      i < filled
        ? QUOTA_BAR_RAMP[Math.round((i * (QUOTA_BAR_RAMP.length - 1)) / (QUOTA_BAR_CELLS - 1))]
        : QUOTA_BAR_EMPTY,
    );
    return {
      label: row.label,
      filled,
      cellColors,
      title: [`${row.label} ${row.value}`, row.reset].filter(Boolean).join(' · '),
    };
  });
}

/** Panel width in CSS px (shrinks to fit a narrow office), edge margin and the
 *  height the placement reserves before the panel is measured. */
export const QUOTA_PANEL_WIDTH_PX = 260;
export const QUOTA_PANEL_MARGIN_PX = 8;
export const QUOTA_PANEL_HEIGHT_PX = 190;

/** "för 5 min sedan", "för 2 h sedan", "för 3 d sedan"; "nyss" under a minute. */
export function formatAge(secondsAgo: number): string {
  const minutes = Math.floor(Math.max(0, secondsAgo) / 60);
  if (minutes < 1) return 'nyss';
  if (minutes < 60) return `för ${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `för ${hours} h sedan`;
  return `för ${Math.floor(hours / 24)} d sedan`;
}

/** One window of the detail panel. `percent` is undefined when unknown. */
export interface QuotaPanelWindow {
  label: QuotaRow['label'];
  level: QuotaLevel;
  /** "63 %" or the reason there is no number. */
  value: string;
  percent?: number;
  /** "om 2 h 14 min" and "21:40" / "tors 17:10"; empty when unknown. */
  relative: string;
  clock: string;
  cellColors: string[];
}

export function quotaPanelWindows(info: QuotaInfo | undefined, nowSec: number): QuotaPanelWindow[] {
  const bars = quotaBars(info, nowSec);
  return quotaRows(info, nowSec).map((row, i) => {
    const w = info?.windows.find((x) => (x.id === '5h' ? '5 h' : '7 d') === row.label);
    const known = row.level !== 'unknown' && w !== undefined;
    return {
      label: row.label,
      level: row.level,
      value: row.value,
      percent: known ? w.usedPercent : undefined,
      relative: known ? formatRelative(w.resetsAt - nowSec) : '',
      clock: known ? formatClock(w.resetsAt, nowSec) : '',
      cellColors: bars[i].cellColors,
    };
  });
}

/** When the numbers were taken ("uppdaterad för 5 min sedan"); undefined with no data. */
export function quotaUpdatedText(info: QuotaInfo | undefined, nowSec: number): string | undefined {
  if (!info || !Number.isFinite(info.capturedAt)) return undefined;
  return `uppdaterad ${formatAge(nowSec - info.capturedAt)}`;
}

/** Top-left of a panel under (or, when it does not fit, over) an anchor box,
 *  kept inside the bounds with the margin on every side. */
export function placeQuotaPanel(
  anchor: { left: number; top: number; width: number; height: number },
  panel: { width: number; height: number },
  bounds: { width: number; height: number },
): { left: number; top: number } {
  const m = QUOTA_PANEL_MARGIN_PX;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const left = clamp(
    anchor.left + anchor.width / 2 - panel.width / 2,
    m,
    bounds.width - panel.width - m,
  );
  const below = anchor.top + anchor.height + m;
  const above = anchor.top - panel.height - m;
  const top = below + panel.height + m <= bounds.height || above < m ? below : above;
  return { left, top: clamp(top, m, bounds.height - panel.height - m) };
}
