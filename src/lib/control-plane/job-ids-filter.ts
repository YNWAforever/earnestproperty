/**
 * FX-17a: the jobs list can be read by id, so an unknown-outcome retry can be read back even
 * when the job is old and the list filters hide it. Read-only; same permission as the list.
 */
export const MAX_JOB_ID_FILTER = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comma-separated UUIDs → a de-duplicated list, or null when the value is not a valid filter. */
export function parseJobIdsParam(value: string): string[] | null {
  const ids = [...new Set(value.split(",").map((part) => part.trim().toLowerCase()))];
  if (!ids.length || ids.length > MAX_JOB_ID_FILTER) return null;
  return ids.every((id) => UUID.test(id)) ? ids : null;
}
