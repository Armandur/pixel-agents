import type { OfficeLayout } from '../types.js';

/**
 * Seats kept for one agent, by its session name (the CLI's own name, e.g.
 * "Dirigent"): `layout.seatOwners` maps a seat uid to that name. A reserved
 * seat is never handed to anyone else, and the named agent walks to it as
 * soon as its name is known. Keyed by seat (not chair) so one place on a
 * sofa can be kept without the whole sofa.
 */

export function seatOwners(layout: OfficeLayout): Map<string, string> {
  return new Map(Object.entries(layout.seatOwners ?? {}));
}

/** The seat kept for `name`, if any (the first, should there be several). */
export function seatOwnedBy(layout: OfficeLayout, name: string | undefined): string | null {
  if (!name) return null;
  for (const [seat, owner] of seatOwners(layout)) if (owner === name) return seat;
  return null;
}

/** Keep `seatUid` for `name`, or free it (null or blank name). */
export function setSeatOwner(
  layout: OfficeLayout,
  seatUid: string,
  name: string | null,
): OfficeLayout {
  const trimmed = name?.trim() || undefined;
  if (layout.seatOwners?.[seatUid] === trimmed) return layout;
  const owners = { ...(layout.seatOwners ?? {}) };
  if (trimmed) owners[seatUid] = trimmed;
  else delete owners[seatUid];
  const next: OfficeLayout = { ...layout, seatOwners: owners };
  if (Object.keys(owners).length === 0) delete next.seatOwners;
  return next;
}
