import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { hashPayload, decodeSnapshot } from "../../src/lib/mls/ingestion-contract.mjs";
import { readSyncAuthority, verifyAuthorityPayload } from "../mls/read-sync-authority.mjs";
import { HSE_PUBLICATION_SOURCE } from "../../src/lib/mls/publication-source-policy.mjs";
import { verifyDailyTarget } from "../mls/verify-daily-target.mjs";

const BUNDLE = /^incremental-bundle-([0-9]+)-([0-9]+)\.tar\.gz$/;
const MARKER = /^incremental-accepted-([0-9]+)-([0-9]+)\.json$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
const script = (name) => resolve("scripts/property-sync", name);
const python = () =>
  process.env.PROPERTY_SYNC_PYTHON ||
  (existsSync("scripts/property-sync/.venv/Scripts/python.exe")
    ? resolve("scripts/property-sync/.venv/Scripts/python.exe")
    : "python");

export function normalizeIncrementalPayload(original) {
  const payload = structuredClone(original);
  const delta = payload.meta?.incremental;
  if (
    delta?.mode !== "index-delta-v1" ||
    delta.index_complete !== true ||
    payload.meta.crawl_complete !== true ||
    delta.pending_candidates?.length
  )
    throw Error("INCREMENTAL_COLLECTION_INCOMPLETE");
  const chosen = delta.selected_candidates;
  if (!Array.isArray(chosen) || chosen.some((row) => row.status !== "fetched"))
    throw Error("INCREMENTAL_CANDIDATES_INCOMPLETE");
  const reason = (row) =>
    row.reasons.includes("new") ? "new" : row.reasons.includes("changed") ? "changed" : "refresh";
  const start = delta.index_started_at ?? delta.index_seen_at;
  payload.meta.incremental = {
    mode: "index-delta-v1",
    index_membership: delta.index_membership.map((row) => ({
      property_id: row.property_id,
      deal_type: row.deal_type,
      fingerprint: row.index_fingerprint,
    })),
    candidates: chosen.map((row) => ({
      property_id: row.property_id,
      deal_type: row.deal_type,
      fingerprint: row.index_fingerprint,
      reason: reason(row),
    })),
    index_started_at: start,
    index_finished_at: delta.index_finished_at ?? delta.index_seen_at,
  };
  for (const row of payload.listings) {
    row.captured_at = row.detail_fetched_at;
  }
  const decoded = decodeSnapshot(payload, { incremental: true });
  if (decoded.rejects.length || decoded.duplicates) throw Error("INCREMENTAL_DETAIL_REJECTED");
  return payload;
}

export function publicationRetryPairs(report) {
  return (report?.held ?? [])
    .filter((row) => row.reason === "daily_publication_limit")
    .map((row) => ({ property_id: row.sourceId, deal_type: row.dealType }));
}
export function cacheWithPublicationRetries(cache, pairs) {
  if (!Array.isArray(pairs) || pairs.length > 10000) throw Error("INVALID_PUBLICATION_RETRY_PAIRS");
  const next = structuredClone(cache);
  for (const row of pairs) {
    if (!/^[0-9]+$/.test(row?.property_id ?? "") || !["sale", "rent"].includes(row.deal_type))
      throw Error("INVALID_PUBLICATION_RETRY_PAIRS");
    const key = `28hse:agent:540:${row.deal_type}:${row.property_id}`;
    if (next.entries[key]) next.entries[key].pending_retry = true;
  }
  return next;
}

export function acceptedMarkers(assets) {
  return assets
    .filter((asset) => MARKER.test(asset.name))
    .sort(
      (a, b) =>
        String(b.createdAt ?? b.created_at ?? "").localeCompare(
          String(a.createdAt ?? a.created_at ?? ""),
        ) || b.name.localeCompare(a.name, "en", { numeric: true }),
    );
}

export function validateAcceptance(marker, authority) {
  if (
    marker?.kind !== "28hse-incremental-accepted-v1" ||
    !BUNDLE.test(marker.bundle_asset ?? "") ||
    !/^[a-f0-9]{64}$/.test(marker.bundle_sha256 ?? "") ||
    marker.receipt_id !== authority.incremental_receipt_id ||
    marker.full_receipt_id !== authority.receipt_id ||
    marker.scraped_at !== authority.last_incremental_scraped_at
  )
    throw Error("INCREMENTAL_CACHE_AUTHORITY_MISMATCH");
}

export function runProcess(file, args, { env = process.env, cwd = process.cwd() } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [],
      errors = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) child.kill();
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (errors.length < 30) errors.push(chunk);
    });
    child.on("error", () => fail(Error("INCREMENTAL_PROCESS_START_FAILED")));
    child.on("exit", (code) => {
      const stdout = Buffer.concat(output).toString("utf8");
      if (code === 0 && size <= 20 * 1024 * 1024) return done(stdout);
      // The bridge emits sanitized typed errors. Preserve uncertainty without logging
      // arbitrary child stderr, private HTML, paths, tokens or command arguments.
      for (const line of [
        ...stdout.split("\n"),
        ...Buffer.concat(errors).toString("utf8").split("\n"),
      ].reverse()) {
        try {
          const result = JSON.parse(line);
          if (
            result.success === false &&
            /^[A-Za-z0-9_]{1,100}$/.test(result.error ?? "") &&
            Number.isInteger(result.status) &&
            result.status >= 400 &&
            result.status <= 599
          ) {
            const error = Error(result.error);
            error.code = result.error;
            error.status = result.status;
            return fail(error);
          }
        } catch {
          /* Non-protocol diagnostics remain private. */
        }
      }
      fail(Error("INCREMENTAL_PROCESS_FAILED"));
    });
  });
}

function evidenceRepo() {
  const repo = process.env.GH_REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? ""))
    throw Error("PRIVATE_EVIDENCE_REPO_REQUIRED");
  return repo;
}
async function gh(args) {
  return runProcess("gh", args);
}
async function download(name, directory) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name)) throw Error("INVALID_EVIDENCE_ASSET");
  await mkdir(directory, { recursive: true });
  await gh([
    "release",
    "download",
    "property-sync-evidence",
    "--repo",
    evidenceRepo(),
    "--pattern",
    name,
    "--dir",
    directory,
  ]);
  return join(directory, name);
}
async function upload(path) {
  await gh(["release", "upload", "property-sync-evidence", path, "--repo", evidenceRepo()]);
}
export function requestAssetForBundle(asset) {
  const match = /^incremental-bundle-([0-9]+)-([1-9][0-9]*)\.tar\.gz$/.exec(asset ?? "");
  if (!match) throw Error("INVALID_INCREMENTAL_BUNDLE_ASSET");
  return `request-${match[1]}-${match[2]}.json`;
}
async function pinRequestAlias(root, prepared, assets) {
  const name = requestAssetForBundle(prepared.bundle_asset);
  const body = await readFile(join(root, "bundle/request.json"));
  const path = join(root, name);
  await writeFile(path, body);
  if (!assets.some((entry) => entry.name === name)) await upload(path);
  const readback = await download(name, join(root, "request-alias-readback"));
  if (sha256(body) !== sha256(await readFile(readback)))
    throw Error("INCREMENTAL_REQUEST_ALIAS_MISMATCH");
  return { ...prepared, request_asset: name };
}
async function checkPrivateEvidence() {
  const repo = JSON.parse(await gh(["api", `repos/${evidenceRepo()}`]));
  if (repo.private !== true) throw Error("EVIDENCE_REPOSITORY_MUST_BE_PRIVATE");
  return JSON.parse(
    await gh([
      "release",
      "view",
      "property-sync-evidence",
      "--repo",
      evidenceRepo(),
      "--json",
      "assets",
    ]),
  ).assets;
}
async function py(args) {
  return runProcess(python(), args);
}
async function unpackBundle(archive, directory) {
  await py([
    script("incremental_evidence.py"),
    "unpack",
    "--archive",
    archive,
    "--directory",
    directory,
  ]);
}
async function verifyBundle(directory) {
  await py([script("incremental_evidence.py"), "verify", "--directory", directory]);
}
function nativeContext() {
  const id = process.env.GITHUB_RUN_ID,
    attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (
    !/^[0-9]+$/.test(id ?? "") ||
    !/^[1-9][0-9]*$/.test(attempt ?? "") ||
    !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "") ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.PROPERTY_SYNC_EXPECTED_BRANCH !== "main"
  )
    throw Error("UNAPPROVED_INCREMENTAL_CONTEXT");
  return { id, attempt, gitSha: process.env.GITHUB_SHA };
}
async function readReceipt(id, payload) {
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const clause = payload ? "scraped_at=$1::timestamptz AND payload_hash=$2" : "id=$1";
    const params = payload
      ? [payload.scraped_at, hashPayload(payload), HSE_PUBLICATION_SOURCE.source]
      : [id, HSE_PUBLICATION_SOURCE.source];
    const row = (
      await client.query(
        `SELECT id,payload_hash,response,full_snapshot FROM mls_ingestion_receipts WHERE ${clause}
        AND source=$${params.length} AND scope_id='agent:540' AND policy_version='no-hermes-v2'
        AND parser_version='python-v2.2'`,
        params,
      )
    ).rows[0];
    await client.query("COMMIT");
    if (!row) throw Error("INCREMENTAL_RECEIPT_NOT_FOUND");
    return row;
  } finally {
    await client.end();
  }
}

export async function prepare(root, replayAsset) {
  nativeContext();
  const assets = await checkPrivateEvidence();
  const authority = await readSyncAuthority();
  await save(join(root, "authority.json"), authority);
  if (replayAsset) {
    if (!BUNDLE.test(replayAsset)) throw Error("INVALID_INCREMENTAL_REPLAY_ASSET");
    const archive = await download(replayAsset, join(root, "download"));
    await unpackBundle(archive, join(root, "bundle"));
    decodeSnapshot(await json(join(root, "bundle/request.json")), { incremental: true });
    const prepared = await pinRequestAlias(
      root,
      { replay: true, bundle_asset: replayAsset, archive },
      assets,
    );
    await save(join(root, "prepared.json"), prepared);
    return;
  }
  const incrementalIsCurrent =
    authority.incremental_receipt_id &&
    authority.last_incremental_scraped_at >= (authority.scraped_at ?? "");
  if (incrementalIsCurrent) {
    let accepted;
    for (const asset of acceptedMarkers(assets).slice(0, 60)) {
      const path = await download(asset.name, join(root, "markers"));
      const marker = await json(path);
      if (marker.receipt_id === authority.incremental_receipt_id) {
        accepted = marker;
        break;
      }
    }
    if (!accepted) throw Error("INCREMENTAL_CACHE_RECOVERY_REQUIRED");
    validateAcceptance(accepted, authority);
    const archive = await download(accepted.bundle_asset, join(root, "cache-download"));
    if (sha256(await readFile(archive)) !== accepted.bundle_sha256)
      throw Error("INCREMENTAL_CACHE_HASH_MISMATCH");
    await unpackBundle(archive, join(root, "accepted"));
    const request = await json(join(root, "accepted/request.json"));
    const receipt = await readReceipt(accepted.receipt_id);
    if (
      receipt.payload_hash !== hashPayload(request) ||
      receipt.full_snapshot ||
      receipt.response?.incremental !== true ||
      receipt.response?.success !== true
    )
      throw Error("INCREMENTAL_CACHE_AUTHORITY_MISMATCH");
    let cachePath = join(root, "accepted/cache-next.json");
    if (accepted.publication_retry_pairs?.length) {
      const cache = cacheWithPublicationRetries(
        await json(cachePath),
        accepted.publication_retry_pairs,
      );
      cachePath = join(root, "cache-with-retries.json");
      await save(cachePath, cache);
    }
    await save(join(root, "prepared.json"), { replay: false, cache: cachePath });
    return;
  }
  if (!authority.receipt_id) throw Error("VERIFIED_FULL_BASELINE_REQUIRED");
  const assetsPath = join(root, "release-assets.json");
  await save(assetsPath, { assets });
  // Reuse the established chronology, including approved operator baseline archives.
  const asset = (
    await py([script("daily_artifacts.py"), "latest", "--request", assetsPath])
  ).trim();
  if (!asset) throw Error("VERIFIED_FULL_BASELINE_REQUIRED");
  const baselineArchive = await download(asset, join(root, "bootstrap-download"));
  await py([
    script("daily_artifacts.py"),
    "unpack",
    "--request",
    baselineArchive,
    "--destination",
    join(root, "bootstrap"),
  ]);
  const baselinePath = join(root, "bootstrap/baseline/request.json");
  const receipt = await json(join(root, "bootstrap/baseline/receipt.json"));
  const payload = await json(baselinePath);
  verifyAuthorityPayload(authority, payload, receipt);
  // A replay's accepted archive uses the applying run ID, while its raw handoff
  // retains the original collecting run. Bind by exact request bytes, not names.
  const expectedHash = sha256(await readFile(baselinePath));
  const handoffRoot = join(root, "bootstrap-handoff");
  const handoffs = assets
    .filter((entry) => /^handoff-[A-Za-z0-9._-]+\.json$/.test(entry.name))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  let manifest, manifestPath;
  for (const entry of handoffs.slice(0, 100)) {
    const path = await download(entry.name, handoffRoot);
    if ((await readFile(path)).length > 64 * 1024) throw Error("BOOTSTRAP_MANIFEST_TOO_LARGE");
    const candidate = await json(path);
    if (
      candidate.request?.sha256 === expectedHash &&
      candidate.runId === payload.meta.run_id &&
      candidate.source === "28hse" &&
      candidate.scopeId === "agent:540"
    ) {
      manifest = candidate;
      manifestPath = path;
      break;
    }
  }
  if (!manifest) throw Error("BOOTSTRAP_MATCHING_RAW_HANDOFF_REQUIRED");
  for (const field of ["request", "raw"]) await download(manifest[field].key, handoffRoot);
  await py([
    script("daily_artifacts.py"),
    "verify",
    "--request",
    manifestPath,
    "--root",
    handoffRoot,
  ]);
  if (hashPayload(await json(join(handoffRoot, manifest.request.key))) !== hashPayload(payload))
    throw Error("BOOTSTRAP_HANDOFF_AUTHORITY_MISMATCH");
  await save(join(root, "prepared.json"), {
    replay: false,
    baseline: baselinePath,
    raw: join(handoffRoot, manifest.raw.key),
  });
}

export async function collect(root) {
  const context = nativeContext(),
    prepared = await json(join(root, "prepared.json"));
  if (prepared.replay) return;
  // This phase receives provider/evidence credentials only, never DB or Blob credentials.
  if (process.env.DATABASE_URL_UNPOOLED || process.env.BLOB_READ_WRITE_TOKEN)
    throw Error("COLLECTOR_CREDENTIAL_BOUNDARY_VIOLATION");
  const bundle = join(root, "bundle");
  const args = [
    script("run_28hse_incremental.py"),
    "--output-dir",
    bundle,
    "--transport",
    process.env.PROPERTY_SYNC_28HSE_TRANSPORT || "firecrawl-basic",
    "--max-detail",
    process.env.PROPERTY_SYNC_INCREMENTAL_MAX_DETAIL || "100",
    "--max-requests",
    process.env.PROPERTY_SYNC_INCREMENTAL_MAX_REQUESTS || "250",
    "--cache-ttl-days",
    process.env.PROPERTY_SYNC_INCREMENTAL_CACHE_TTL_DAYS || "7",
    "--max-refresh",
    process.env.PROPERTY_SYNC_INCREMENTAL_MAX_REFRESH || "40",
  ];
  if (prepared.cache) args.push("--cache", prepared.cache);
  else args.push("--bootstrap-baseline", prepared.baseline, "--bootstrap-raw", prepared.raw);
  await py(args);
  const report = await json(join(bundle, "report.json"));
  if (report.success !== true) throw Error("INCREMENTAL_COLLECTION_INCOMPLETE");
  const payload = normalizeIncrementalPayload(await json(join(bundle, "request.json")));
  await save(join(bundle, "request.json"), payload);
  const cache = await json(join(bundle, "cache-next.json"));
  const authority = await json(join(root, "authority.json"));
  cache.authority = {
    full_receipt_id: authority.receipt_id,
    incremental_receipt_id: authority.incremental_receipt_id ?? null,
  };
  await save(join(bundle, "cache-next.json"), cache);
  const asset = `incremental-bundle-${context.id}-${context.attempt}.tar.gz`;
  const archive = join(root, asset);
  await py([
    script("incremental_evidence.py"),
    "pack",
    "--directory",
    bundle,
    "--archive",
    archive,
    "--git-sha",
    context.gitSha,
  ]);
  await upload(archive);
  // Read back immutable bytes before giving any database stage this evidence.
  const readback = await download(asset, join(root, "pin-readback"));
  if (sha256(await readFile(readback)) !== sha256(await readFile(archive)))
    throw Error("INCREMENTAL_PIN_READBACK_FAILED");
  const pinned = await pinRequestAlias(
    root,
    { ...prepared, bundle_asset: asset, archive },
    await checkPrivateEvidence(),
  );
  await save(join(root, "prepared.json"), pinned);
}

export async function reconcileUnknownReceipt(payload, { read = readReceipt } = {}) {
  try {
    const row = await read(null, payload);
    if (
      row.payload_hash === hashPayload(payload) &&
      row.full_snapshot === false &&
      row.response?.success === true &&
      row.response.incremental === true &&
      row.response.incremental_mode === "index-delta-v1" &&
      row.response.receipt_id === row.id
    )
      return { ...row.response, reconciled: true };
  } catch {
    /* Missing or unavailable readback must retain uncertainty. */
  }
  const error = Error("OUTCOME_UNKNOWN");
  error.code = "OUTCOME_UNKNOWN";
  throw error;
}

export async function ingest(root, apply) {
  await verifyBundle(join(root, "bundle"));
  const path = join(root, "bundle/request.json"),
    payload = await json(path);
  decodeSnapshot(payload, { incremental: true });
  if (Date.now() - Date.parse(payload.scraped_at) > 36 * 3600000)
    throw Error("INCREMENTAL_CAPTURE_STALE");
  const args = [
    resolve("scripts/mls/ingest-28hse-incremental.mjs"),
    "--payload",
    path,
    "--out",
    join(root, "receipt.json"),
  ];
  if (apply) args.push("--apply");
  try {
    await runProcess(process.execPath, args);
  } catch (error) {
    if (
      !apply ||
      !["OUTCOME_UNKNOWN", "INGESTION_UNAVAILABLE", "INCREMENTAL_PROCESS_FAILED"].includes(
        error.message,
      )
    )
      throw error;
    const reconciled = await reconcileUnknownReceipt(payload);
    await save(join(root, "receipt.json"), reconciled);
  }
  if (apply) {
    const context = nativeContext();
    const receiptPath = join(root, `incremental-receipt-${context.id}-${context.attempt}.json`);
    await save(receiptPath, await json(join(root, "receipt.json")));
    await upload(receiptPath);
  }
}

export async function publish(root) {
  await verifyBundle(join(root, "bundle"));
  const receipt = await json(join(root, "receipt.json"));
  if (receipt.success !== true || receipt.incremental !== true || receipt.full_snapshot !== false)
    throw Error("INCREMENTAL_RECEIPT_REQUIRED");
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  const { publishDaily } = await import("../../src/lib/mls/daily-publication.mjs");
  const { createVercelBlobStore } = await import("../../src/lib/media/vercel-blob.mjs");
  const payload = await json(join(root, "bundle/request.json"));
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  try {
    await client.connect();
    const result = await publishDaily({
      payload,
      client,
      apply: true,
      incremental: true,
      blobStore: createVercelBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN }),
      onReport: async (report) => {
        await save(join(root, "publication.json"), report);
        const context = nativeContext();
        const reportPath = join(
          root,
          `incremental-publication-${context.id}-${context.attempt}.json`,
        );
        await save(reportPath, report);
        await upload(reportPath);
      },
    });
    await save(join(root, "publication.json"), result);
    if (result.unknown?.length) throw Error("INCREMENTAL_PUBLICATION_OUTCOME_UNKNOWN");
  } finally {
    await client.end();
  }
}

export async function accept(root) {
  const context = nativeContext();
  await verifyBundle(join(root, "bundle"));
  const verification = await json(join(root, "verification.json"));
  const publication = await json(join(root, "publication.json"));
  if (verification.homepageVerified !== true || publication.unknown?.length)
    throw Error("INCREMENTAL_PUBLIC_VERIFICATION_REQUIRED");
  const payload = await json(join(root, "bundle/request.json"));
  const result = await json(join(root, "receipt.json"));
  if (
    result.success !== true ||
    result.incremental !== true ||
    result.full_snapshot !== false ||
    !result.receipt_id
  )
    throw Error("INCREMENTAL_RECEIPT_REQUIRED");
  const authority = await readSyncAuthority();
  if (authority.incremental_receipt_id !== result.receipt_id)
    throw Error("INCREMENTAL_CACHE_AUTHORITY_CHANGED");
  const receipt = await readReceipt(result.receipt_id);
  if (receipt.payload_hash !== hashPayload(payload))
    throw Error("INCREMENTAL_RECEIPT_HASH_MISMATCH");
  const prepared = await json(join(root, "prepared.json"));
  const marker = {
    kind: "28hse-incremental-accepted-v1",
    receipt_id: result.receipt_id,
    full_receipt_id: authority.receipt_id,
    scraped_at: authority.last_incremental_scraped_at,
    bundle_asset: prepared.bundle_asset,
    bundle_sha256: sha256(await readFile(prepared.archive)),
    accepted_at: authority.last_incremental_accepted_at,
    publication_retry_pairs: publicationRetryPairs(publication),
  };
  validateAcceptance(marker, authority);
  const path = join(root, `incremental-accepted-${context.id}-${context.attempt}.json`);
  await save(path, marker);
  await upload(path);
  const readback = await download(path.split(/[\\/]/).at(-1), join(root, "accepted-readback"));
  if (sha256(await readFile(path)) !== sha256(await readFile(readback)))
    throw Error("INCREMENTAL_ACCEPTANCE_READBACK_FAILED");
}

export async function safeSummary(root) {
  const maybe = async (path) => (existsSync(path) ? json(path) : null);
  const report = await maybe(join(root, "bundle/report.json"));
  const receipt = await maybe(join(root, "receipt.json"));
  const publication = await maybe(join(root, "publication.json"));
  const verification = await maybe(join(root, "verification.json"));
  const prepared = await maybe(join(root, "prepared.json"));
  const summary = {
    source: "28hse",
    mode: "incremental",
    checkedAt: new Date().toISOString(),
    dryRun: process.env.INCREMENTAL_APPLY !== "true",
    indexComplete: report?.index_complete ?? false,
    indexOffers: report?.membership_count ?? 0,
    indexPagesVerified: report?.index_pages_verified ?? 0,
    saleIdsSeen: report?.sale_ids_seen ?? 0,
    rentIdsSeen: report?.rent_ids_seen ?? 0,
    newCandidates: report?.candidate_counts?.new ?? 0,
    changedCandidates: report?.candidate_counts?.changed ?? 0,
    retryCandidates: report?.candidate_counts?.retry ?? 0,
    periodicCandidates: report?.candidate_counts?.cache_expired ?? 0,
    indexStartedAt: report?.index_started_at ?? null,
    indexFinishedAt: report?.index_finished_at ?? null,
    lastFreshDetailAt: report?.last_fresh_detail_at ?? null,
    detailCandidates: report?.selected_count ?? 0,
    detailFetched: prepared?.replay ? 0 : (report?.fetched_count ?? 0),
    captureDetailFetched: report?.fetched_count ?? 0,
    reusedCapture: prepared?.replay === true,
    unchangedSkipped: report?.unchanged_count ?? 0,
    pendingDetails: report?.pending_count ?? 0,
    deferredRefresh: report?.deferred_refresh_count ?? 0,
    withdrawalCandidates: report?.withdrawal_candidate_count ?? 0,
    providerRequests: prepared?.replay ? 0 : (report?.requests_used ?? 0),
    captureProviderRequests: report?.requests_used ?? 0,
    fullSnapshot: false,
    absenceAllowed: false,
    receiptId: receipt?.receipt_id ?? null,
    created: receipt?.summary?.properties_created ?? 0,
    updated: receipt?.summary?.properties_changed ?? 0,
    published: publication?.published?.length ?? 0,
    held: publication?.held?.length ?? 0,
    publicationRetries: publicationRetryPairs(publication).length,
    eligiblePublicationBacklog: publication?.eligibleBacklog ?? 0,
    verification: verification ?? null,
    privateBundle: prepared?.bundle_asset ?? null,
  };
  await save(join(root, "summary.json"), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      "### 28hse 每日增量同步\n\n```json\n" + JSON.stringify(summary, null, 2) + "\n```\n",
    );
  console.log(JSON.stringify(summary));
}

export async function record(root) {
  const context = nativeContext();
  verifyDailyTarget(
    process.env.DATABASE_URL_UNPOOLED,
    process.env.PROPERTY_SYNC_EXPECTED_DATABASE_HOST,
  );
  const maybe = async (path) => (existsSync(path) ? json(path) : null);
  const clocks = (await maybe(join(root, "clocks.json"))) ?? {};
  const payload = await maybe(join(root, "bundle/request.json"));
  const receipt = await maybe(join(root, "receipt.json"));
  const publication = await maybe(join(root, "publication.json"));
  const prepared = await maybe(join(root, "prepared.json"));
  const stages = Object.fromEntries(
    [
      ["collect", "collection"],
      ["ingest", "ingestion"],
      ["publish", "publication"],
      ["verify", "verification"],
    ].map(([phase, stage]) => [
      stage,
      clocks[phase] ? { ...clocks[phase] } : { status: "pending" },
    ]),
  );
  if (publication?.unknown?.length)
    stages.publication = {
      ...stages.publication,
      status: "unknown",
      errorCode: "PUBLICATION_OUTCOME_UNKNOWN",
    };
  if (clocks.prepare?.status === "failed")
    stages.collection = {
      ...clocks.prepare,
      status: "blocked",
      errorCode: "INCREMENTAL_PREFLIGHT_FAILED",
    };
  if (payload && stages.collection.status === "succeeded") {
    stages.collection.startedAt = new Date(payload.meta.incremental.index_started_at).toISOString();
    stages.collection.finishedAt = new Date(payload.scraped_at).toISOString();
    stages.collection.indexFinishedAt = new Date(
      payload.meta.incremental.index_finished_at,
    ).toISOString();
    stages.collection.pagesRead = payload.meta.pages.length;
    stages.collection.pagesFailed = payload.meta.pages_failed;
  }
  if (receipt?.receipt_id) {
    stages.ingestion.receiptId = receipt.receipt_id;
    stages.ingestion.reconciled = receipt.reconciled === true;
  } else if (stages.ingestion.status === "succeeded")
    stages.ingestion = { ...stages.ingestion, status: "blocked", errorCode: "DRY_RUN_NO_WRITES" };
  const summary = {
    source: HSE_PUBLICATION_SOURCE.source,
    scopeId: "agent:540",
    incremental: true,
    workflowRunId: context.id,
    workflowAttempt: Number(context.attempt),
    gitSha: context.gitSha,
    requestHash: payload ? hashPayload(payload) : undefined,
    privateEvidenceRef: prepared?.request_asset
      ? { requestAsset: prepared.request_asset }
      : undefined,
    stages,
    counts: {
      advertisementsObserved: receipt?.summary?.index_advertisement_count ?? 0,
      canonicalCreated: receipt?.summary?.properties_created ?? 0,
      canonicalUpdated: receipt?.summary?.properties_changed ?? 0,
      published: publication?.published?.length ?? 0,
      held: publication?.held?.length ?? 0,
    },
    startedAt: clocks.prepare?.startedAt,
    finishedAt: new Date().toISOString(),
  };
  const hex = sha256(Buffer.from(`incremental:${context.id}:${context.attempt}`));
  const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const { recordSyncRun } = await import("../../src/lib/mls/sync-run-repository.mjs");
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
  });
  client.neonConfig.webSocketConstructor = globalThis.WebSocket;
  try {
    await client.connect();
    await recordSyncRun({ client, runId, summary });
  } finally {
    await client.end();
  }
}

export async function main(args = process.argv.slice(2)) {
  const [phase, ...rest] = args;
  const allowed = [
    "prepare",
    "collect",
    "ingest",
    "publish",
    "verify",
    "accept",
    "record",
    "summary",
  ];
  if (!allowed.includes(phase) || rest.length % 2) throw Error("INVALID_ARGUMENTS");
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!["--root", "--replay", "--apply"].includes(rest[i]) || options[rest[i]] !== undefined)
      throw Error("INVALID_ARGUMENTS");
    options[rest[i]] = rest[i + 1];
  }
  const root = resolve(options["--root"] || ".private-sync-evidence/incremental");
  await mkdir(root, { recursive: true });
  const measured = !["record", "summary"].includes(phase);
  const clock = { status: "succeeded", startedAt: new Date().toISOString() };
  try {
    if (phase === "prepare") await prepare(root, options["--replay"]);
    if (phase === "collect") await collect(root);
    if (phase === "ingest") await ingest(root, options["--apply"] === "true");
    if (phase === "publish") await publish(root);
    if (phase === "verify") {
      const { verifyPublicReport } = await import("../mls/verify-sync-publication.mjs");
      await save(
        join(root, "verification.json"),
        await verifyPublicReport(await json(join(root, "publication.json"))),
      );
    }
    if (phase === "accept") await accept(root);
    if (phase === "record") await record(root);
    if (phase === "summary") await safeSummary(root);
  } catch (error) {
    clock.status =
      error.code === "OUTCOME_UNKNOWN" || error.message === "OUTCOME_UNKNOWN"
        ? "unknown"
        : "failed";
    clock.errorCode = /^[A-Z_]+$/.test(error.message) ? error.message : "INCREMENTAL_STAGE_FAILED";
    throw error;
  } finally {
    if (measured) {
      const clocksPath = join(root, "clocks.json");
      const clocks = existsSync(clocksPath) ? await json(clocksPath) : {};
      clocks[phase] = { ...clock, finishedAt: new Date().toISOString() };
      await save(clocksPath, clocks);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(/^[A-Z_]+$/.test(error.message) ? error.message : "INCREMENTAL_DAILY_FAILED");
    process.exitCode = 1;
  });
}
