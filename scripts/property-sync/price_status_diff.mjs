import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildMatchKey } from "../../src/lib/mls/source-contract.mjs";
import { normalizeDecimal } from "../../src/lib/mls/ingestion-contract.mjs";

export function validate28Capture(capture) {
  const meta = capture?.meta;
  if (
    capture?.source !== "28hse" ||
    meta?.scope_id !== "agent:540" ||
    meta.parser_version !== "python-v2.2" ||
    meta.policy_version !== "no-hermes-v2" ||
    meta.crawl_complete !== true ||
    meta.pages_failed !== 0 ||
    meta.worker_rejected_count !== 0 ||
    meta.eligible_for_absence !== true ||
    !Array.isArray(capture.listings) ||
    !Array.isArray(meta.pages) ||
    meta.pages.some((p) => !p || !["sale", "rent"].includes(p.scope)) ||
    capture.listings.some(
      (r) => !r || !["sale", "rent"].includes(r.deal_type) || typeof r.property_id !== "string",
    )
  )
    throw Error("capture_not_complete");
  for (const scope of ["sale", "rent"]) {
    const pages = meta.pages?.filter((p) => p.scope === scope);
    if (
      !pages?.length ||
      pages.some(
        (p, i) =>
          p.page !== i + 1 ||
          p.details_complete !== true ||
          !Array.isArray(p.ids) ||
          (i === pages.length - 1
            ? p.status !== "terminal" || p.ids.length
            : p.status !== "listings" || !p.ids.length),
      )
    )
      throw Error("capture_not_complete");
    const observed = new Set(pages.flatMap((p) => p.ids));
    const listings = capture.listings.filter((r) => r.deal_type === scope);
    if (observed.size !== listings.length || listings.some((r) => !observed.has(r.property_id)))
      throw Error("capture_not_complete");
  }
}

export const digest = (value) => createHash("sha256").update(value).digest("hex");
const categories = [
  "price-changed",
  "rent-changed",
  "sold",
  "rented",
  "delisted",
  "unchanged",
  "override-held",
  "ambiguous-ref",
  "stale",
];
const stamp = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("invalid_timestamp");
  return Date.parse(value);
};
const key = (row) =>
  buildMatchKey(row.agency_property_no ?? row.canonical_property_no, row.deal_type);
const money = (value) => {
  if (value == null) return null;
  const normalized = normalizeDecimal(value);
  if (normalized == null) throw Error("invalid_amount");
  return normalized;
};

// Pure file-to-file report. No importer, DB driver, apply flag or baseline mutation.
export function diffPriceStatus(
  capture,
  current,
  { now = new Date().toISOString(), source = "28hse" } = {},
) {
  if (
    !["28hse", "propertyhk"].includes(source) ||
    !Array.isArray(capture.listings) ||
    !Array.isArray(current.properties)
  )
    throw Error("invalid_diff_input");
  const observedAt = stamp(capture.scraped_at),
    exportedAt = stamp(current.exported_at),
    clock = stamp(now);
  if (observedAt > clock || exportedAt > clock) throw Error("future_evidence");
  const globalStale = clock - observedAt > 36 * 3600000 || clock - exportedAt > 36 * 3600000;
  const candidates = new Map(),
    observations = new Map();
  for (const row of current.properties) {
    // Property.hk-only inventory may have no company number. Keep it held for
    // review without preventing valid numbered properties from being compared.
    const match = key(row) ?? `invalid:${digest(JSON.stringify(row))}`;
    if (
      !["sale", "rent"].includes(row.deal_type) ||
      !["active", "inactive", "offline", "draft", "sold", "rented"].includes(row.status) ||
      !Array.isArray(row.override_fields)
    )
      throw Error("invalid_export_row");
    money(row.price);
    money(row.rent);
    candidates.set(match, [...(candidates.get(match) ?? []), row]);
  }
  for (const row of capture.listings) {
    const match = key(row) ?? `invalid:${digest(JSON.stringify(row))}`;
    observations.set(match, [...(observations.get(match) ?? []), row]);
  }
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  const rows = [];
  const emit = (match, category, changes = [], reason = null, evidenceHash = null) => {
    counts[category]++;
    rows.push({
      ref_hash: digest(match),
      category,
      reason,
      evidence_hash: evidenceHash,
      would_change: changes,
    });
  };
  for (const match of [...new Set([...candidates.keys(), ...observations.keys()])].sort()) {
    const targets = candidates.get(match) ?? [],
      seen = observations.get(match) ?? [];
    // Absence may only be assessed against links belonging to this source.
    if (
      !seen.length &&
      !targets.some((p) => p.source === (source === "28hse" ? "28hse_agent_540" : source))
    )
      continue;
    if (
      globalStale ||
      seen.some((r) => clock - stamp(r.captured_at ?? capture.scraped_at) > 36 * 3600000)
    ) {
      emit(match, "stale", [], "evidence_older_than_36h");
      continue;
    }
    const row = seen[0],
      target = targets[0];
    const evidenceHash = row
      ? /^[a-f0-9]{64}$/.test(row.evidence_hash ?? "")
        ? row.evidence_hash
        : digest(JSON.stringify(row))
      : null;
    const conflictingLink =
      row &&
      current.properties.some(
        (p) =>
          p.source === (source === "28hse" ? "28hse_agent_540" : source) &&
          p.deal_type === row.deal_type &&
          p.source_ids?.includes(row.property_id) &&
          key(p) !== match,
      );
    if (
      targets.length !== 1 ||
      seen.length > 1 ||
      match.startsWith("invalid:") ||
      conflictingLink ||
      target?.review_required === true ||
      row?.identity_verified === false ||
      (source === "propertyhk" && row && !target?.source_ids?.includes(row.property_id))
    ) {
      emit(
        match,
        "ambiguous-ref",
        [],
        "company_number_or_source_link_requires_review",
        evidenceHash,
      );
      continue;
    }
    if (!row) {
      emit(match, "delisted", [], "absent_report_only", evidenceHash);
      continue;
    }
    if (stamp(row.captured_at ?? capture.scraped_at) > clock) throw Error("future_evidence");
    const reason = row.source_status_reason;
    if (
      !["active", "delisted"].includes(row.source_status) ||
      (reason != null && !["sold", "rented", "delisted"].includes(reason)) ||
      (row.source_status === "active" && reason != null)
    )
      throw Error("invalid_source_status");
    const changes = [];
    if (row.source_status === "delisted") {
      if (target.status !== "inactive")
        changes.push({ field: "status", old: target.status, new: "inactive" });
      const category = reason === "sold" ? "sold" : reason === "rented" ? "rented" : "delisted";
      const held = target.override_fields.includes("status");
      emit(
        match,
        held && changes.length ? "override-held" : category,
        held ? [] : changes,
        reason ?? "delisted",
        evidenceHash,
      );
      continue;
    }
    const field = row.deal_type === "sale" ? "price" : "rent";
    const next = money(row[field]),
      prior = money(target[field]);
    if (next != null && next !== prior) {
      if (target.override_fields.includes(field))
        emit(match, "override-held", [], `staff_${field}_override`, evidenceHash);
      else emit(match, `${field}-changed`, [{ field, old: prior, new: next }], null, evidenceHash);
    } else emit(match, "unchanged", [], null, evidenceHash);
  }
  return {
    schema: "price-status-dry-run/v1",
    source,
    matcher: "company-number-v1",
    production_writes: 0,
    absence_enabled: false,
    allowed_fields: ["price", "rent", "status"],
    stale: globalStale,
    counts,
    rows,
  };
}

export function markdownReport(report) {
  return [
    "# Price/status dry-run",
    "",
    `Source: ${report.source}; matcher: company-number-v1; production writes: 0; absence_enabled: false.`,
    "",
    "| Category | Count |",
    "| --- | ---: |",
    ...Object.entries(report.counts).map(([name, count]) => `| ${name} | ${count} |`),
    "",
    "Only price, rent and status can appear in would_change. Sold/rented/explicit delisting proposes inactive with a reason; absence has no proposed change.",
    "",
  ].join("\n");
}

export function parseArgs(args, required) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (
      !args[i]?.startsWith("--") ||
      !required.includes(name) ||
      options[name] ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("invalid_arguments");
    options[name] = args[i + 1];
  }
  if (required.some((name) => !options[name])) throw Error("missing_arguments");
  return options;
}
export async function saveReport(report, path) {
  await writeFile(path + ".json", JSON.stringify(report, null, 2) + "\n");
  await writeFile(path + ".md", markdownReport(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2), ["capture", "current", "out"]);
    const capture = JSON.parse(await readFile(args.capture, "utf8"));
    // Only selector-verified native complete requests are accepted by this entry point.
    validate28Capture(capture);
    await saveReport(
      diffPriceStatus(capture, JSON.parse(await readFile(args.current, "utf8"))),
      args.out,
    );
  } catch {
    console.error("price_status_diff_failed");
    process.exitCode = 2;
  }
}
