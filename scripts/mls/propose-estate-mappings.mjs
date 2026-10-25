import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { resolveSavedEstate } from "../../src/lib/mls/saved-capture-estates.mjs";
export function buildEstateMappingProposal(capture, snapshot) {
  const mappings = [...new Set(capture.map((row) => row.estate).filter(Boolean))]
    .sort()
    .map((label) => {
      const rows = capture.filter((row) => row.estate === label);
      const resolutions = rows.map((row) =>
        resolveSavedEstate(
          row,
          { address: row.full_address ?? row.address },
          snapshot.estates,
          snapshot.districts,
        ),
      );
      const first = resolutions[0];
      const consistent = resolutions.every(
        (row) =>
          row.status === first.status &&
          row.estate_id === first.estate_id &&
          row.district_slug === first.district_slug,
      );
      return {
        captured_label: label,
        captured_records: rows.length,
        selected_records: rows.filter((row) => String(row.source_id) !== "4028435").length,
        ...first,
        ...(!consistent
          ? {
              status: "ambiguous",
              estate_id: null,
              slug: null,
              district_slug: null,
              reason: "captured_rows_disagree",
            }
          : {}),
        confidence: consistent && first.status === "matched" ? 1 : 0,
        approved: false,
        rows: rows.map((row, i) => ({ source_id: row.source_id, ...resolutions[i] })),
      };
    });
  return {
    review_only: true,
    auto_apply: false,
    stats: {
      labels: mappings.length,
      matched: mappings.filter((row) => row.status === "matched").length,
      ambiguous: mappings.filter((row) => row.status === "ambiguous").length,
      unmatched_left_null: mappings.filter((row) => row.status === "unmatched-left-null").length,
      district_unresolved_records: mappings
        .flatMap((row) => row.rows)
        .filter((row) => !row.district_slug).length,
    },
    mappings,
  };
}
export async function proposeEstateMappings({
  input = "/workspace/28hse_capture/import_ready.frozen.json",
  snapshot = "/workspace/28hse_capture/prod_estates_snapshot.json",
  output = resolve("docs/reports/28hse-estate-mapping-proposal.json"),
} = {}) {
  const bytes = await readFile(input),
    catalogBytes = await readFile(snapshot);
  const proposal = buildEstateMappingProposal(JSON.parse(bytes), JSON.parse(catalogBytes));
  proposal.input_sha256 = createHash("sha256").update(bytes).digest("hex");
  proposal.snapshot_sha256 = createHash("sha256").update(catalogBytes).digest("hex");
  proposal.evidence = snapshot;
  await writeFile(output, JSON.stringify(proposal, null, 2) + "\n");
  await writeFile(
    output.replace(/\.json$/, ".md"),
    [
      "# Estate resolution proposal — local saved production snapshot",
      "",
      `Input SHA-256: ${proposal.input_sha256}`,
      `Snapshot SHA-256: ${proposal.snapshot_sha256}`,
      "",
      JSON.stringify(proposal.stats),
      "",
      "Exact name/alias AND district only. No fuzzy/parent/phase guesses; unmatched labels keep estate_id NULL. Ambiguous matches and unresolved districts block apply. No estates or districts are created automatically. Target catalog is read again on preflight/apply; this snapshot is evidence, not write authority.",
      "",
      "| Captured label | Status | Estate slug | Estate UUID | District |",
      "|---|---|---|---|---|",
      ...proposal.mappings.map(
        (row) =>
          `| ${row.captured_label} | ${row.status} | ${row.slug ?? ""} | ${row.estate_id ?? "NULL"} | ${row.district_slug ?? "UNRESOLVED"} |`,
      ),
    ].join("\n") + "\n",
  );
  return proposal.stats;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i++) {
    if (!["--input", "--snapshot", "--output"].includes(args[i]) || !args[i + 1])
      throw Error("INVALID_PROPOSAL_ARGS");
    options[args[i].slice(2)] = resolve(args[++i]);
  }
  console.log(JSON.stringify(await proposeEstateMappings(options), null, 2));
}
