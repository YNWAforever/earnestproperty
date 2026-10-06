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
 * What the page's shared error banner shows after a poll's list read succeeds: the banner is
 * cleared only when it is the list's own earlier failure (`listError`), never an error another
 * read on the page put up.
 */
export function errorAfterBackgroundListSuccess(
  shown: string | null,
  listError: string | null,
): string | null {
  return shown !== null && shown === listError ? null : shown;
}

/**
 * The row an open detail panel shows: the fresh row while the data still holds it (so a
 * reanalysis shows at once), otherwise the row it last showed for the same selection, marked
 * `offBoard` because it may be stale. A background refresh that drops the selected row therefore
 * never closes the panel under the user; closing it or selecting another row lets the
 * remembered row go.
 */
export function rowForOpenPanel<T>(
  rows: readonly T[] | null | undefined,
  selectedId: string | null,
  lastShown: T | null,
  idOf: (row: T) => string,
): { row: T; offBoard: boolean } | null {
  if (selectedId === null) return null;
  const fresh = rows?.find((row) => idOf(row) === selectedId);
  if (fresh) return { row: fresh, offBoard: false };
  return lastShown !== null && idOf(lastShown) === selectedId
    ? { row: lastShown, offBoard: true }
    : null;
}

/**
 * The staff roles each polled read accepts: the same lists its server function passes to
 * `requireStaff` (`fetchAdminPageServer`, `fetchCommandCenterServer` in admin-data.ts). A poll
 * for any other role would only be refused, every minute.
 */
export const BACKGROUND_READ_ROLES = {
  inboxList: ["admin", "manager", "agent"],
  commandCenter: ["admin", "manager"],
} as const;

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Whether a read failed because the caller was refused (401 or 403): a `ServerFnResponseError`,
 * or any error carrying that status, as `isStaffAuthorizationError` in admin-data.ts classifies
 * it. Kept here, free of server-function imports, so this module stays pure.
 */
export function isAuthorizationRefusal(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

/**
 * Decides whether a page's poll may read in the background. It reads only for the roles the
 * read accepts (roles not known yet: no read), and once a background read is refused (401/403)
 * it stops until a user-started read on the page succeeds. Nothing here shows anything: the
 * page's own load and 重新整理 keep their existing error handling.
 */
export function createBackgroundReadGate(acceptedRoles: readonly string[]) {
  let refused = false;
  return {
    allows(roles: readonly string[] | null | undefined): boolean {
      return !refused && !!roles && roles.some((role) => acceptedRoles.includes(role));
    },
    backgroundFailed(error: unknown): void {
      if (isAuthorizationRefusal(error)) refused = true;
    },
    foregroundSucceeded(): void {
      refused = false;
    },
  };
}
