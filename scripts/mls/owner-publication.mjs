import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { readFrozenImportInput } from "./frozen-import-input.mjs";
import { createSavedImportClient } from "./saved-import-driver.mjs";
import {
  assertImportTarget,
  assertImportBlobTarget,
  buildSavedImportPlan,
} from "../../src/lib/mls/saved-capture-import.mjs";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import {
  inspectOwnerPublication,
  applyOwnerPublication,
  ownerReportItems,
  ownerDecision,
} from "../../src/lib/mls/owner-publication.mjs";
import { resolveSavedEstate } from "../../src/lib/mls/saved-capture-estates.mjs";
export function parseOwnerArgs(args) {
  const options = {
    input: "/workspace/28hse_capture/import_ready.frozen.json",
    report: "/workspace/28hse_capture/owner_publication_dry_run.md",
    driver: "pg",
    choices: {},
    apply: false,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (
      ["--input", "--report", "--offline-map", "--estate-snapshot"].includes(flag) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      options[flag.slice(2)] = resolve(args[++i]);
    else if (flag === "--apply" && !options.apply) options.apply = true;
    else if (flag.startsWith("--confirm-production=") && !options.confirmationHash)
      options.confirmationHash = flag.slice("--confirm-production=".length);
    else if (flag.startsWith("--driver=") && ["pg", "neon-ws"].includes(flag.slice(9)))
      options.driver = flag.slice(9);
    else if (flag === "--choose" && args[i + 1]) {
      const match = /^([A-Z][0-9]{6})=([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(
        args[++i],
      );
      if (!match || options.choices[match[1].toUpperCase()])
        throw Error("OWNER_INVALID_OR_DUPLICATE_CHOICE");
      options.choices[match[1].toUpperCase()] = match[2].toLowerCase();
    } else throw Error("OWNER_INVALID_ARGUMENTS");
  }
  if (options.apply && options["offline-map"]) throw Error("OWNER_OFFLINE_CANNOT_APPLY");
  if (options.input === options.report || options.input === options.report + ".json")
    throw Error("OWNER_REPORT_CANNOT_OVERWRITE_INPUT");
  return options;
}
export function parseSavedMap(csv) {
  const records = [];
  let row = [],
    cell = "",
    quoted = false;
  csv = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\n")) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (ch === "\n") {
        records.push(row);
        row = [];
      }
    } else cell += ch;
  }
  if (quoted) throw Error("OWNER_INVALID_SAVED_CSV");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    records.push(row);
  }
  const [header, ...data] = records;
  return data
    .filter((r) => r.some(Boolean))
    .map((values) => Object.fromEntries(header.map((k, i) => [k, values[i] ?? ""])));
}
function offlineItems(plan, map, catalog, options, inputSha256) {
  return plan.rows.map((row) => {
    const saved = map.find((r) => r.source_id === row.id && r.deal_type === row.deal);
    if (!saved) throw Error("OWNER_SAVED_MAP_MISSING_ROW");
    let candidates = [];
    if (saved.property_id)
      candidates = [
        {
          id: saved.property_id,
          listing_no: saved.listing_no,
          status: saved.status,
          public_listing_no: saved.public_listing_no,
          canonical_property_no: saved.canonical_property_no,
          price: saved.db_price || null,
          rent: saved.db_rent || null,
          images: Array(Number(saved.db_images)).fill("[saved photo URL unavailable]"),
          created_at: null,
        },
      ];
    else if (saved.category === "AMBIGUOUS")
      candidates = [
        ...saved.same_ref_candidates.matchAll(/([a-f0-9-]{36}) \[([^;]+); ([^;]+); imgs (\d+);/g),
      ].map((m) => ({
        id: m[1],
        status: m[2],
        listing_no: m[3],
        images: Array(Number(m[4])).fill("[saved photo URL unavailable]"),
        created_at: null,
        price: null,
        rent: null,
      }));
    const snapshot = {
      candidates,
      groups: [],
      overrides: [],
      fields: [],
      conflicts: [],
      reviews: [],
      links: [],
      audits: [],
    };
    const resolution = resolveSavedEstate(
      row.record,
      row.extras,
      catalog.estates,
      catalog.districts,
    );
    return {
      row,
      ...ownerDecision(row, snapshot, resolution, options.choices, inputSha256),
      saved_category: saved.category,
      reported_open_reviews: Number(saved.open_reviews || 0),
    };
  });
}
function markdown(report) {
  const lines = [
    "# Owner publication review",
    "",
    `Mode: **${report.mode}**`,
    `Input SHA-256: ${report.inputSha256}`,
    "",
    JSON.stringify(report.counts),
    "",
    report.mode === "OFFLINE SAVED MAP"
      ? "No database connected. Existing IDs/counts come from the saved CSV; review keys, candidate prices/created_at and photo URLs require the later READ ONLY target dry-run."
      : "Target dry-run verified READ ONLY; all inspections rolled back before any apply.",
    "",
    "| Source | Ref | Deal | Action | Target | Status before → after | Price/rent before → after | Photos before → after | Own reviews | Reason |",
    "|---|---|---|---|---|---|---|---|---|---:|---|",
  ];
  for (const item of report.items)
    lines.push(
      `| ${item.source_id} | ${item.ref} | ${item.deal} | ${item.action} | ${item.target_id ?? ""} | ${item.before?.status ?? "missing"} → ${item.after?.status ?? "unchanged"} | ${item.before?.[item.deal === "sale" ? "price" : "rent"] ?? "null"} → ${item.after?.[item.deal === "sale" ? "price" : "rent"] ?? "unchanged"} | ${item.before?.photo_count ?? 0} → ${item.after?.photo_count ?? "unchanged"} | ${item.reviews_resolved.length} | ${item.reason ?? ""} |`,
    );
  for (const item of report.items.filter((r) => r.candidates.length > 1))
    lines.push(
      "",
      `## Candidates: ${item.ref} (${item.deal})`,
      "",
      "```json",
      JSON.stringify(item.candidates, null, 2),
      "```",
    );
  lines.push(
    "",
    "Each eligible listing gets ALL validated captured photos (no six-photo cap). Normal shared media URL dedupe applies. Sold 4028435 is untouched. Matching is ref+deal, never raw ad ID. No raw ad-ID link/state is rebound. Unmatched estate stays NULL; approved unresolved districts 4044249/4062592 stay empty string. Existing manual overrides/conflicts remain blockers. Audit resolution is owner-publication; no admin overrides are created.",
    "",
    "The JSON companion contains complete per-field before/after values and exact review keys for target dry-runs. Apply is atomic per listing; failed post-upload checks can leave unattached Blob objects. A commit acknowledgement failure stops with unknown outcome; rerun dry-run before retry.",
  );
  if (report.result)
    lines.push("", "## Apply result", "", "```json", JSON.stringify(report.result, null, 2), "```");
  return lines.join("\n") + "\n";
}
export async function runOwnerPublication(args, { env = process.env, ports = {} } = {}) {
  const options = parseOwnerArgs(args),
    frozen = await readFrozenImportInput(options.input);
  // Authorize before client construction or media work. Offline mode can never apply.
  if (!options["offline-map"])
    assertImportTarget(env, {
      confirmationHash: options.confirmationHash,
      inputSha256: frozen.inputSha256,
    });
  const authorization = options.apply ? assertImportBlobTarget(env) : null;
  const raw = JSON.parse(frozen.bytes.toString("utf8"));
  const plan = await buildSavedImportPlan(raw, {
    captureRoot: dirname(options.input),
    capturedAt: frozen.capturedAt,
  });
  for (const row of plan.rows) {
    const date = raw.find((r) => String(r.source_id) === row.id)?.updated_date;
    row.ownerSourceDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : null;
  }
  for (const ref of Object.keys(options.choices))
    if (!plan.rows.some((row) => row.record.agency_property_no === ref))
      throw Error("OWNER_CHOICE_NOT_IN_CAPTURE");
  let client, items;
  const report = {
    mode: options["offline-map"]
      ? "OFFLINE SAVED MAP"
      : options.apply
        ? "APPLY"
        : "READ ONLY DRY-RUN",
    inputSha256: frozen.inputSha256,
    choices: options.choices,
  };
  const persist = async () => {
    await writeFile(options.report, markdown(report));
    await writeFile(options.report + ".json", JSON.stringify(report, null, 2) + "\n");
  };
  try {
    if (options["offline-map"]) {
      const catalog = JSON.parse(
        await readFile(
          options["estate-snapshot"] ?? "/workspace/28hse_capture/prod_estates_snapshot.json",
          "utf8",
        ),
      );
      items = offlineItems(
        plan,
        parseSavedMap(await readFile(options["offline-map"], "utf8")),
        catalog,
        options,
        frozen.inputSha256,
      );
    } else {
      client = await (ports.createClient ?? createSavedImportClient)(
        {
          connectionString: env.IMPORT_DATABASE_URL,
          connectionTimeoutMillis: 10000,
          query_timeout: 30000,
          statement_timeout: 30000,
        },
        options.driver,
      );
      await client.connect();
      items = await inspectOwnerPublication(client, plan, {
        choices: options.choices,
        inputSha256: frozen.inputSha256,
      });
    }
    report.items = ownerReportItems(items);
    report.counts = Object.fromEntries(
      ["create", "update", "held", "skip", "already-published"].map((action) => [
        action,
        items.filter((item) => item.action === action).length,
      ]),
    );
    await persist();
    if (options.apply) {
      const store = (ports.createBlobStore ?? createVercelBlobStore)({
        token: authorization.token,
      });
      const blobStore = {
        put: async (input) => {
          const blob = await store.put(input);
          if (new URL(blob.url).hostname !== authorization.host)
            throw Error("OWNER_BLOB_HOST_MISMATCH");
          return blob;
        },
      };
      report.result = await applyOwnerPublication(client, items, {
        choices: options.choices,
        inputSha256: frozen.inputSha256,
        blobStore,
        expectedHost: authorization.host,
        onProgress: async (result) => {
          report.result = result;
          await persist();
        },
      });
      await persist();
    }
    return report;
  } finally {
    await client?.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await runOwnerPublication(process.argv.slice(2));
    console.log(markdown(report));
    console.log(
      JSON.stringify(
        {
          mode: report.mode,
          inputSha256: report.inputSha256,
          counts: report.counts,
          result: report.result ?? null,
        },
        null,
        2,
      ),
    );
    if (report.counts.held || report.result?.held.length) process.exitCode = 2;
  } catch (error) {
    console.error(
      /^[A-Z0-9_]+$/.test(error.message) ? error.message : "OWNER_PUBLICATION_FAILED_SEE_REPORT",
    );
    process.exitCode = 1;
  }
}
