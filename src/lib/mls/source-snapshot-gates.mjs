import { BRANCHES } from "./ingestion-contract.mjs";
export function evaluateSnapshotGate(batch, baseline, policy = {}) {
  const m = batch.meta,
    reasons = [];
  if (
    m.crawl_complete !== true ||
    m.pages_failed !== 0 ||
    !Number.isInteger(m.worker_rejected_count) ||
    m.worker_rejected_count < 0
  )
    reasons.push("incomplete_crawl");
  if (baseline && (!Number.isInteger(baseline.fullCount) || baseline.fullCount < 0))
    reasons.push("invalid_baseline");
  if (
    baseline?.fullReceiptId &&
    (baseline.source !== batch.source ||
      baseline.scopeId !== batch.scopeId ||
      baseline.policyVersion !== batch.policyVersion ||
      baseline.parserVersion !== batch.parserVersion ||
      baseline.applied !== true ||
      baseline.full !== true)
  )
    reasons.push("baseline_scope_mismatch");
  const scopes = batch.source === "propertyhk" ? BRANCHES : ["sale", "rent"];
  const cleanId = (id) => (batch.source === "28hse_agent_540" ? id.replace(/^#/, "") : id);
  const rejected = Array.isArray(m.rejected_records)
    ? m.rejected_records.map((r) =>
        r && typeof r.property_id === "string" ? { ...r, property_id: cleanId(r.property_id) } : r,
      )
    : (m.rejected_records ?? []);
  if (
    !Array.isArray(rejected) ||
    rejected.length !== m.worker_rejected_count ||
    rejected.some(
      (r) =>
        !r ||
        typeof r.property_id !== "string" ||
        typeof r.reason !== "string" ||
        !r.reason ||
        !scopes.includes(r.scope) ||
        !/^[A-Za-z0-9_:-]{1,100}$/.test(r.reason) ||
        /[\x00-\x20\x7f]/.test(r.property_id) ||
        r.property_id.length > 160,
    )
  )
    reasons.push("invalid_rejection_evidence");
  if (
    Array.isArray(rejected) &&
    new Set(rejected.map((r) => JSON.stringify([r?.scope, r?.property_id]))).size !==
      rejected.length
  )
    reasons.push("duplicate_rejection_evidence");
  const pages = m.pages;
  if (
    batch.source === "propertyhk" &&
    (!Array.isArray(m.completed_branches) ||
      scopes.some((s) => !m.completed_branches.includes(s)) ||
      m.completed_branches.length !== scopes.length)
  )
    reasons.push("missing_branch");
  if (!Array.isArray(pages) || !pages.length) reasons.push("missing_page_evidence");
  else if (
    pages.some(
      (p) =>
        !p ||
        typeof p !== "object" ||
        !Array.isArray(p.ids) ||
        p.ids.some((id) => typeof id !== "string" || !id),
    )
  ) {
    reasons.push("invalid_page_evidence");
  } else {
    const inputIds = new Set(
      batch.payload.listings
        .filter((r) => typeof r?.property_id === "string")
        .map((r) => cleanId(r.property_id)),
    );
    const missing = new Set(pages.flatMap((p) => p.ids).filter((id) => !inputIds.has(id)));
    if (
      [...missing].some(
        (id) => !Array.isArray(rejected) || !rejected.some((r) => r?.property_id === id),
      )
    )
      reasons.push("unaccounted_discovered_ids");
    if (
      pages.some(
        (p) =>
          !scopes.includes(p.scope) ||
          !["listings", "terminal"].includes(p.status) ||
          p.details_complete !== true ||
          !Array.isArray(p.ids),
      )
    )
      reasons.push("failed_page");
    for (const scope of scopes) {
      const scoped = pages.filter((p) => p.scope === scope).sort((a, b) => a.page - b.page);
      if (
        !scoped.length ||
        scoped.some((p, i) => p.page !== i + 1) ||
        scoped.at(-1)?.status !== "terminal" ||
        scoped.slice(0, -1).some((p) => p.status !== "listings")
      )
        reasons.push("pagination_incomplete");
      const sets = new Set();
      for (const p of scoped) {
        if (p.status === "terminal" && p.ids?.length) reasons.push("invalid_terminal");
        if (p.status === "listings") {
          const sig = JSON.stringify([...new Set(p.ids ?? [])].sort());
          if (!p.ids?.length || sets.has(sig)) reasons.push("pagination_loop");
          sets.add(sig);
        }
      }
      const declared = new Set(
        batch.payload.listings
          .filter((r) => {
            if (typeof r?.property_id !== "string") return false;
            if (batch.source === "propertyhk")
              return (
                (Array.isArray(r.branch_memberships)
                  ? r.branch_memberships
                  : [r.branch_code]
                ).includes(scope) ||
                (!BRANCHES.includes(r.branch_code) &&
                  scoped.some((p) => p.ids.includes(r.property_id)))
              );
            return (
              r.deal_type === scope ||
              (!["sale", "rent"].includes(r.deal_type) &&
                scoped.some((p) => p.ids.includes(cleanId(r.property_id))))
            );
          })
          .map((r) => cleanId(r.property_id)),
      );
      for (const rejection of Array.isArray(rejected) ? rejected : [])
        if (rejection?.scope === scope) declared.add(rejection.property_id);
      const actual = new Set(scoped.flatMap((p) => p.ids));
      if (
        [...actual].some((id) => !declared.has(id)) ||
        [...declared].some((id) => !actual.has(id))
      )
        reasons.push("scope_identity_accounting_mismatch");
      const discovered = new Set(scoped.flatMap((p) => (Array.isArray(p.ids) ? p.ids : [])));
      for (const r of batch.records.filter((r) =>
        batch.source === "propertyhk" ? r.branches.includes(scope) : r.dealType === scope,
      ))
        if (!discovered.has(cleanId(r.raw.property_id))) reasons.push("missing_record_evidence");
    }
  }
  if (batch.source === "propertyhk" && baseline) {
    for (const branch of BRANCHES) {
      const previousCount = baseline.branchCounts?.[branch];
      const count = new Set(
        batch.records.filter((r) => r.branches.includes(branch)).map((r) => r.advertisementId),
      ).size;
      if (!Number.isSafeInteger(previousCount) || previousCount < 0)
        reasons.push("branch_baseline_unverified");
      else if (count * 10 < previousCount * 7) reasons.push("branch_count_drop_" + branch);
    }
  }
  const previous = baseline?.fullCount;
  if (previous > 0 && batch.advertisementCount * 10 < previous * 7)
    reasons.push("count_drop_exceeds_30_percent");
  if (batch.advertisementCount === 0) reasons.push("zero_inventory_requires_review");
  if (batch.source === "propertyhk" && (batch.rejects.length || m.worker_rejected_count))
    reasons.push("incomplete_branch_details");
  const allowed = reasons.length === 0;
  const full = allowed && !batch.rejects.length && m.worker_rejected_count === 0;
  return {
    allowed,
    full,
    reasons: [...new Set(reasons)],
    inferAbsence:
      full &&
      policy.absenceEnabled === true &&
      m.eligible_for_absence === true &&
      Boolean(baseline?.fullReceiptId) &&
      batch.source === "28hse_agent_540",
  };
}
