/** A client lifetime gate; server actor/scope validation remains authoritative. */
export function assertWorkspaceCurrent(isCurrent?: () => boolean) {
  if (isCurrent && !isCurrent()) throw new Error("WORKSPACE_REQUEST_CANCELLED");
}

/** Check at dispatch, after asynchronous credential preparation, with no intervening await. */
export async function dispatchWorkspaceRequest<P, R>(
  prepare: () => Promise<P>,
  dispatch: (prepared: P) => R,
  isCurrent?: () => boolean,
): Promise<Awaited<R>> {
  assertWorkspaceCurrent(isCurrent);
  const prepared = await prepare();
  assertWorkspaceCurrent(isCurrent);
  return await dispatch(prepared);
}
