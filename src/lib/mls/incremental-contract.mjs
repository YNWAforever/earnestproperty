const SCOPES = ["sale", "rent"];
const DIGEST = /^[a-f0-9]{64}$/;
const key = (entry) => JSON.stringify([entry?.property_id, entry?.deal_type]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
export function validIncrementalTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
const order = (value) =>
  value.slice(0, 19) + "." + (value.match(/\.(\d+)Z$/)?.[1] ?? "").padEnd(6, "0");
export function validIncrementalCapture(record, payload) {
  const stamp = record.captured_at;
  const start = payload.meta.incremental.index_started_at;
  const provider = record.raw_payload?.provider_provenance;
  return (
    validIncrementalTimestamp(stamp) &&
    order(stamp) >= order(start) &&
    order(stamp) <= order(payload.scraped_at) &&
    record.observation_kind !== "index_only" &&
    record.observation_kind !== "cached" &&
    (!provider ||
      (provider.fetchedAt === stamp &&
        provider.resolvedUrl === record.source_url &&
        DIGEST.test(provider.contentSha256 ?? "")))
  );
}
// Index membership is evidence of discovery only. It never supplies detail values,
// source lifecycle, canonical identity or permission to infer absence.
export function incrementalEnvelopeReasons(payload) {
  const m = payload.meta ?? {};
  const delta = m.incremental;
  const reasons = [];
  if (
    payload.source !== "28hse" ||
    m.parser_version !== "python-v2.2" ||
    !object(delta) ||
    delta.mode !== "index-delta-v1" ||
    Object.keys(delta).some(
      (field) =>
        ![
          "mode",
          "index_membership",
          "candidates",
          "index_started_at",
          "index_finished_at",
        ].includes(field),
    ) ||
    m.controlled_patch !== undefined ||
    m.eligible_for_absence !== false ||
    m.full_snapshot === true ||
    payload.full_snapshot === true
  )
    return ["invalid_incremental_envelope"];
  if (
    !validIncrementalTimestamp(delta.index_started_at) ||
    !validIncrementalTimestamp(delta.index_finished_at) ||
    !validIncrementalTimestamp(payload.scraped_at) ||
    order(delta.index_started_at) > order(delta.index_finished_at) ||
    order(delta.index_finished_at) > order(payload.scraped_at) ||
    Date.parse(payload.scraped_at) - Date.parse(delta.index_started_at) > 6 * 3600000
  )
    reasons.push("invalid_incremental_timing");
  const membership = delta.index_membership;
  const candidates = delta.candidates;
  const validMember = (entry) =>
    object(entry) &&
    typeof entry.property_id === "string" &&
    /^\d{1,160}$/.test(entry.property_id) &&
    SCOPES.includes(entry.deal_type) &&
    typeof entry.fingerprint === "string" &&
    DIGEST.test(entry.fingerprint);
  if (
    !Array.isArray(membership) ||
    membership.length > 10000 ||
    membership.some((entry) => !validMember(entry)) ||
    new Set(membership.map(key)).size !== membership.length
  )
    reasons.push("invalid_incremental_membership");
  if (
    !Array.isArray(candidates) ||
    candidates.length > 10000 ||
    candidates.some(
      (entry) => !validMember(entry) || !["new", "changed", "refresh"].includes(entry.reason),
    ) ||
    new Set(candidates.map(key)).size !== candidates.length
  )
    reasons.push("invalid_incremental_candidates");
  if (reasons.length) return reasons;
  const members = new Map(membership.map((entry) => [key(entry), entry.fingerprint]));
  if (candidates.some((entry) => members.get(key(entry)) !== entry.fingerprint))
    reasons.push("incremental_candidate_membership_mismatch");
  const detailKeys = payload.listings.map((entry) =>
    key({
      property_id:
        typeof entry?.property_id === "string" ? entry.property_id.replace(/^#/, "") : null,
      deal_type: entry?.deal_type,
    }),
  );
  const selected = new Set(candidates.map(key));
  if (
    detailKeys.length !== selected.size ||
    new Set(detailKeys).size !== detailKeys.length ||
    detailKeys.some((id) => !selected.has(id))
  )
    reasons.push("incremental_detail_candidate_mismatch");
  if (
    m.crawl_complete !== true ||
    m.pages_failed !== 0 ||
    m.worker_rejected_count !== 0 ||
    !Array.isArray(m.rejected_records) ||
    m.rejected_records.length !== 0
  )
    reasons.push("incomplete_incremental_crawl");
  const pages = m.pages;
  if (!Array.isArray(pages) || !pages.length || pages.length > 20000) {
    reasons.push("invalid_incremental_pages");
    return reasons;
  }
  if (
    pages.some(
      (page) =>
        !object(page) ||
        !SCOPES.includes(page.scope) ||
        !Number.isSafeInteger(page.page) ||
        page.page < 1 ||
        !["listings", "terminal"].includes(page.status) ||
        page.details_complete !== false ||
        !Array.isArray(page.ids) ||
        page.ids.some((id) => typeof id !== "string" || !/^\d{1,160}$/.test(id)) ||
        new Set(page.ids).size !== page.ids.length,
    )
  ) {
    reasons.push("invalid_incremental_pages");
    return reasons;
  }
  for (const scope of SCOPES) {
    const scoped = pages.filter((page) => page.scope === scope).sort((a, b) => a.page - b.page);
    if (
      !scoped.length ||
      scoped.some((page, i) => page.page !== i + 1) ||
      scoped.at(-1).status !== "terminal" ||
      scoped.at(-1).ids.length !== 0 ||
      scoped.slice(0, -1).some((page) => page.status !== "listings" || page.ids.length === 0)
    )
      reasons.push("incremental_pagination_incomplete");
    const pageSets = scoped
      .filter((page) => page.status === "listings")
      .map((page) => JSON.stringify([...page.ids].sort()));
    if (new Set(pageSets).size !== pageSets.length) reasons.push("incremental_pagination_loop");
    const ids = scoped.flatMap((page) => page.ids);
    const expected = membership
      .filter((entry) => entry.deal_type === scope)
      .map((entry) => entry.property_id);
    const actual = new Set(ids);
    if (actual.size !== expected.length || expected.some((id) => !actual.has(id)))
      reasons.push("incremental_index_accounting_mismatch");
  }
  return [...new Set(reasons)];
}
export function incrementalReceiptFields(batch) {
  if (!batch.incremental) return {};
  const delta = batch.meta.incremental;
  return {
    incremental: true,
    incremental_mode: delta.mode,
    scraped_at: batch.scrapedAt,
    index_started_at: delta.index_started_at,
    index_finished_at: delta.index_finished_at,
  };
}
export function incrementalCounts(batch) {
  if (!batch.incremental) return {};
  const delta = batch.meta.incremental;
  return {
    index_offer_count: delta.index_membership.length,
    index_advertisement_count: new Set(delta.index_membership.map((entry) => entry.property_id))
      .size,
    candidate_count: delta.candidates.length,
    fresh_detail_count: batch.records.length,
    unfetched_index_offer_count: delta.index_membership.length - delta.candidates.length,
  };
}
