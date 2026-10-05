/** Which list read a page is on: its request counter and, where it pages, its cursor. */
export type ReadSlot = { requestId: number; cursor: string | null };

/**
 * Whether a background (poll) read may apply its answer.
 *
 * A poll never takes the request slot: it does not bump the counter, so a user read
 * (重新整理, paging, a save's readback) keeps sole ownership of its loading flag. Bumping it
 * from outside once left a refresh unable to clear that flag and froze the inbox skeleton.
 * Instead the poll remembers the slot it started on and applies only if, when it answers, no
 * newer read has started, the user is still on the same page, and no user read is in flight.
 * Otherwise the answer is dropped and the next tick reads again.
 */
export function canApplyBackgroundRead(
  started: ReadSlot,
  current: ReadSlot & { userReadInFlight: boolean },
): boolean {
  return (
    !current.userReadInFlight &&
    current.requestId === started.requestId &&
    current.cursor === started.cursor
  );
}

/**
 * The row an open detail panel shows: the fresh row while the data still holds it (so a
 * reanalysis shows at once), otherwise the row it last showed for the same selection. A
 * background refresh that drops the selected row therefore never closes the panel under the
 * user; closing it or selecting another row is what lets the remembered row go.
 */
export function rowForOpenPanel<T>(
  rows: readonly T[] | null | undefined,
  selectedId: string | null,
  lastShown: T | null,
  idOf: (row: T) => string,
): T | null {
  if (selectedId === null) return null;
  const fresh = rows?.find((row) => idOf(row) === selectedId);
  if (fresh) return fresh;
  return lastShown !== null && idOf(lastShown) === selectedId ? lastShown : null;
}
