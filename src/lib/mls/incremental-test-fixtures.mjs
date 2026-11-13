import { batch, row } from "./ingestion-test-fixtures.mjs";
export const member = (id = "123", deal = "sale") => ({
  property_id: id,
  deal_type: deal,
  fingerprint: "a".repeat(64),
});
export function incrementalBatch({
  members = [member()],
  candidates = members.map((entry) => ({ ...entry, reason: "changed" })),
  listings = candidates.map((entry) =>
    row(entry.property_id, {
      deal_type: entry.deal_type,
      source_url: `https://www.28hse.com/${entry.deal_type === "sale" ? "buy" : "rent"}/example/property-${entry.property_id}`,
      captured_at: "2026-09-07T01:00:10.123456Z",
    }),
  ),
  stamp = "2026-09-07T01:01:00.123456Z",
} = {}) {
  const payload = batch(listings, stamp);
  Object.assign(payload.meta, {
    parser_version: "python-v2.2",
    eligible_for_absence: false,
    incremental: {
      mode: "index-delta-v1",
      index_started_at: "2026-09-07T01:00:00Z",
      index_finished_at: "2026-09-07T01:00:05Z",
      index_membership: members,
      candidates,
    },
    pages: ["sale", "rent"].flatMap((scope) => {
      const ids = members
        .filter((entry) => entry.deal_type === scope)
        .map((entry) => entry.property_id);
      return [
        ...(ids.length
          ? [{ scope, page: 1, status: "listings", ids, details_complete: false }]
          : []),
        { scope, page: ids.length ? 2 : 1, status: "terminal", ids: [], details_complete: false },
      ];
    }),
  });
  return payload;
}
