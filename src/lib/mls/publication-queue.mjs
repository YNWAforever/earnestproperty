const timestamp = (value, fallback) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};
export function orderPublicationQueue(candidates) {
  return [...candidates].sort(
    (a, b) =>
      timestamp(a.property.last_media_attempt_at, -Infinity) -
        timestamp(b.property.last_media_attempt_at, -Infinity) ||
      timestamp(a.property.created_at, 0) - timestamp(b.property.created_at, 0) ||
      a.record.externalId.localeCompare(b.record.externalId) ||
      a.record.dealType.localeCompare(b.record.dealType),
  );
}
export function publicationBacklog(candidates, published) {
  const key = (x) => `${x.sourceId}:${x.dealType ?? ""}`;
  const done = new Set(published.map(key));
  const pending = candidates.filter((x) => !done.has(key(x.item)));
  const dates = pending
    .map((x) => timestamp(x.property.created_at, Infinity))
    .filter(Number.isFinite);
  return {
    eligibleBacklog: pending.length,
    oldestWaitingAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
  };
}
