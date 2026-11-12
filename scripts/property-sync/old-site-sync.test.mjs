import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_DELAY_MS,
  DEFAULT_MAX_DETAILS,
  DEFAULT_MAX_PAGES,
  DEFAULT_TIMEOUT_MS,
  MIN_DEACTIVATION_COVERAGE,
  SyncCliError,
  buildReplayFetchText,
  classifyPreflightHtml,
  computeCrossSourceDuplicates,
  computeDatabaseDelta,
  createReadOnlyDb,
  createThrottledFetchText,
  detectDatabaseFailure,
  detectPrerequisiteFailure,
  exitCodeFor,
  loadReplayIndex,
  parseArgs,
  readListingNoOwnership,
  readPropertyPairSnapshot,
  summarizeRun,
} from "./old-site-sync.mjs";

test("parseArgs defaults to a dry run with the documented limits", () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    help: false,
    skipAgents: false,
    skipEstateStats: false,
    allowLowCoverage: false,
    maxDetails: DEFAULT_MAX_DETAILS,
    maxPages: DEFAULT_MAX_PAGES,
    delayMs: DEFAULT_DELAY_MS,
    delayMsExplicit: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    reportDir: null,
    fromDir: null,
  });
});

test("parseArgs accepts --flag=value form", () => {
  const options = parseArgs([
    "--apply",
    "--max-details=500",
    "--max-pages=64",
    "--delay-ms=100",
    "--timeout-ms=5000",
    "--report-dir=out/report",
    "--from-dir=artifacts/old-site-replay",
    "--skip-agents",
    "--skip-estate-stats",
  ]);
  assert.equal(options.apply, true);
  assert.equal(options.maxDetails, 500);
  assert.equal(options.maxPages, 64);
  assert.equal(options.delayMs, 100);
  assert.equal(options.delayMsExplicit, true);
  assert.equal(options.timeoutMs, 5000);
  assert.equal(options.reportDir, "out/report");
  assert.equal(options.fromDir, "artifacts/old-site-replay");
  assert.equal(options.skipAgents, true);
  assert.equal(options.skipEstateStats, true);
});

test("parseArgs accepts the space-separated form used by the daily workflow", () => {
  const options = parseArgs(["--max-details", "2000", "--from-dir", "artifacts/replay"]);
  assert.equal(options.maxDetails, 2000);
  assert.equal(options.fromDir, "artifacts/replay");
});

test("parseArgs reads the OLD_SITE_* environment defaults", () => {
  const options = parseArgs([], {
    environment: { OLD_SITE_DELAY_MS: "120", OLD_SITE_TIMEOUT_MS: "8000" },
  });
  assert.equal(options.delayMs, 120);
  assert.equal(options.timeoutMs, 8000);
});

test("parseArgs rejects invalid values and unknown arguments", () => {
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument: --bogus/);
  assert.throws(() => parseArgs(["positional"]), /unknown argument: positional/);
  assert.throws(() => parseArgs(["--max-details=0"]), /integer >= 1/);
  assert.throws(() => parseArgs(["--max-details=abc"]), /integer >= 1/);
  assert.throws(() => parseArgs(["--delay-ms=-1"]), /integer >= 0/);
  assert.throws(() => parseArgs(["--from-dir"]), /--from-dir requires a value/);
  assert.throws(() => parseArgs(["--report-dir="]), /requires a value/);
  assert.throws(() => parseArgs([], { environment: { OLD_SITE_DELAY_MS: "soon" } }), />= 0/);
});

test("parseArgs recognises --help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("parseArgs recognises the one-off coverage override flag", () => {
  assert.equal(parseArgs(["--allow-low-coverage"]).allowLowCoverage, true);
  assert.equal(parseArgs(["--apply", "--allow-low-coverage"]).allowLowCoverage, true);
  assert.equal(parseArgs([]).allowLowCoverage, false);
});

test("buildReplayFetchText maps an absolute URL to the captured file", async () => {
  const reads = [];
  const readFileStub = async (file) => {
    reads.push(file);
    return "<html>captured</html>";
  };
  const index = { "https://www.earnestproperty.com.hk/property/": "files/list-1.html" };
  const fetchText = buildReplayFetchText(index, { rootDir: "replay", readFile: readFileStub });

  const html = await fetchText("https://www.earnestproperty.com.hk/property/");
  assert.equal(html, "<html>captured</html>");
  assert.deepEqual(reads, [path.resolve("replay", "files/list-1.html")]);
});

test("buildReplayFetchText tolerates a trailing slash mismatch", async () => {
  const reads = [];
  const fetchText = buildReplayFetchText(
    { "https://x.test/property": "list.html", "https://x.test/c1/": "c1.html" },
    {
      rootDir: "replay",
      readFile: async (file) => {
        reads.push(path.basename(file));
        return "ok";
      },
    },
  );
  await fetchText("https://x.test/property/");
  await fetchText("https://x.test/c1");
  assert.deepEqual(reads, ["list.html", "c1.html"]);
});

test("buildReplayFetchText keeps query strings exact", async () => {
  const reads = [];
  const fetchText = buildReplayFetchText(
    { "https://x.test/property/?page=2": "list-2.html" },
    {
      rootDir: "replay",
      readFile: async (file) => {
        reads.push(path.basename(file));
        return "ok";
      },
    },
  );
  await fetchText("https://x.test/property/?page=2");
  assert.deepEqual(reads, ["list-2.html"]);
});

test("buildReplayFetchText fails loudly on a URL missing from the capture", async () => {
  const fetchText = buildReplayFetchText(
    { "https://x.test/property/": "list.html" },
    { rootDir: "replay", readFile: async () => "ok" },
  );
  await assert.rejects(() => fetchText("https://x.test/other/"), { code: "replay_url_missing" });
});

test("buildReplayFetchText refuses an index entry that escapes the replay directory", async () => {
  const fetchText = buildReplayFetchText(
    { "https://x.test/property/": "../secret.html" },
    { rootDir: "replay", readFile: async () => "secret" },
  );
  await assert.rejects(() => fetchText("https://x.test/property/"), {
    code: "replay_path_escape",
  });
});

test("buildReplayFetchText wraps an unreadable capture file", async () => {
  const fetchText = buildReplayFetchText(
    { "https://x.test/property/": "missing.html" },
    {
      rootDir: "replay",
      readFile: async () => {
        throw new Error("ENOENT: no such file");
      },
    },
  );
  await assert.rejects(() => fetchText("https://x.test/property/"), {
    code: "replay_file_unreadable",
  });
});

test("buildReplayFetchText requires an index object", () => {
  assert.throws(() => buildReplayFetchText(null), /replay index object/);
  assert.throws(() => buildReplayFetchText([]), /replay index object/);
});

test("loadReplayIndex reads and validates index.json", async () => {
  const index = await loadReplayIndex("replay", {
    readFile: async () =>
      JSON.stringify({
        "https://x.test/property/": "files/list.html",
        "https://x.test/bad/": 42,
      }),
  });
  assert.deepEqual(index, { "https://x.test/property/": "files/list.html" });
});

test("loadReplayIndex rejects a missing, malformed or empty index", async () => {
  await assert.rejects(
    () =>
      loadReplayIndex("replay", {
        readFile: async () => {
          throw new Error("ENOENT");
        },
      }),
    /cannot read replay index/,
  );
  await assert.rejects(
    () => loadReplayIndex("replay", { readFile: async () => "{not json" }),
    /not valid JSON/,
  );
  await assert.rejects(
    () => loadReplayIndex("replay", { readFile: async () => "[]" }),
    /must be an object/,
  );
  await assert.rejects(
    () => loadReplayIndex("replay", { readFile: async () => "{}" }),
    /no URL -> file entries/,
  );
  await assert.rejects(() => loadReplayIndex(""), SyncCliError);
});

test("createThrottledFetchText delays only between requests", async () => {
  const sleeps = [];
  const calls = [];
  const throttled = createThrottledFetchText(
    async (url) => {
      calls.push(url);
      return `html:${url}`;
    },
    {
      delayMs: 25,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );

  assert.equal(await throttled("a"), "html:a");
  assert.deepEqual(sleeps, []);
  assert.equal(await throttled("b"), "html:b");
  assert.deepEqual(sleeps, [25]);
  assert.deepEqual(calls, ["a", "b"]);
});

test("createThrottledFetchText requires a fetch function", () => {
  assert.throws(() => createThrottledFetchText(null), /fetchText function/);
});

test("classifyPreflightHtml accepts a real listing index", () => {
  const html = `<a href="/property-detail/6709182.html">x</a><a href="/property-detail/6709183.html">y</a>`;
  assert.deepEqual(classifyPreflightHtml(html), {
    ok: true,
    kind: "listing_index",
    code: "ok",
    detailLinks: 2,
    message: "",
  });
});

test("classifyPreflightHtml flags a challenge page", () => {
  const result = classifyPreflightHtml("<html>Just a moment... Verify you are human</html>");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "challenge");
  assert.equal(result.code, "challenge_detected");
});

test("classifyPreflightHtml flags an empty response", () => {
  const result = classifyPreflightHtml("   ");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "challenge");
  assert.equal(result.code, "empty_response");
});

test("classifyPreflightHtml flags an unexpected template", () => {
  const result = classifyPreflightHtml("<html><body>Welcome</body></html>");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "unexpected_content");
  assert.equal(result.code, "unexpected_content");
});

test("detectPrerequisiteFailure classifies a wrapped TLS certificate error", () => {
  const cause = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
  const error = Object.assign(new Error("fetch failed"), { cause });
  const failure = detectPrerequisiteFailure(error);
  assert.equal(failure.kind, "tls_certificate");
  assert.equal(failure.code, "CERT_HAS_EXPIRED");
  assert.match(failure.actionable, /TLS certificate/);
});

test("detectPrerequisiteFailure classifies a hostname mismatch (.com.hk problem)", () => {
  const cause = Object.assign(new Error("Hostname/IP does not match certificate altnames"), {
    code: "ERR_TLS_CERT_ALTNAME_INVALID",
  });
  const failure = detectPrerequisiteFailure(Object.assign(new Error("fetch failed"), { cause }));
  assert.equal(failure.kind, "tls_certificate");
  assert.match(failure.message, /altnames/);
});

test("detectPrerequisiteFailure classifies a TLS message without an error code", () => {
  const failure = detectPrerequisiteFailure(new Error("self-signed certificate in chain"));
  assert.equal(failure.kind, "tls_certificate");
});

test("detectPrerequisiteFailure classifies DNS and connection failures as network", () => {
  const dns = detectPrerequisiteFailure(
    Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    }),
  );
  assert.equal(dns.kind, "network");
  assert.equal(dns.code, "ENOTFOUND");

  const connectTimeout = detectPrerequisiteFailure(
    Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    }),
  );
  assert.equal(connectTimeout.kind, "network");
});

test("detectPrerequisiteFailure distinguishes an HTTP failure from a network failure", () => {
  const failure = detectPrerequisiteFailure(
    Object.assign(new Error("fetch failed: 503"), { code: "fetch_failed", status: 503 }),
  );
  assert.equal(failure.kind, "http_status");
  assert.equal(failure.status, 503);
  assert.equal(failure.code, "http_503");

  const forbidden = detectPrerequisiteFailure(
    Object.assign(new Error("fetch failed: 403"), { code: "fetch_failed", status: 403 }),
  );
  assert.equal(forbidden.kind, "challenge");
});

test("detectPrerequisiteFailure classifies an explicit challenge and a timeout", () => {
  const challenge = detectPrerequisiteFailure(
    Object.assign(new Error("Source challenge detected"), { code: "challenge_detected" }),
  );
  assert.equal(challenge.kind, "challenge");

  const timeout = detectPrerequisiteFailure(
    Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
  );
  assert.equal(timeout.kind, "timeout");
});

test("detectPrerequisiteFailure returns null for an ordinary error", () => {
  assert.equal(detectPrerequisiteFailure(new Error("detail_error_budget_exceeded")), null);
  assert.equal(detectPrerequisiteFailure(null), null);
});

test("summarizeRun writes the documented summary contract", () => {
  const summary = summarizeRun({
    runId: "run-1",
    mode: "dry-run",
    startedAt: "2026-11-12T00:00:00.000Z",
    finishedAt: "2026-11-12T00:00:10.000Z",
    durationMs: 10_000,
    sourceOrigin: "https://www.earnestproperty.com.hk",
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    "agentReport",
    "canonicalMissing",
    "coverageOverride",
    "databaseDelta",
    "deactivated",
    "deactivationBlocked",
    "deactivationCoverage",
    "deactivationSkipped",
    "discovered",
    "durationMs",
    "errorBudgetExceeded",
    "errorRate",
    "errors",
    "estateResolved",
    "estateStatsReport",
    "estateUnresolved",
    "fetched",
    "finishedAt",
    "mode",
    "newlyInserted",
    "parsed",
    "runId",
    "skippedConflicts",
    "sourceOrigin",
    "startedAt",
    "upserted",
  ]);
  assert.equal(summary.newlyInserted, null);
  assert.equal(summary.databaseDelta, null);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.discovered, null);
  assert.equal(summary.reactivated, undefined);
});

test("summarizeRun maps the importer result and optional reactivated count", () => {
  const syncResult = {
    discovered: 636,
    fetched: 635,
    parsed: 700,
    upserted: 600,
    deactivated: 10,
    deactivationSkipped: false,
    deactivationBlocked: "DISCOVERY_COVERAGE_TOO_LOW",
    deactivationCoverage: 0.72,
    coverageOverride: true,
    skippedConflicts: 0,
    errorRate: 0.01,
    errorBudgetExceeded: false,
    canonicalMissing: 5,
    estateResolved: 400,
    estateUnresolved: 200,
    reactivated: 3,
    errors: [{ url: "https://detail/1", message: "boom" }, "raw error"],
  };
  const summary = summarizeRun({
    syncResult,
    agentReport: { matched: 1 },
    estateStatsReport: null,
  });
  assert.equal(summary.discovered, 636);
  assert.equal(summary.fetched, 635);
  assert.equal(summary.parsed, 700);
  assert.equal(summary.upserted, 600);
  assert.equal(summary.deactivated, 10);
  assert.equal(summary.deactivationSkipped, false);
  assert.equal(summary.deactivationBlocked, "DISCOVERY_COVERAGE_TOO_LOW");
  assert.equal(summary.deactivationCoverage, 0.72);
  assert.equal(summary.coverageOverride, true);
  assert.equal(summary.skippedConflicts, 0);
  assert.equal(summary.errorRate, 0.01);
  assert.equal(summary.errorBudgetExceeded, false);
  assert.equal(summary.canonicalMissing, 5);
  assert.equal(summary.estateResolved, 400);
  assert.equal(summary.estateUnresolved, 200);
  assert.equal(summary.reactivated, 3);
  assert.deepEqual(summary.errors, [
    { url: "https://detail/1", message: "boom" },
    { url: null, message: "raw error" },
  ]);
  assert.deepEqual(summary.agentReport, { matched: 1 });
});

test("summarizeRun appends the sync error and post-step failures", () => {
  const summary = summarizeRun({
    syncError: new Error("fetch_failed"),
    postStepErrors: [{ url: "post-step:agents", message: "no staff table" }],
  });
  assert.deepEqual(summary.errors, [
    { url: null, message: "fetch_failed" },
    { url: "post-step:agents", message: "no staff table" },
  ]);
});

test("detectDatabaseFailure classifies Neon connection and SQL errors", () => {
  const connection = new Error(
    "Error connecting to database: TypeError: Failed to parse URL from https://api.0.0.1/sql",
  );
  const failure = detectDatabaseFailure(connection);
  assert.equal(failure.kind, "database");
  assert.equal(failure.code, "database_unreachable");
  assert.match(failure.actionable, /DATABASE_URL_UNPOOLED/);

  const nested = new Error("sync failed", {
    cause: new Error('relation "properties" does not exist'),
  });
  assert.equal(detectDatabaseFailure(nested).kind, "database");
  assert.equal(detectDatabaseFailure(new Error("ordinary failure")), null);
  assert.equal(detectDatabaseFailure(null), null);
});

test("computeDatabaseDelta counts new, withdrawn and reactivated pairs", () => {
  const delta = computeDatabaseDelta({
    propertiesRows: [
      { legacy_detail_id: "1", deal_type: "sale", status: "active" },
      { legacy_detail_id: "2", deal_type: "sale", status: "active" },
      { legacy_detail_id: "3", deal_type: "rent", status: "inactive" },
      { legacy_detail_id: "4", deal_type: "sale", status: "sold" },
      { legacy_detail_id: "5", deal_type: "sale", status: "active" },
      { legacy_detail_id: null, deal_type: "sale", status: "active" },
      { legacy_detail_id: "6", deal_type: null, status: "active" },
    ],
    pairsSeen: [
      ["1", "sale"],
      ["3", "rent"],
      ["7", "sale"],
      ["1", "sale"],
    ],
    discoveredLegacyIds: ["1", "2", "3", "4", "5", "7"],
    protectedLegacyIds: ["5"],
  });

  assert.deepEqual(delta, {
    dbRows: 7,
    existingPairs: 5,
    existingActivePairs: 3,
    newPairs: 1,
    reactivatedPairs: 1,
    withdrawnPairs: 2,
    existingActiveSeenPairs: 1,
    writerOwnedSeenPairs: 0,
    seenPairs: 3,
    discoveredIds: 6,
    protectedIds: 1,
    activeLegacyIds: 3,
    seenActiveLegacyIds: 3,
    coveragePreview: 1,
    coverageWouldBlock: false,
  });
});

test("computeDatabaseDelta mirrors the neon coverage guard", () => {
  const activeRows = Array.from({ length: 4 }, (_, index) => ({
    legacy_detail_id: String(index + 1),
    deal_type: "sale",
    status: "active",
  }));
  const below = computeDatabaseDelta({
    propertiesRows: activeRows,
    pairsSeen: [["1", "sale"]],
    discoveredLegacyIds: ["1", "2"],
    protectedLegacyIds: [],
  });
  // 4 active legacy ids, 2 seen -> 0.5.
  assert.equal(below.activeLegacyIds, 4);
  assert.equal(below.seenActiveLegacyIds, 2);
  assert.equal(below.coveragePreview, 0.5);
  assert.equal(below.coverageWouldBlock, true);
  assert.equal(below.existingActiveSeenPairs, 1);

  // The guard is strictly `< MIN_DEACTIVATION_COVERAGE`: exactly 0.7 passes.
  const exactly = computeDatabaseDelta({
    propertiesRows: Array.from({ length: 10 }, (_, index) => ({
      legacy_detail_id: String(index + 1),
      deal_type: "sale",
      status: "active",
    })),
    pairsSeen: [],
    discoveredLegacyIds: Array.from({ length: 7 }, (_, index) => String(index + 1)),
  });
  assert.equal(exactly.coveragePreview, 0.7);
  assert.equal(exactly.coverageWouldBlock, false);
  assert.equal(MIN_DEACTIVATION_COVERAGE, 0.7);
});

test("computeDatabaseDelta leaves v2-owned rows to the v2 writer", () => {
  const delta = computeDatabaseDelta({
    propertiesRows: [
      // Seen + active + v2-owned: neither withdrawn nor updated by this writer.
      {
        legacy_detail_id: "1",
        deal_type: "sale",
        status: "active",
        ingestion_owner: "no-hermes-v2",
      },
      // Seen + inactive + v2-owned: not reported as a reactivation.
      {
        legacy_detail_id: "2",
        deal_type: "sale",
        status: "inactive",
        ingestion_owner: "no-hermes-v2",
      },
      // Unseen + active legacy: a real withdrawal.
      { legacy_detail_id: "3", deal_type: "sale", status: "active", ingestion_owner: "legacy" },
    ],
    pairsSeen: [
      ["1", "sale"],
      ["2", "sale"],
    ],
    discoveredLegacyIds: ["1", "2"],
  });
  assert.equal(delta.writerOwnedSeenPairs, 2);
  assert.equal(delta.withdrawnPairs, 1);
  assert.equal(delta.reactivatedPairs, 0);
  // Coverage still mirrors the DB guard, which counts every active row.
  assert.equal(delta.activeLegacyIds, 2);
  assert.equal(delta.seenActiveLegacyIds, 1);
  assert.equal(delta.coveragePreview, 0.5);
});

test("computeDatabaseDelta handles an empty inventory and empty input", () => {
  const noActive = computeDatabaseDelta({
    propertiesRows: [{ legacy_detail_id: "1", deal_type: "sale", status: "inactive" }],
    pairsSeen: [["1", "sale"]],
  });
  assert.equal(noActive.coveragePreview, 1);
  assert.equal(noActive.coverageWouldBlock, false);
  assert.equal(noActive.reactivatedPairs, 1);

  assert.deepEqual(computeDatabaseDelta(), {
    dbRows: 0,
    existingPairs: 0,
    existingActivePairs: 0,
    newPairs: 0,
    reactivatedPairs: 0,
    withdrawnPairs: 0,
    existingActiveSeenPairs: 0,
    writerOwnedSeenPairs: 0,
    seenPairs: 0,
    discoveredIds: 0,
    protectedIds: 0,
    activeLegacyIds: 0,
    seenActiveLegacyIds: 0,
    coveragePreview: 1,
    coverageWouldBlock: false,
  });
});

test("readPropertyPairSnapshot issues one read-only SELECT", async () => {
  const queries = [];
  const rows = [{ legacy_detail_id: "1", deal_type: "sale", status: "active" }];
  const sql = async (strings, ...values) => {
    queries.push({
      text: String.raw(strings, ...values.map((_, index) => `$${index + 1}`)),
      values,
    });
    return rows;
  };

  assert.deepEqual(await readPropertyPairSnapshot(sql), rows);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /SELECT legacy_detail_id, deal_type, status, ingestion_owner/);
  assert.doesNotMatch(queries[0].text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.deepEqual(queries[0].values, ["earnestproperty-old-site"]);
  await assert.rejects(() => readPropertyPairSnapshot(null), /tagged-template function/);
});

test("createReadOnlyDb exposes estate reads and blocks writes", async () => {
  const estateRows = [{ id: "estate-1", slug: "lido-garden" }];
  const db = createReadOnlyDb({
    listEstates: async () => estateRows,
    listEstateIdsBySlug: async () => new Map([["lido-garden", "estate-1"]]),
  });

  assert.deepEqual(await db.listEstates(), estateRows);
  assert.deepEqual([...(await db.listEstateIdsBySlug()).entries()], [["lido-garden", "estate-1"]]);
  await assert.rejects(() => db.upsertProperties([{}]), /dry_run_read_only/);
  await assert.rejects(() => db.deactivateMissing({}), /dry_run_read_only/);
  assert.throws(() => createReadOnlyDb(null), /MLS db adapter/);
});

test("summarizeRun carries the dry-run databaseDelta", () => {
  const databaseDelta = {
    newPairs: 1,
    withdrawnPairs: 2,
    reactivatedPairs: 3,
    coveragePreview: 0.9,
    coverageWouldBlock: false,
  };
  assert.deepEqual(summarizeRun({ databaseDelta }).databaseDelta, databaseDelta);
  assert.equal(summarizeRun({}).databaseDelta, null);
});

test("computeCrossSourceDuplicates reports rows owned by another writer", () => {
  const dryRunRows = [
    { listing_no: "C010229-6818486-R", canonical_property_no: "C010229", deal_type: "rent" },
    { listing_no: "OLD-2-2-S", canonical_property_no: "OLD", deal_type: "sale" },
    { listing_no: "OLD-3-3-S", canonical_property_no: "OLD", deal_type: "sale" },
  ];
  const ownershipRows = [
    { listing_no: "C010229-6818486-R", source_site: "propertyhk" },
    { listing_no: "OLD-2-2-S", source_site: "earnestproperty-old-site" },
    {
      listing_no: "OLD-3-3-S",
      source_site: "earnestproperty-old-site",
      ingestion_owner: "no-hermes-v2",
    },
  ];
  assert.deepEqual(computeCrossSourceDuplicates({ dryRunRows, ownershipRows }), [
    {
      listing_no: "C010229-6818486-R",
      canonical_property_no: "C010229",
      deal_type: "rent",
      existing_source_site: "propertyhk",
      existing_ingestion_owner: null,
    },
    {
      listing_no: "OLD-3-3-S",
      canonical_property_no: "OLD",
      deal_type: "sale",
      existing_source_site: "earnestproperty-old-site",
      existing_ingestion_owner: "no-hermes-v2",
    },
  ]);
  assert.equal(computeCrossSourceDuplicates({ dryRunRows, ownershipRows }).length, 2);
  assert.deepEqual(computeCrossSourceDuplicates({}), []);
});

test("readListingNoOwnership is SELECT-only and skips an empty row list", async () => {
  assert.deepEqual(await readListingNoOwnership(async () => [], []), []);
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ statement: strings.join("?"), values });
    return [{ listing_no: "A-1-S", source_site: "propertyhk" }];
  };
  const rows = await readListingNoOwnership(sql, ["A-1-S", "A-1-S", ""]);
  assert.deepEqual(rows, [{ listing_no: "A-1-S", source_site: "propertyhk" }]);
  assert.match(calls[0].statement, /SELECT listing_no, source_site/);
  assert.match(calls[0].statement, /WHERE listing_no = ANY/);
  assert.deepEqual(calls[0].values, [["A-1-S"]]);
});

test("exitCodeFor maps the documented exit-code contract", () => {
  assert.equal(exitCodeFor({ ok: true }), 0);
  assert.equal(exitCodeFor({ ok: false }), 1);
  assert.equal(exitCodeFor({}), 1);
  assert.equal(exitCodeFor(null), 1);
  assert.equal(exitCodeFor({ prerequisiteFailure: { kind: "tls_certificate" }, ok: false }), 2);
});
