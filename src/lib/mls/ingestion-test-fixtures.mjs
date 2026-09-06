export const row = (id = "123", extra = {}) => ({
  property_id: id,
  source_url: `https://www.28hse.com/buy/example/property-${id}`,
  title: "Source title",
  estate: "Estate Phase 1",
  district: "Test",
  block: "Tower 2A",
  floor: "12/F",
  unit: "Flat 01",
  deal_type: "sale",
  price: 5380000,
  ...extra,
});
export function batch(rows = [row()], stamp = "2026-09-07T00:00:00.123456Z", source = "28hse") {
  const scopes = source === "28hse" ? ["sale", "rent"] : ["EPW", "EPS", "EPT"];
  return {
    source,
    branches: source === "28hse" ? [] : scopes,
    scraped_at: stamp,
    listings: rows,
    meta: {
      schema_version: "2.0",
      run_id: "fixture-run",
      scope_id: source === "28hse" ? "agent:540" : "branches:EPW,EPS,EPT",
      policy_version: "no-hermes-v2",
      parser_version: "fixture-v2",
      crawl_complete: true,
      pages_failed: 0,
      worker_rejected_count: 0,
      rejected_records: [],
      eligible_for_absence: true,
      completed_branches: source === "28hse" ? [] : scopes,
      pages: scopes.flatMap((scope) => {
        const ids = rows
          .filter((r) =>
            source === "28hse"
              ? r.deal_type === scope
              : (r.branch_memberships ?? [r.branch_code]).includes(scope),
          )
          .map((r) => r.property_id);
        return [
          ...(ids.length
            ? [{ scope, page: 1, status: "listings", ids, details_complete: true }]
            : []),
          { scope, page: ids.length ? 2 : 1, status: "terminal", ids: [], details_complete: true },
        ];
      }),
    },
  };
}
