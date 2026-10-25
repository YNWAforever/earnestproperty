import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";

const normalized = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/大廈|洋房|獨立屋/g, "")
    .replace(/[\s·‧()（）_-]/g, "");
export function buildEstateMappingProposal(capture, registry, live) {
  const labels = [...new Set(capture.map((row) => row.estate))].filter(Boolean).sort();
  const rows = labels.map((label) => {
    const norm = normalized(label);
    const ranked = registry
      .map((estate) => {
        const names = [estate.nameZh, estate.nameEn, ...(estate.aliases ?? [])].filter(Boolean);
        let confidence = 0,
          basis = "";
        for (const name of names) {
          const n = normalized(name);
          const score = norm === n ? 1 : n.length >= 2 && norm.startsWith(n) ? 0.85 : 0;
          if (score > confidence) {
            confidence = score;
            basis =
              score === 1
                ? "exact repository name/alias"
                : "repository parent-estate prefix; phase/building needs review";
          }
        }
        return { estate, confidence, basis };
      })
      .filter((entry) => entry.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence || a.estate.slug.localeCompare(b.estate.slug));
    const top = ranked[0];
    const ambiguous =
      top &&
      ranked.some(
        (entry) =>
          entry !== top &&
          entry.confidence === top.confidence &&
          entry.estate.slug !== top.estate.slug,
      );
    const snapshot = live.filter((row) => normalized(row.estate) === norm);
    const evidence = [],
      notes = [];
    let suggested_name = "",
      suggested_slug = "",
      suggested_district_slug = "",
      confidence = 0,
      match_basis = "unknown";
    if (top && !ambiguous) {
      suggested_name = top.estate.nameZh;
      suggested_slug = top.estate.slug;
      suggested_district_slug = top.estate.districtSlug ?? "";
      confidence = top.confidence;
      match_basis = top.basis;
      evidence.push("src/content/estate-registry.ts (repository aliases/identity)");
      if (top.estate.legacySlug)
        notes.push(
          `Historical DB slug ${top.estate.legacySlug}; verify current slug/UUID on target.`,
        );
      if (confidence < 1)
        notes.push(
          "Parent/phase suggestion only; confirm whether target stores this phase separately.",
        );
    } else if (ambiguous) {
      notes.push("Multiple repository candidates tie; no match chosen.");
    }
    if (snapshot.length) {
      evidence.push("/workspace/ep_site/live_listings.json (local saved snapshot; not fetched)");
      if (!top && !ambiguous) {
        suggested_name = snapshot[0].estate;
        confidence = 0.7;
        match_basis = "exact saved site label; DB slug/UUID unknown";
      }
      const districts = [...new Set(snapshot.map((row) => row.district_slug).filter(Boolean))];
      if (!suggested_district_slug && districts.length === 1 && !ambiguous)
        suggested_district_slug = districts[0];
      if (districts.length > 1)
        notes.push("Saved site rows disagree on district; verify estates table.");
    }
    const captured = capture.filter((row) => row.estate === label);
    return {
      captured_label: label,
      captured_records: captured.length,
      selected_records: captured.filter((row) => String(row.source_id) !== "4028435").length,
      suggested_name,
      suggested_slug,
      suggested_district_slug,
      estate_id: "",
      confidence,
      match_basis,
      approved: false,
      evidence,
      notes: [
        ...notes,
        "Estate UUID intentionally blank: property IDs in live_listings.json are NOT estate IDs. Verify via read-only target preflight.",
      ],
    };
  });
  return {
    review_only: true,
    auto_apply: false,
    stats: {
      labels: rows.length,
      high_confidence: rows.filter((row) => row.confidence >= 0.9).length,
      medium_confidence: rows.filter((row) => row.confidence > 0 && row.confidence < 0.9).length,
      unknown: rows.filter((row) => row.confidence === 0).length,
      blank_estate_ids: rows.filter((row) => !row.estate_id).length,
      approved: 0,
    },
    mappings: rows,
  };
}

export async function proposeEstateMappings({
  input = "/workspace/28hse_capture/import_ready.json",
  live = "/workspace/ep_site/live_listings.json",
  output = resolve("docs/reports/28hse-estate-mapping-proposal.json"),
} = {}) {
  const bytes = await readFile(input);
  const capture = JSON.parse(bytes.toString("utf8"));
  const registrySource = await readFile(
    new URL("../../src/content/estate-registry.ts", import.meta.url),
    "utf8",
  );
  const { code } = await transform(registrySource, { loader: "ts", format: "esm" });
  const { estateRegistry } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  let snapshot = [];
  try {
    snapshot = JSON.parse(await readFile(live, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const proposal = buildEstateMappingProposal(capture, estateRegistry, snapshot);
  proposal.input_sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, JSON.stringify(proposal, null, 2) + "\n");
  await writeFile(
    output.replace(/\.json$/, ".md"),
    [
      "# Estate mapping proposal — REVIEW ONLY",
      "",
      `Frozen input SHA-256: ${proposal.input_sha256}`,
      "",
      `Labels: ${proposal.stats.labels}; high confidence: ${proposal.stats.high_confidence}; medium: ${proposal.stats.medium_confidence}; unknown: ${proposal.stats.unknown}. All ${proposal.stats.blank_estate_ids} estate UUIDs remain blank; no mappings approved or applied.`,
      "",
      "Confidence describes a naming suggestion, not DB identity verification. All proposals require owner review against the target estates table. This generator performs no network/DB calls and is deterministic.",
      "",
      "| Captured label | Suggested name | Suggested slug | District | Confidence | Estate UUID |",
      "|---|---|---|---|---:|---|",
      ...proposal.mappings.map(
        (row) =>
          `| ${row.captured_label} | ${row.suggested_name} | ${row.suggested_slug} | ${row.suggested_district_slug} | ${row.confidence.toFixed(2)} | ${row.estate_id} |`,
      ),
    ].join("\n") + "\n",
  );
  return proposal.stats;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i++) {
    if (!["--input", "--live", "--output"].includes(args[i]) || !args[i + 1])
      throw Error("INVALID_PROPOSAL_ARGS");
    options[args[i].slice(2)] = resolve(args[++i]);
  }
  console.log(JSON.stringify(await proposeEstateMappings(options), null, 2));
}
