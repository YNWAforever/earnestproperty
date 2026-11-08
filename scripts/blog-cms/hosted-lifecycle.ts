/** Execution ordering only. Callback results never confer hosted evidence or authority. */
export async function withExactCleanup(
  run: () => Promise<void>,
  cleanup: () => Promise<void>,
  close: () => Promise<void>,
) {
  const failures: unknown[] = [];
  try {
    await run();
  } catch (error) {
    failures.push(error);
  }
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
  try {
    await close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, "HOSTED_RUN_OR_CLEANUP_FAILED");
}
