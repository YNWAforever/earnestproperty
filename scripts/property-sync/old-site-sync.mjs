#!/usr/bin/env node
/**
 * One-command sync of the legacy official-site inventory (Phase 1).
 *
 * Mirrors https://www.earnestproperty.com.hk/property/ (the company's own
 * Property.hk-driven front-end) into the new site's properties table using the
 * core lib in src/lib/mls. Default is a dry run: it fetches and parses the live
 * site and, when a database URL is configured, reads the database READ-ONLY to
 * report accurate estate resolution and the `databaseDelta` preview; dry-run
 * mode never writes. `--apply` writes (requires DATABASE_URL_UNPOOLED or
 * DATABASE_URL) and then runs the two post steps: the correspondent-agent
 * backfill and the estate-stat backfill.
 *
 * Usage:
 *   node scripts/property-sync/old-site-sync.mjs                       # dry run
 *   node scripts/property-sync/old-site-sync.mjs --apply               # write + post steps
 *   node scripts/property-sync/old-site-sync.mjs --max-details=500 --max-pages=64
 *   node scripts/property-sync/old-site-sync.mjs --from-dir=artifacts/old-site-replay
 *   node scripts/property-sync/old-site-sync.mjs --help
 *   node scripts/property-sync/old-site-sync.mjs --max-details 2000    # space form too
 *
 * Flags:
 *   --apply                 write to the database (default: dry run)
 *   --max-details=N         detail pages to fetch (default 2000)
 *   --max-pages=N           list pages per seed (default 200)
 *   --delay-ms=N            delay between live requests (default 250; env OLD_SITE_DELAY_MS)
 *   --timeout-ms=N          per-request timeout (default 20000; env OLD_SITE_TIMEOUT_MS)
 *   --report-dir=DIR        report directory (default artifacts/old-site-sync/<runId>)
 *   --from-dir=DIR          replay captured HTML instead of the network; the directory
 *                           holds index.json { "<absolute url>": "<relative file>" }
 *   --skip-agents           skip the correspondent-agent post step
 *   --skip-estate-stats     skip the estate-stat post step
 *   --allow-low-coverage    ONE-OFF initial reconciliation only: let the
 *                           withdrawal sweep run even when the discovery pass
 *                           covers less than the 70% guard (a stale inventory
 *                           can legitimately need a larger first sweep). Never
 *                           use this in the daily workflow; it is reported in
 *                           summary.json as coverageOverride.
 *   --help
 *
 * Env: OLD_SITE_ORIGIN (default https://www.earnestproperty.com.hk),
 *      DATABASE_URL_UNPOOLED | DATABASE_URL (required for --apply; in dry-run
 *      they enable the read-only estate mapping + databaseDelta preview),
 *      OLD_SITE_DELAY_MS, OLD_SITE_TIMEOUT_MS.
 *
 * Exit codes: 0 success; 1 run failure (importer throw, error budget exceeded,
 * discovery too small, post-step failure); 2 prerequisite failure (TLS/cert,
 * network, challenge/blocked page, bad config). TLS is validated strictly and
 * can never be disabled here.
 *
 * The report is <reportDir>/summary.json plus errors.json; post-step reports go
 * to artifacts/old-site-agents/<runId>.json and
 * artifacts/old-site-estate-stats/<runId>.json. This module opens no database
 * connection and fetches nothing on import -- everything happens in `main()`.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_ORIGIN = "https://www.earnestproperty.com.hk";
export const DEFAULT_MAX_DETAILS = 2000;
export const DEFAULT_MAX_PAGES = 200;
export const DEFAULT_DELAY_MS = 250;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** The properties.source_site value this sync owns (matches src/lib/mls/importer.mjs). */
export const OLD_SITE_SOURCE = "earnestproperty-old-site";
/** A discovery pass this small cannot be trusted to infer withdrawals. */
export const MIN_DISCOVERY_FOR_SWEEP = 300;
/** Mirrors the coverage guard in src/lib/mls/neon-db.mjs. */
export const MIN_DEACTIVATION_COVERAGE = 0.7;
export const REPORT_ROOT = "artifacts/old-site-sync";
export const AGENT_REPORT_ROOT = "artifacts/old-site-agents";
export const ESTATE_STATS_REPORT_ROOT = "artifacts/old-site-estate-stats";

const IMPORTER_URL = new URL("../../src/lib/mls/importer.mjs", import.meta.url);
const NEON_DB_URL = new URL("../../src/lib/mls/neon-db.mjs", import.meta.url);
const TLS_MESSAGE =
  "TLS certificate validation failed for the old-site host. Fix the .com.hk certificate " +
  "(or front the legacy site with a Cloudflare proxy whose origin is the legacy host); " +
  "TLS verification is never disabled by the sync.";
const NETWORK_MESSAGE =
  "Cannot reach the old-site host. Check the network/DNS/proxy and the OLD_SITE_ORIGIN value; " +
  "this is a prerequisite failure, so nothing was written.";
const CHALLENGE_MESSAGE =
  "The old-site host answered with a login/CAPTCHA/access-denied (challenge) page. " +
  "Allow the sync client's requests (or front the site with Cloudflare) and re-run.";
const UNEXPECTED_HTML_MESSAGE =
  "The old-site listing page returned no listing links. Capture the body, compare it with " +
  "scripts/old-site-migration/__fixtures__ and update the parser before re-running; nothing was written.";

const USAGE = `Usage: node scripts/property-sync/old-site-sync.mjs [options]

Syncs https://www.earnestproperty.com.hk/property/ into the properties table.
Default is a dry run: fetches/parses, and with a database URL configured reads
the database READ-ONLY for estate mapping plus the databaseDelta preview.
Dry-run never writes. --apply writes and then backfills correspondent agents
and estate stats.

Options:
  --apply                 write to the database
  --max-details=N         detail pages to fetch (default ${DEFAULT_MAX_DETAILS})
  --max-pages=N           list pages per seed (default ${DEFAULT_MAX_PAGES})
  --delay-ms=N            delay between live requests (default ${DEFAULT_DELAY_MS})
  --timeout-ms=N          per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  --report-dir=DIR        report directory (default ${REPORT_ROOT}/<runId>)
  --from-dir=DIR          replay captured HTML via DIR/index.json instead of the network
  --skip-agents           skip the correspondent-agent post step
  --skip-estate-stats     skip the estate-stat post step
  --allow-low-coverage    one-off initial reconciliation: allow the sweep below the 70% coverage guard
  --help

Exit codes: 0 success, 1 run failure, 2 prerequisite failure (TLS/network/challenge/config).`;

const CHALLENGE_PATTERNS = [
  /captcha/i,
  /cloudflare/i,
  /cf-chl-/i,
  /challenge-platform/i,
  /verify you are human/i,
  /just a moment/i,
  /access denied/i,
  /安全驗證/,
  /驗證碼/,
  /請先登入/,
  /需要登入/,
];

const TLS_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_TLS_INVALID_PROTOCOL_VERSION",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_TLS_PROTOCOL_VERSION_CONFLICT",
  "ERR_SSL_WRONG_VERSION_NUMBER",
]);

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "ABORT_ERR",
]);

export class SyncCliError extends Error {
  constructor(message, code = "invalid_configuration") {
    super(message);
    this.name = "SyncCliError";
    this.code = code;
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function newRunId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function integerArgument(value, flag, minimum = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new SyncCliError(
      `${flag} must be an integer >= ${minimum}: ${value}`,
      "invalid_argument",
    );
  }
  return number;
}

function environmentInteger(environment, name, fallback, minimum) {
  const raw = environment?.[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return integerArgument(String(raw), name, minimum);
}

const VALUE_FLAGS = new Map([
  ["--max-details", "maxDetails"],
  ["--max-pages", "maxPages"],
  ["--delay-ms", "delayMs"],
  ["--timeout-ms", "timeoutMs"],
  ["--report-dir", "reportDir"],
  ["--from-dir", "fromDir"],
]);

/**
 * Parse the CLI arguments. Both `--flag=value` and `--flag value` are accepted
 * (the daily workflow passes the space-separated form). Numeric defaults honour
 * OLD_SITE_DELAY_MS / OLD_SITE_TIMEOUT_MS from the environment.
 *
 * @param {string[]} argv process arguments without the node/script entries.
 * @param {{environment?: object}} [context]
 * @returns {{apply: boolean, help: boolean, skipAgents: boolean,
 *   skipEstateStats: boolean, allowLowCoverage: boolean, maxDetails: number,
 *   maxPages: number, delayMs: number, delayMsExplicit: boolean,
 *   timeoutMs: number, reportDir: string|null, fromDir: string|null}}
 */
export function parseArgs(argv = [], { environment = {} } = {}) {
  const options = {
    apply: false,
    help: false,
    skipAgents: false,
    skipEstateStats: false,
    allowLowCoverage: false,
    maxDetails: DEFAULT_MAX_DETAILS,
    maxPages: DEFAULT_MAX_PAGES,
    delayMs: environmentInteger(environment, "OLD_SITE_DELAY_MS", DEFAULT_DELAY_MS, 0),
    delayMsExplicit: false,
    timeoutMs: environmentInteger(environment, "OLD_SITE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1),
    reportDir: null,
    fromDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--skip-agents") {
      options.skipAgents = true;
      continue;
    }
    if (argument === "--skip-estate-stats") {
      options.skipEstateStats = true;
      continue;
    }
    if (argument === "--allow-low-coverage") {
      options.allowLowCoverage = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const field = VALUE_FLAGS.get(flag);
    if (!field) {
      throw new SyncCliError(`unknown argument: ${argument}`, "invalid_argument");
    }
    let rawValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    if (rawValue === undefined) {
      index += 1;
      if (index >= argv.length) {
        throw new SyncCliError(`${flag} requires a value`, "invalid_argument");
      }
      rawValue = String(argv[index]);
    }
    if (!rawValue.trim()) {
      throw new SyncCliError(`${flag} requires a value`, "invalid_argument");
    }
    if (
      field === "delayMs" ||
      field === "timeoutMs" ||
      field === "maxDetails" ||
      field === "maxPages"
    ) {
      const minimum = field === "delayMs" ? 0 : 1;
      options[field] = integerArgument(rawValue, flag, minimum);
      if (field === "delayMs") options.delayMsExplicit = true;
    } else {
      options[field] = rawValue;
    }
  }
  return options;
}

/** URL spellings tried when looking an absolute URL up in a replay index. */
function replayCandidates(url) {
  const values = [url];
  try {
    const parsed = new URL(url);
    if (!parsed.search && !parsed.hash) {
      const pathname = parsed.pathname;
      const alternate = pathname.endsWith("/") ? pathname.replace(/\/+$/, "") : `${pathname}/`;
      values.push(`${parsed.origin}${alternate}`);
    }
  } catch {
    // Not a URL: the exact value is the only candidate.
  }
  return values;
}

/**
 * Build the `fetchText(url)` used by `--from-dir`: a captured HTML file per
 * absolute URL. Unknown URLs fail loudly instead of returning an empty page, so
 * a partial capture can never look like a shrunken live inventory.
 *
 * @param {Record<string, string>} index absolute URL -> relative file.
 * @param {{rootDir?: string, readFile?: Function}} [options]
 * @returns {(url: string) => Promise<string>}
 */
export function buildReplayFetchText(
  index,
  { rootDir = ".", readFile: readFileImpl = readFile } = {},
) {
  if (!index || typeof index !== "object" || Array.isArray(index)) {
    throw new TypeError("buildReplayFetchText requires a replay index object");
  }
  const root = path.resolve(rootDir);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return async function replayFetchText(url) {
    const key = replayCandidates(String(url)).find((candidate) =>
      Object.prototype.hasOwnProperty.call(index, candidate),
    );
    if (!key) {
      const error = new Error(`replay index has no captured file for ${url}`);
      error.code = "replay_url_missing";
      throw error;
    }
    const relative = index[key];
    if (typeof relative !== "string" || !relative.trim()) {
      const error = new Error(`replay index entry for ${url} is not a file path`);
      error.code = "replay_url_invalid";
      throw error;
    }
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(rootPrefix)) {
      const error = new Error(`replay index entry escapes the replay directory: ${relative}`);
      error.code = "replay_path_escape";
      throw error;
    }
    try {
      return await readFileImpl(target, "utf8");
    } catch (error) {
      const wrapped = new Error(`cannot read replay file for ${url}: ${messageOf(error)}`);
      wrapped.code = "replay_file_unreadable";
      wrapped.cause = error;
      throw wrapped;
    }
  };
}

/**
 * Read and validate `<fromDir>/index.json`.
 *
 * @returns {Promise<Record<string, string>>} absolute URL -> relative file.
 */
export async function loadReplayIndex(fromDir, { readFile: readFileImpl = readFile } = {}) {
  if (typeof fromDir !== "string" || !fromDir.trim()) {
    throw new SyncCliError("--from-dir requires a directory", "invalid_replay_dir");
  }
  const indexFile = path.join(fromDir, "index.json");
  let raw;
  try {
    raw = await readFileImpl(indexFile, "utf8");
  } catch (error) {
    throw new SyncCliError(
      `cannot read replay index ${indexFile}: ${messageOf(error)}`,
      "invalid_replay_dir",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SyncCliError(
      `replay index ${indexFile} is not valid JSON: ${messageOf(error)}`,
      "invalid_replay_dir",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyncCliError(
      `replay index ${indexFile} must be an object mapping URL to relative file`,
      "invalid_replay_dir",
    );
  }
  const index = {};
  for (const [url, file] of Object.entries(parsed)) {
    if (typeof url !== "string" || !url.trim()) continue;
    if (typeof file !== "string" || !file.trim()) continue;
    index[url] = file;
  }
  if (!Object.keys(index).length) {
    throw new SyncCliError(
      `replay index ${indexFile} contains no URL -> file entries`,
      "invalid_replay_dir",
    );
  }
  return index;
}

/**
 * Wrap a fetch function so at most one request starts every `delayMs`. The
 * first call is immediate; the delay is applied before every later call.
 */
export function createThrottledFetchText(fetchText, { delayMs = 0, sleep = defaultSleep } = {}) {
  if (typeof fetchText !== "function") {
    throw new TypeError("createThrottledFetchText requires a fetchText function");
  }
  let calls = 0;
  return async function throttledFetchText(url) {
    if (calls > 0 && delayMs > 0) await sleep(delayMs);
    calls += 1;
    return fetchText(url);
  };
}

/**
 * Decide whether a candidate preflight response is the real listing index.
 * Listing links are the strongest signal; a response without them is either a
 * challenge page or an unexpected template, and both must not proceed.
 */
export function classifyPreflightHtml(html) {
  const text = String(html ?? "");
  if (!text.trim()) {
    return {
      ok: false,
      kind: "challenge",
      code: "empty_response",
      detailLinks: 0,
      message: "The preflight response was empty.",
    };
  }
  const detailLinks = (text.match(/\/property-detail\/\d+\.html/gi) ?? []).length;
  if (detailLinks > 0) {
    return { ok: true, kind: "listing_index", code: "ok", detailLinks, message: "" };
  }
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      ok: false,
      kind: "challenge",
      code: "challenge_detected",
      detailLinks: 0,
      message: "The preflight response looks like a login/CAPTCHA/access-denied page.",
    };
  }
  return {
    ok: false,
    kind: "unexpected_content",
    code: "unexpected_content",
    detailLinks: 0,
    message: "The preflight response has no listing links; the old-site template may have changed.",
  };
}

function errorChain(error) {
  const chain = [];
  let current = error;
  for (let depth = 0; current != null && depth < 6; depth += 1) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

/**
 * Classify an error thrown while reaching the old site.
 *
 * @returns {null | {kind: string, code: string, status?: number|null,
 *   message: string, actionable: string}} null when the error is not a
 *   prerequisite failure.
 */
export function detectPrerequisiteFailure(error) {
  if (!error) return null;
  const chain = errorChain(error);
  const codes = [];
  const names = [];
  const statuses = [];
  for (const item of chain) {
    for (const key of ["code", "errno"]) {
      const value = item?.[key];
      if (typeof value === "string") codes.push(value);
    }
    if (typeof item?.name === "string") names.push(item.name);
    if (Number.isInteger(item?.status)) statuses.push(item.status);
  }
  const messages = chain.map((item) => String(item?.message ?? "")).join(" | ");

  const tlsCode = codes.find(
    (code) => TLS_ERROR_CODES.has(code) || /^(ERR_TLS_|ERR_SSL_)/.test(code),
  );
  if (
    tlsCode ||
    /certificate|cert has expired|altname|self[ -]signed|wrong principal|tls handshake|ssl/i.test(
      messages,
    )
  ) {
    return {
      kind: "tls_certificate",
      code: tlsCode ?? "TLS_CERTIFICATE",
      message: messages,
      actionable: TLS_MESSAGE,
    };
  }

  if (codes.includes("challenge_detected") || CHALLENGE_PATTERNS.some((p) => p.test(messages))) {
    return {
      kind: "challenge",
      code: "challenge_detected",
      message: messages,
      actionable: CHALLENGE_MESSAGE,
    };
  }

  const httpStatus = statuses.find((status) => status >= 400);
  if (codes.includes("fetch_failed") || httpStatus !== undefined) {
    const challengeStatus = [401, 403, 407, 429].includes(httpStatus);
    return {
      kind: challengeStatus ? "challenge" : "http_status",
      code: `http_${httpStatus ?? "unknown"}`,
      status: httpStatus ?? null,
      message: messages,
      actionable: challengeStatus
        ? CHALLENGE_MESSAGE
        : `The old-site host returned HTTP ${httpStatus}; treat this as a site prerequisite and re-run once it is healthy.`,
    };
  }

  const networkCode = codes.find((code) => NETWORK_ERROR_CODES.has(code));
  const isTimeout =
    names.includes("TimeoutError") ||
    names.includes("AbortError") ||
    codes.includes("ABORT_ERR") ||
    /timed out|timeout/i.test(messages);
  if (
    networkCode ||
    isTimeout ||
    /fetch failed|network|econn|enotfound|eai_again|socket|aborted|connect/i.test(messages)
  ) {
    return {
      kind: isTimeout && !networkCode ? "timeout" : "network",
      code: networkCode ?? (isTimeout ? "TIMEOUT" : "NETWORK"),
      message: messages,
      actionable: NETWORK_MESSAGE,
    };
  }
  return null;
}

/**
 * Classify an error thrown by the database client so a Neon connection/auth
 * failure is reported as a database prerequisite (exit 2) instead of being
 * mistaken for an old-site network problem.
 */
export function detectDatabaseFailure(error) {
  if (!error) return null;
  const messages = errorChain(error)
    .map((item) => String(item?.message ?? ""))
    .join(" | ");
  if (
    /error connecting to database|neon|postgres|::sql|relation "[^"]*" does not exist|permission denied for/i.test(
      messages,
    )
  ) {
    return {
      kind: "database",
      code: "database_unreachable",
      message: messages,
      actionable:
        "The database could not be reached or queried. Check DATABASE_URL_UNPOOLED/DATABASE_URL " +
        "and the database health; the sync writes nothing when the database is unavailable.",
    };
  }
  return null;
}

function pairKey(legacyDetailId, dealType) {
  return `${legacyDetailId}\0${dealType}`;
}

/**
 * Read the old-site inventory snapshot used to preview the database delta in
 * dry-run: only (legacy_detail_id, deal_type, status). SELECT only by
 * construction, so the dry-run read-only guarantee is auditable in one place.
 */
export async function readPropertyPairSnapshot(sql) {
  if (typeof sql !== "function") {
    throw new TypeError("readPropertyPairSnapshot requires a sql tagged-template function");
  }
  const rows = await sql`
    SELECT legacy_detail_id, deal_type, status, ingestion_owner
    FROM properties
    WHERE source_site = ${OLD_SITE_SOURCE}
  `;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Read which source currently owns each `listing_no` in the run's would-be
 * rows. SELECT only. Used by the dry-run to report cross-source duplicates
 * before the first apply (Property.hk already serves the same listings under
 * the unique listing_no, so those rows are skipped rather than overwritten).
 */
export async function readListingNoOwnership(sql, listingNos = []) {
  if (typeof sql !== "function") {
    throw new TypeError("readListingNoOwnership requires a sql tagged-template function");
  }
  const unique = [
    ...new Set((Array.isArray(listingNos) ? listingNos : []).map(String).filter(Boolean)),
  ];
  if (!unique.length) return [];
  const rows = await sql`
    SELECT listing_no, source_site, legacy_detail_id, deal_type::text AS deal_type,
           ingestion_owner
    FROM properties
    WHERE listing_no = ANY(${unique}::text[])
  `;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Rows this run would write that another writer already owns: a different
 * source feed with the same unique `listing_no`, or a `no-hermes-v2` row the
 * legacy writer is fenced from touching. Pure; reported in the dry-run and
 * skipped by the DB writer.
 *
 * @returns {Array<{listing_no: string, canonical_property_no: string|null,
 *   deal_type: string|null, existing_source_site: string|null,
 *   existing_ingestion_owner: string|null}>}
 */
export function computeCrossSourceDuplicates({ dryRunRows = [], ownershipRows = [] } = {}) {
  const rows = Array.isArray(dryRunRows) ? dryRunRows : [];
  const owners = new Map(
    (Array.isArray(ownershipRows) ? ownershipRows : []).map((row) => [row.listing_no, row]),
  );
  const duplicates = [];
  for (const row of rows) {
    const owner = owners.get(row?.listing_no);
    if (!owner) continue;
    const writerOwned =
      owner.source_site === OLD_SITE_SOURCE && (owner.ingestion_owner ?? "legacy") === "legacy";
    if (writerOwned) continue;
    duplicates.push({
      listing_no: row.listing_no,
      canonical_property_no: row.canonical_property_no ?? null,
      deal_type: row.deal_type ?? null,
      existing_source_site: owner.source_site ?? null,
      existing_ingestion_owner: owner.ingestion_owner ?? null,
    });
  }
  return duplicates;
}

/**
 * Compute the dry-run database delta: how the properties table would change if
 * this run were applied. Pure, so the first-apply evidence gate is reviewable
 * and unit-testable without a database.
 *
 * `coveragePreview` mirrors the guard in src/lib/mls/neon-db.mjs: the share of
 * currently-active distinct legacy ids that this discovery pass saw. A run below
 * MIN_DEACTIVATION_COVERAGE would be refused by the apply sweep.
 *
 * @param {{propertiesRows?: Array<{legacy_detail_id: string, deal_type: string,
 *   status: string}>, pairsSeen?: Array<[string, string]>,
 *   discoveredLegacyIds?: string[]|null, protectedLegacyIds?: string[],
 *   minCoverage?: number}} input
 * @returns {{dbRows: number, existingPairs: number, existingActivePairs: number,
 *   newPairs: number, reactivatedPairs: number, withdrawnPairs: number,
 *   existingActiveSeenPairs: number, seenPairs: number, discoveredIds: number,
 *   protectedIds: number, activeLegacyIds: number, seenActiveLegacyIds: number,
 *   writerOwnedSeenPairs: number, coveragePreview: number,
 *   coverageWouldBlock: boolean}}
 */
export function computeDatabaseDelta({
  propertiesRows = [],
  pairsSeen = [],
  discoveredLegacyIds = null,
  protectedLegacyIds = [],
  minCoverage = MIN_DEACTIVATION_COVERAGE,
} = {}) {
  const rows = Array.isArray(propertiesRows) ? propertiesRows : [];

  const seenPairs = [];
  const seenPairKeys = new Set();
  for (const pair of Array.isArray(pairsSeen) ? pairsSeen : []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const legacyDetailId = pair[0] == null ? null : String(pair[0]);
    const dealType = pair[1] == null ? null : String(pair[1]);
    if (!legacyDetailId || !dealType) continue;
    const key = pairKey(legacyDetailId, dealType);
    if (seenPairKeys.has(key)) continue;
    seenPairKeys.add(key);
    seenPairs.push([legacyDetailId, dealType]);
  }

  const discoveredIds = Array.isArray(discoveredLegacyIds)
    ? discoveredLegacyIds.map(String)
    : seenPairs.map(([legacyDetailId]) => legacyDetailId);
  const discoveredIdSet = new Set(discoveredIds);
  const protectedIds = new Set(
    (Array.isArray(protectedLegacyIds) ? protectedLegacyIds : []).map(String),
  );

  const byPair = new Map();
  for (const row of rows) {
    const legacyDetailId = row?.legacy_detail_id == null ? null : String(row.legacy_detail_id);
    const dealType = row?.deal_type == null ? null : String(row.deal_type);
    if (!legacyDetailId || !dealType) continue;
    const key = pairKey(legacyDetailId, dealType);
    if (!byPair.has(key)) {
      byPair.set(key, { legacyDetailId, statuses: new Set(), misowned: new Set() });
    }
    const pair = byPair.get(key);
    pair.statuses.add(typeof row.status === "string" ? row.status : "");
    const owner = typeof row.ingestion_owner === "string" ? row.ingestion_owner : "legacy";
    if (owner !== "legacy") pair.misowned.add(owner);
  }

  const activeLegacyIds = new Set();
  const seenActiveLegacyIds = new Set();
  let existingActivePairs = 0;
  let existingActiveSeenPairs = 0;
  let withdrawnPairs = 0;
  for (const [key, pair] of byPair) {
    const active = pair.statuses.has("active");
    const nonInactive = [...pair.statuses].some((status) => status !== "inactive");
    // The DB sweep is fenced from `no-hermes-v2` rows, so the preview must not
    // count them as withdrawal/reactivation it could perform.
    const writerOwned = pair.misowned.size > 0;
    if (active) {
      existingActivePairs += 1;
      activeLegacyIds.add(pair.legacyDetailId);
      if (seenPairKeys.has(key)) existingActiveSeenPairs += 1;
      if (discoveredIdSet.has(pair.legacyDetailId)) {
        seenActiveLegacyIds.add(pair.legacyDetailId);
      }
    }
    if (
      !writerOwned &&
      nonInactive &&
      !seenPairKeys.has(key) &&
      !protectedIds.has(pair.legacyDetailId)
    ) {
      withdrawnPairs += 1;
    }
  }

  let newPairs = 0;
  let reactivatedPairs = 0;
  let writerOwnedSeenPairs = 0;
  for (const [legacyDetailId, dealType] of seenPairs) {
    const pair = byPair.get(pairKey(legacyDetailId, dealType));
    if (!pair) {
      newPairs += 1;
      continue;
    }
    if (pair.misowned.size > 0) {
      writerOwnedSeenPairs += 1;
      continue;
    }
    const nonInactive = [...pair.statuses].some((status) => status !== "inactive");
    if (!nonInactive && pair.statuses.has("inactive")) reactivatedPairs += 1;
  }

  const coverage = activeLegacyIds.size === 0 ? 1 : seenActiveLegacyIds.size / activeLegacyIds.size;
  return {
    dbRows: rows.length,
    existingPairs: byPair.size,
    existingActivePairs,
    newPairs,
    reactivatedPairs,
    withdrawnPairs,
    existingActiveSeenPairs,
    writerOwnedSeenPairs,
    seenPairs: seenPairs.length,
    discoveredIds: discoveredIds.length,
    protectedIds: protectedIds.size,
    activeLegacyIds: activeLegacyIds.size,
    seenActiveLegacyIds: seenActiveLegacyIds.size,
    coveragePreview: Math.round(coverage * 10_000) / 10_000,
    coverageWouldBlock: coverage < minCoverage,
  };
}

/**
 * Build the documented `<reportDir>/summary.json` object. Fields the importer
 * does not expose stay null; `reactivated` is only present when known.
 */
export function summarizeRun({
  runId = null,
  mode = "dry-run",
  startedAt = null,
  finishedAt = null,
  durationMs = null,
  sourceOrigin = null,
  syncResult = null,
  syncError = null,
  postStepErrors = [],
  agentReport = null,
  estateStatsReport = null,
  databaseDelta = null,
  reactivated = undefined,
} = {}) {
  const sync = syncResult ?? {};
  const errors = [];
  for (const error of Array.isArray(sync.errors) ? sync.errors : []) {
    errors.push({
      url: typeof error?.url === "string" ? error.url : null,
      message: String(error?.message ?? error),
    });
  }
  if (syncError) errors.push({ url: null, message: messageOf(syncError) });
  for (const error of Array.isArray(postStepErrors) ? postStepErrors : []) {
    errors.push({
      url: typeof error?.url === "string" ? error.url : null,
      message: String(error?.message ?? error),
    });
  }

  const summary = {
    runId,
    mode,
    startedAt,
    finishedAt,
    durationMs,
    sourceOrigin,
    discovered: sync.discovered ?? null,
    fetched: sync.fetched ?? null,
    parsed: sync.parsed ?? null,
    upserted: sync.upserted ?? null,
    deactivated: sync.deactivated ?? null,
    deactivationSkipped: sync.deactivationSkipped ?? null,
    deactivationBlocked: sync.deactivationBlocked ?? null,
    deactivationCoverage: sync.deactivationCoverage ?? null,
    coverageOverride: sync.coverageOverride ?? false,
    skippedConflicts: sync.skippedConflicts ?? null,
    errorRate: sync.errorRate ?? null,
    errorBudgetExceeded: sync.errorBudgetExceeded ?? null,
    canonicalMissing: sync.canonicalMissing ?? null,
    estateResolved: sync.estateResolved ?? null,
    estateUnresolved: sync.estateUnresolved ?? null,
    databaseDelta,
    newlyInserted: null,
    errors,
    agentReport,
    estateStatsReport,
  };
  const knownReactivated = reactivated !== undefined ? reactivated : sync.reactivated;
  if (knownReactivated !== undefined) summary.reactivated = knownReactivated;
  return summary;
}

/**
 * The documented exit-code contract: 2 prerequisite failure, 0 success,
 * anything else a run failure (1).
 */
export function exitCodeFor(result = {}) {
  if (result?.prerequisiteFailure) return 2;
  if (result?.ok === true) return 0;
  return 1;
}

async function writeJsonFile(filePath, value) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function displayPath(filePath) {
  const relative = path.relative(process.cwd(), path.resolve(filePath));
  return relative && !relative.startsWith("..") ? relative : path.resolve(filePath);
}

function printHumanSummary(summary, { reportDir, prerequisiteFailure = null }) {
  const line = (label, value) =>
    console.log(
      `  ${String(label).padEnd(22)} ${value === null || value === undefined ? "-" : value}`,
    );
  console.log("");
  console.log(`old-site-sync ${summary.mode} run ${summary.runId ?? "-"}`);
  line("source", summary.sourceOrigin);
  line("discovered", summary.discovered);
  line("fetched", summary.fetched);
  line("parsed", summary.parsed);
  line("upserted", summary.upserted);
  line("deactivated", summary.deactivated);
  line("deactivationSkipped", summary.deactivationSkipped);
  line("deactivationBlocked", summary.deactivationBlocked);
  line("deactivationCoverage", summary.deactivationCoverage);
  line("coverageOverride", summary.coverageOverride);
  line("skippedConflicts", summary.skippedConflicts);
  line("errorRate", summary.errorRate);
  line("errorBudgetExceeded", summary.errorBudgetExceeded);
  line("canonicalMissing", summary.canonicalMissing);
  line("estateResolved", summary.estateResolved);
  line("estateUnresolved", summary.estateUnresolved);
  if (summary.databaseDelta) {
    const delta = summary.databaseDelta;
    line("newPairs", delta.newPairs);
    line("withdrawnPairs", delta.withdrawnPairs);
    line("reactivatedPairs", delta.reactivatedPairs);
    line("coveragePreview", delta.coveragePreview);
    line("crossSourceDuplicates", delta.crossSourceDuplicates ?? null);
    line("writerOwnedSeenPairs", delta.writerOwnedSeenPairs ?? null);
    line("dbPairs", `existing ${delta.existingPairs}, active ${delta.existingActivePairs}`);
  } else {
    line("databaseDelta", null);
  }
  if (summary.agentReport) {
    line(
      "agentBackfill",
      `matched ${summary.agentReport.matched}/${summary.agentReport.candidates}, ` +
        `written ${summary.agentReport.written}, skipped ${summary.agentReport.skippedExisting}`,
    );
  }
  if (summary.estateStatsReport) {
    line(
      "estateStats",
      `updated ${summary.estateStatsReport.updated}/${summary.estateStatsReport.estatesConsidered} ` +
        `estates considered`,
    );
  }
  line("errors", summary.errors.length);
  line("report", displayPath(path.join(reportDir, "summary.json")));

  if (prerequisiteFailure) {
    console.error("");
    console.error(
      `prerequisite failure [${prerequisiteFailure.kind ?? "unknown"}]: ${prerequisiteFailure.message ?? ""}`,
    );
    console.error(`actionable: ${prerequisiteFailure.actionable ?? ""}`);
  }
  if (summary.deactivationBlocked === "DISCOVERY_TOO_SMALL") {
    console.warn(
      "warning: discovery saw fewer than 300 listing ids; withdrawal inference is blocked for this run.",
    );
  }
  if (summary.deactivationBlocked === "DISCOVERY_COVERAGE_TOO_LOW") {
    console.warn(
      `warning: the database refused the withdrawal sweep (coverage ${
        summary.deactivationCoverage ?? "?"
      }); review the report before forcing anything.`,
    );
  }
  if (summary.errorBudgetExceeded === true) {
    console.warn(
      "warning: the detail error budget was exceeded; no withdrawal inference is trusted.",
    );
  }
  if (summary.databaseDelta?.coverageWouldBlock) {
    console.warn(
      `warning: this discovery pass covers only ${summary.databaseDelta.coveragePreview} of the active ` +
        "inventory; an apply sweep would be refused by the coverage guard.",
    );
  }
  if (summary.coverageOverride === true) {
    console.warn(
      `warning: the withdrawal sweep ran with the 70% coverage guard OVERRIDDEN (coverage ${
        summary.deactivationCoverage ?? "?"
      }). This is only for the one-off initial reconciliation; review the report and never use ` +
        "--allow-low-coverage in the daily workflow.",
    );
  }
}

function resolveOrigin(environment = {}) {
  const raw = String(environment.OLD_SITE_ORIGIN ?? "").trim() || DEFAULT_ORIGIN;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SyncCliError(`OLD_SITE_ORIGIN is not a valid URL: ${raw}`, "invalid_origin");
  }
  if (url.protocol !== "https:") {
    throw new SyncCliError(
      `OLD_SITE_ORIGIN must be https (strict TLS is required): ${raw}`,
      "invalid_origin",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new SyncCliError(
      `OLD_SITE_ORIGIN must be an origin without path/query: ${raw}`,
      "invalid_origin",
    );
  }
  return url.origin;
}

async function loadEnvironmentFiles() {
  if (typeof process.loadEnvFile !== "function") return;
  for (const filename of [".env", ".env.local"]) {
    if (!existsSync(filename)) continue;
    try {
      process.loadEnvFile(filename);
    } catch {
      // A malformed local env file is not fatal: process.env still wins below.
    }
  }
}

/**
 * The database-free fake importer database used when dry-run has no database
 * URL. Nothing is read or written; the empty estate list keeps the resolver
 * path exercised but resolves no estates.
 */
function createDryRunDb() {
  return {
    async listEstates() {
      return [];
    },
    async listEstateIdsBySlug() {
      return new Map();
    },
    async upsertProperties(rows) {
      return { count: Array.isArray(rows) ? rows.length : 0 };
    },
    async deactivateMissing() {
      return { count: 0 };
    },
  };
}

/**
 * Read-only view over the real MLS db adapter for dry-run: estate lookups hit
 * the real database (so estateResolved/estateUnresolved and the delta preview
 * are accurate) while the two write operations throw if anything ever calls
 * them. Dry-run must never write.
 */
export function createReadOnlyDb(mlsDb) {
  if (!mlsDb || typeof mlsDb.listEstates !== "function") {
    throw new TypeError("createReadOnlyDb requires the MLS db adapter");
  }
  return {
    listEstates: () => mlsDb.listEstates(),
    listEstateIdsBySlug: () =>
      typeof mlsDb.listEstateIdsBySlug === "function" ? mlsDb.listEstateIdsBySlug() : new Map(),
    async upsertProperties() {
      throw new Error("dry_run_read_only: upsertProperties must not run in a dry run");
    },
    async deactivateMissing() {
      throw new Error("dry_run_read_only: deactivateMissing must not run in a dry run");
    },
  };
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const now = typeof overrides.now === "function" ? overrides.now : () => new Date();
  const startedAt = now();
  await loadEnvironmentFiles();
  const environment = overrides.environment ?? process.env;

  let options;
  try {
    options = parseArgs(argv, { environment });
  } catch (error) {
    console.error(`old-site-sync: ${messageOf(error)}`);
    console.error("old-site-sync: fix the command line or the OLD_SITE_* environment values.");
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.allowLowCoverage && !options.apply) {
    console.error(
      "old-site-sync: --allow-low-coverage is only valid with --apply (it exists for the one-off " +
        "initial reconciliation, not for dry runs); dry-run already previews coverage.",
    );
    return 2;
  }

  const runId = newRunId(startedAt);
  const mode = options.apply ? "apply" : "dry-run";
  const reportDir = options.reportDir
    ? path.resolve(options.reportDir)
    : path.resolve(REPORT_ROOT, runId);

  let sourceOrigin;
  try {
    sourceOrigin = options.fromDir
      ? `replay:${path.resolve(options.fromDir)}`
      : resolveOrigin(environment);
  } catch (error) {
    console.error(`old-site-sync: ${messageOf(error)}`);
    return 2;
  }

  const finish = async ({
    syncResult = null,
    syncError = null,
    postStepErrors = [],
    agentReport = null,
    estateStatsReport = null,
    databaseDelta = null,
    prerequisiteFailure = null,
  }) => {
    const finishedAt = now();
    const summary = summarizeRun({
      runId,
      mode,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
      sourceOrigin,
      syncResult,
      syncError,
      postStepErrors,
      agentReport,
      estateStatsReport,
      databaseDelta,
    });
    let reportError = null;
    try {
      await writeJsonFile(path.join(reportDir, "summary.json"), summary);
      await writeJsonFile(path.join(reportDir, "errors.json"), {
        runId,
        generatedAt: summary.finishedAt,
        count: summary.errors.length,
        errors: summary.errors,
      });
      if (Array.isArray(syncResult?.conflicts) && syncResult.conflicts.length) {
        await writeJsonFile(path.join(reportDir, "conflicts.json"), {
          runId,
          generatedAt: summary.finishedAt,
          count: syncResult.conflicts.length,
          conflicts: syncResult.conflicts,
        });
      }
    } catch (error) {
      reportError = error;
      console.error(`old-site-sync: failed to write the run report: ${messageOf(error)}`);
    }
    printHumanSummary(summary, { reportDir, prerequisiteFailure });
    const ok =
      prerequisiteFailure === null &&
      reportError === null &&
      syncError === null &&
      postStepErrors.length === 0 &&
      summary.errorBudgetExceeded !== true &&
      summary.deactivationBlocked !== "DISCOVERY_TOO_SMALL" &&
      // An apply run whose sweep the coverage guard refused is NOT a success:
      // the inventory would silently keep the stale rows.
      !(
        summary.mode === "apply" &&
        summary.deactivationBlocked === "DISCOVERY_COVERAGE_TOO_LOW" &&
        summary.coverageOverride !== true
      );
    return exitCodeFor({ ok, prerequisiteFailure });
  };

  let importerModule;
  try {
    importerModule = await import(IMPORTER_URL.href);
  } catch (error) {
    return finish({
      prerequisiteFailure: {
        kind: "configuration",
        code: "importer_unavailable",
        message: `cannot load src/lib/mls/importer.mjs: ${messageOf(error)}`,
        actionable: `The core lib is missing or broken; check ${displayPath("src/lib/mls/importer.mjs")}.`,
      },
    });
  }

  let fetchText;
  if (options.fromDir) {
    try {
      const index = await loadReplayIndex(options.fromDir);
      const seedUrls = Array.isArray(importerModule.DEFAULT_SEED_URLS)
        ? importerModule.DEFAULT_SEED_URLS
        : [];
      if (seedUrls.length) {
        const availableKeys = Object.keys(index);
        const hasSeed = seedUrls.some((seed) =>
          replayCandidates(String(seed)).some((candidate) => availableKeys.includes(candidate)),
        );
        if (!hasSeed) {
          throw new SyncCliError(
            `replay index in ${options.fromDir} has no captured listing seed page ` +
              `(expected one of: ${seedUrls.join(", ")})`,
            "invalid_replay_dir",
          );
        }
      }
      fetchText = buildReplayFetchText(index, { rootDir: options.fromDir });
      console.log(
        `replay mode: ${index && Object.keys(index).length} captured pages in ${options.fromDir}`,
      );
    } catch (error) {
      if (error instanceof SyncCliError) {
        return finish({
          prerequisiteFailure: {
            kind: "configuration",
            code: error.code,
            message: messageOf(error),
            actionable:
              "Capture the replay directory with a full pass (index.json must map every fetched URL " +
              "to a relative file) and pass --from-dir again.",
          },
        });
      }
      return finish({ syncError: error });
    }
  } else {
    const hardenedFactory =
      typeof importerModule.createHardenedFetchText === "function"
        ? importerModule.createHardenedFetchText
        : null;
    fetchText =
      hardenedFactory !== null
        ? hardenedFactory({ timeoutMs: options.timeoutMs })
        : (importerModule.defaultFetchText ?? null);
    if (typeof fetchText !== "function") {
      return finish({
        prerequisiteFailure: {
          kind: "configuration",
          code: "fetch_unavailable",
          message: "src/lib/mls/importer.mjs exports no createHardenedFetchText/defaultFetchText",
          actionable: "Restore the hardened fetch helper in the importer module.",
        },
      });
    }
    try {
      const html = await fetchText(`${sourceOrigin}/property/`);
      const classification = classifyPreflightHtml(html);
      if (!classification.ok) {
        return finish({
          prerequisiteFailure: {
            kind: classification.kind,
            code: classification.code,
            message: classification.message,
            actionable:
              classification.kind === "challenge" ? CHALLENGE_MESSAGE : UNEXPECTED_HTML_MESSAGE,
          },
        });
      }
      console.log(
        `preflight ok: ${sourceOrigin}/property/ (${classification.detailLinks} listing links)`,
      );
    } catch (error) {
      const failure = detectPrerequisiteFailure(error);
      if (!failure) {
        console.error(`old-site-sync: preflight failed unexpectedly: ${messageOf(error)}`);
        return finish({ syncError: error });
      }
      return finish({ prerequisiteFailure: failure, syncError: error });
    }
  }

  let sql = null;
  let db;
  const databaseUrl = environment.DATABASE_URL_UNPOOLED || environment.DATABASE_URL || null;
  if (options.apply) {
    try {
      const neonDb = await import(NEON_DB_URL.href);
      sql = neonDb.createNeonSqlFromEnv();
      db = neonDb.createNeonMlsDb(sql);
    } catch (error) {
      return finish({
        prerequisiteFailure: {
          kind: "configuration",
          code: "database_unavailable",
          message: messageOf(error),
          actionable:
            "Set DATABASE_URL_UNPOOLED (or DATABASE_URL) for --apply runs; dry-run needs no database.",
        },
      });
    }
  } else if (databaseUrl) {
    // Dry-run reads the database READ-ONLY when one is configured: accurate
    // estate resolution for the rows (and so for the databaseDelta preview) is
    // the evidence operators review before the first apply. Writes throw.
    try {
      const neonDb = await import(NEON_DB_URL.href);
      sql = neonDb.createNeonSqlFromEnv();
      db = createReadOnlyDb(neonDb.createNeonMlsDb(sql));
      console.log("dry-run: database read-only enabled (estate mapping + databaseDelta preview)");
    } catch (error) {
      sql = null;
      db = createDryRunDb();
      console.warn(
        `dry-run: could not open the database read-only (${messageOf(error)}); ` +
          "continuing without estate mapping/databaseDelta.",
      );
    }
  } else {
    db = createDryRunDb();
  }

  if (sql) {
    // Fail fast with a database-specific prerequisite. Without this ping the
    // importer's first query throws inside sync() and a Neon connection error
    // reads like an old-site network failure.
    try {
      await sql`SELECT 1`;
    } catch (error) {
      return finish({
        syncError: error,
        prerequisiteFailure: detectDatabaseFailure(error) ?? {
          kind: "database",
          code: "database_unreachable",
          message: messageOf(error),
          actionable:
            "Check DATABASE_URL_UNPOOLED/DATABASE_URL and the database health; nothing was written.",
        },
      });
    }
  }

  const effectiveDelayMs = options.fromDir && !options.delayMsExplicit ? 0 : options.delayMs;
  const importer = importerModule.createMlsImporter({
    fetchText: createThrottledFetchText(fetchText, { delayMs: effectiveDelayMs }),
    db,
    now,
  });

  let syncResult;
  try {
    syncResult = await importer.sync({
      maxDetails: options.maxDetails,
      maxPages: options.maxPages,
      dryRun: !options.apply,
      allowLowCoverage: options.allowLowCoverage,
    });
  } catch (error) {
    const failure = detectDatabaseFailure(error) ?? detectPrerequisiteFailure(error);
    console.error(`old-site-sync: sync failed: ${messageOf(error)}`);
    return finish({ syncError: error, prerequisiteFailure: failure });
  }

  let agentReport = null;
  let estateStatsReport = null;
  let databaseDelta = null;
  const postStepErrors = [];

  if (!options.apply && sql) {
    // SELECT-only: readPropertyPairSnapshot is the single extra query of the
    // dry-run and computeDatabaseDelta is pure. A failure here leaves the
    // evidence gate incomplete, so it fails the run instead of reporting a
    // misleading "all clear".
    try {
      const propertiesRows = await readPropertyPairSnapshot(sql);
      databaseDelta = computeDatabaseDelta({
        propertiesRows,
        pairsSeen: syncResult.pairsSeen,
        discoveredLegacyIds: syncResult.discoveredLegacyIds,
        protectedLegacyIds: syncResult.protectedLegacyIds,
      });
      const dryRunRows = Array.isArray(syncResult.dryRunRows) ? syncResult.dryRunRows : [];
      if (dryRunRows.length) {
        const ownershipRows = await readListingNoOwnership(
          sql,
          dryRunRows.map((row) => row.listing_no),
        );
        const duplicates = computeCrossSourceDuplicates({
          dryRunRows,
          ownershipRows,
        });
        databaseDelta.crossSourceDuplicates = duplicates.length;
        databaseDelta.crossSourceDuplicateSample = duplicates.slice(0, 10);
      }
    } catch (error) {
      const databaseFailure = detectDatabaseFailure(error);
      if (databaseFailure) {
        return finish({ syncResult, prerequisiteFailure: databaseFailure, syncError: error });
      }
      postStepErrors.push({ url: "database-delta", message: messageOf(error) });
      console.error(`old-site-sync: database delta preview failed: ${messageOf(error)}`);
    }
  }

  if (options.apply) {
    if (!options.skipAgents) {
      try {
        const agentsModule = await import(
          new URL("./backfill-old-site-agents.mjs", import.meta.url).href
        );
        agentReport = await agentsModule.runAgentBackfill({
          sql,
          dryRun: false,
          reportPath: path.join(AGENT_REPORT_ROOT, `${runId}.json`),
        });
      } catch (error) {
        postStepErrors.push({ url: "post-step:agents", message: messageOf(error) });
        console.error(`old-site-sync: agent backfill failed: ${messageOf(error)}`);
      }
    }
    if (!options.skipEstateStats) {
      try {
        const estateStatsModule = await import(
          new URL("./refresh-estate-stats.mjs", import.meta.url).href
        );
        estateStatsReport = await estateStatsModule.runEstateStatsRefresh({
          sql,
          dryRun: false,
          reportPath: path.join(ESTATE_STATS_REPORT_ROOT, `${runId}.json`),
        });
      } catch (error) {
        postStepErrors.push({ url: "post-step:estate-stats", message: messageOf(error) });
        console.error(`old-site-sync: estate-stat refresh failed: ${messageOf(error)}`);
      }
    }
  }

  return finish({ syncResult, postStepErrors, agentReport, estateStatsReport, databaseDelta });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
