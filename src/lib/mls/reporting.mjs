import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const LISTINGS_HEADER = [
  "source",
  "external_id",
  "deal_type",
  "property_no",
  "match_key",
  "canonical_property_id",
  "decision",
  "changed_fields",
  "quarantine_reasons",
  "content_hash",
  "source_url",
];

export const OBSERVATIONS_HEADER = [
  "source",
  "external_id",
  "deal_type",
  "property_no",
  "title_zh",
  "title_en",
  "estate_slug",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "eligible_media_count",
  "source_updated_at",
  "validation_state",
  "quarantine_reasons",
  "content_hash",
  "source_url",
];

const OBSERVATION_FIELD_KEYS = [
  "title_zh",
  "title_en",
  "estate_slug",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
];

const DIAGNOSTIC_KEYS = [
  "sourceUrl",
  "responseStatus",
  "attempts",
  "templateFingerprint",
  "selectorCounts",
  "failureCode",
];

const SECRET_PATTERN =
  /\b(?:authorization|api[_-]?key|password|secret|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
const CONNECTION_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"'<>]+/gi;

function safeErrorText(value) {
  return String(value ?? "")
    .replace(
      /<([a-z][a-z0-9:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "[redacted_html_body]",
    )
    .replace(/<[^>]*>/g, "[redacted_html]")
    .replace(CONNECTION_PATTERN, "[redacted_connection]")
    .replace(SECRET_PATTERN, (match) => `${match.split(/[:=]/)[0]}=[redacted]`)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
}

function safeUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function jsonSafe(value, key = "") {
  if (typeof value === "string") {
    if (/url/i.test(key)) return safeUrl(value) ?? "[redacted_url]";
    return safeErrorText(value);
  }
  if (typeof value === "bigint")
    return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (
        /^(raw|html|body|headers|authorization|api[_-]?key|password|secret|token)$/i.test(
          childKey,
        )
      ) {
        continue;
      }
      result[childKey] = jsonSafe(childValue, childKey);
    }
    return result;
  }
  return value;
}

function dateForRun(run) {
  if (Object.hasOwn(run, "scheduledFor")) {
    if (
      typeof run.scheduledFor !== "string" ||
      !isValidDateText(run.scheduledFor)
    ) {
      throw new TypeError("scheduledFor must be YYYY-MM-DD");
    }
    return run.scheduledFor;
  }
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function isValidDateText(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part)))
    return false;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.toISOString().slice(0, 10) === value;
}

function requireSafeRunId(value) {
  if (
    typeof value !== "string" ||
    !RUN_ID_PATTERN.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new TypeError("run id is invalid");
  }
  return value;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("artifact path is outside artifact root");
  }
}

async function assertNotSymlink(target, label) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink())
    throw new Error("artifact path must not be a symlink: " + label);
  return stat;
}

async function assertExistingNotSymlink(target, label) {
  try {
    return await assertNotSymlink(target, label);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertSafeArtifactRoot(rootValue) {
  if (typeof rootValue !== "string" || !rootValue.trim()) {
    throw new TypeError("artifact root is required");
  }
  const root = path.resolve(rootValue);
  if (root === path.parse(root).root) throw new Error("unsafe artifact root");
  const cwd = path.resolve(process.cwd());
  if (root === cwd || root === path.dirname(cwd))
    throw new Error("unsafe artifact root");
  if (root.split(path.sep).some((part) => part === ".git"))
    throw new Error("unsafe artifact root");
  return root;
}

export function validateArtifactRoot(root) {
  return assertSafeArtifactRoot(root);
}

function csvValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return safeErrorText(value.join(";"));
  if (typeof value === "object") return safeErrorText(JSON.stringify(value));
  return safeErrorText(String(value));
}

export function toCsvCell(value) {
  let text = csvValue(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function safeCsvUrl(value) {
  if (value == null || value === "") return "";
  return safeUrl(value) ?? "[redacted_url]";
}

function csvRow(values) {
  return values.map(toCsvCell).join(",");
}

function proposalRows(run) {
  const proposals = Array.isArray(run.proposals) ? run.proposals : [];
  return proposals.flatMap((proposal) => {
    const links =
      Array.isArray(proposal.links) && proposal.links.length
        ? proposal.links
        : [null];
    const changedFields = Array.isArray(proposal.fields)
      ? proposal.fields
          .filter((field) => field?.changed !== false)
          .map((field) => field.fieldName)
      : [];
    const reasons = Array.isArray(proposal.quarantineReasons)
      ? proposal.quarantineReasons
      : [];
    return links.map((link) => [
      link?.source ?? "",
      link?.externalId ?? "",
      link?.dealType ?? proposal.canonical?.deal_type ?? "",
      proposal.canonical?.canonical_property_no ??
        proposal.canonical?.legacy_property_no ??
        "",
      link?.matchKey ?? "",
      proposal.propertyId ?? "",
      proposal.kind ?? run.status ?? "",
      changedFields,
      reasons,
      proposal.canonical?.content_hash ?? "",
      safeCsvUrl(link?.sourceUrl),
    ]);
  });
}

function observationRows(run) {
  const observations = Array.isArray(run.observations) ? run.observations : [];
  return observations.map((observation) => {
    const fields = observation.fields ?? {};
    const eligibleMediaCount = Array.isArray(observation.mediaCandidates)
      ? observation.mediaCandidates.filter(
          (candidate) =>
            candidate?.category === "listing_photo" &&
            candidate?.rejected !== true,
        ).length
      : 0;
    return [
      observation.source,
      observation.externalId,
      observation.dealType,
      observation.propertyNoNormalized ?? observation.propertyNoRaw,
      ...OBSERVATION_FIELD_KEYS.map((key) => fields[key] ?? ""),
      eligibleMediaCount,
      observation.sourceUpdatedAt ?? "",
      observation.validationState ?? "",
      observation.quarantineReasons ?? [],
      observation.contentHash ?? "",
      safeCsvUrl(observation.sourceUrl),
    ];
  });
}

function diagnosticsFor(run) {
  const sourceStatus = run.evaluation?.sourceStatus ?? run.sourceStatus ?? {};
  const diagnostics = [];
  const topLevelDiagnostics = Array.isArray(run.diagnostics)
    ? run.diagnostics
    : [];
  for (const item of topLevelDiagnostics) {
    const diagnostic = item && typeof item === "object" ? item : {};
    diagnostics.push(
      Object.fromEntries(
        DIAGNOSTIC_KEYS.map((key) => [
          key,
          key === "sourceUrl"
            ? (safeUrl(diagnostic[key]) ?? "[redacted_url]")
            : jsonSafe(diagnostic[key], key),
        ]),
      ),
    );
  }
  for (const status of Object.values(sourceStatus)) {
    for (const item of Array.isArray(status?.diagnostics)
      ? status.diagnostics
      : []) {
      const diagnostic = item && typeof item === "object" ? item : {};
      diagnostics.push(
        Object.fromEntries(
          DIAGNOSTIC_KEYS.map((key) => [
            key,
            key === "sourceUrl"
              ? (safeUrl(diagnostic[key]) ?? "[redacted_url]")
              : jsonSafe(diagnostic[key], key),
          ]),
        ),
      );
    }
    for (const failure of Array.isArray(status?.failures)
      ? status.failures
      : []) {
      diagnostics.push({
        code: failure.code ?? "source_failure",
        detail: safeErrorText(failure.detail),
      });
    }
  }
  return diagnostics;
}

async function atomicWrite(directory, name, content) {
  const target = path.join(directory, name);
  assertInside(directory, target);
  const temporary = path.join(
    directory,
    `.${name}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}

function artifactObject(name, body, contentType) {
  return Object.freeze({
    name,
    body,
    contentType,
    byteLength: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}

export function buildRunArtifactObjects(run) {
  if (!run || typeof run !== "object") throw new TypeError("run is required");
  const safeRun = jsonSafe({
    runId: run.runId,
    scheduledFor: run.scheduledFor ?? dateForRun(run),
    mode: run.mode,
    status: run.status,
    evaluation: run.evaluation,
    gate: run.gate,
    counts: run.counts,
    quarantines: run.quarantines,
    proposals: run.proposals,
    failureCode: run.failureCode,
    failureSummary: run.failureSummary,
  });
  const listings = `${[csvRow(LISTINGS_HEADER), ...proposalRows(run).map(csvRow)].join("\n")}\n`;
  const observations = `${[
    csvRow(OBSERVATIONS_HEADER),
    ...observationRows(run).map(csvRow),
  ].join("\n")}\n`;
  return Object.freeze([
    artifactObject(
      "report.json",
      `${JSON.stringify(safeRun, null, 2)}\n`,
      "application/json; charset=utf-8",
    ),
    artifactObject("listings.csv", listings, "text/csv; charset=utf-8"),
    artifactObject("observations.csv", observations, "text/csv; charset=utf-8"),
    artifactObject(
      "diagnostics.json",
      `${JSON.stringify(jsonSafe(diagnosticsFor(run)), null, 2)}\n`,
      "application/json; charset=utf-8",
    ),
  ]);
}

export async function writeRunArtifacts({ root, run }) {
  const resolvedRoot = assertSafeArtifactRoot(root);
  if (!run || typeof run !== "object") throw new TypeError("run is required");
  const date = dateForRun(run);
  if (!DATE_PATTERN.test(date))
    throw new TypeError("scheduledFor must be YYYY-MM-DD");
  const runId = requireSafeRunId(run.runId);
  const dateDirectory = path.join(resolvedRoot, date);
  const runDirectory = path.join(dateDirectory, runId);
  assertInside(resolvedRoot, dateDirectory);
  assertInside(resolvedRoot, runDirectory);
  await assertExistingNotSymlink(resolvedRoot, "artifact root");
  await assertExistingNotSymlink(dateDirectory, "artifact date directory");
  await assertExistingNotSymlink(runDirectory, "artifact run directory");
  await mkdir(runDirectory, { recursive: true });
  await assertNotSymlink(resolvedRoot, "artifact root");
  await assertNotSymlink(dateDirectory, "artifact date directory");
  await assertNotSymlink(runDirectory, "artifact run directory");

  const written = new Map(
    await Promise.all(
      buildRunArtifactObjects(run).map(async (artifact) => [
        artifact.name,
        await atomicWrite(runDirectory, artifact.name, artifact.body),
      ]),
    ),
  );
  return {
    directory: runDirectory,
    json: written.get("report.json"),
    listingsCsv: written.get("listings.csv"),
    observationsCsv: written.get("observations.csv"),
    diagnostics: written.get("diagnostics.json"),
  };
}

export function createFilesystemReporter({ root }) {
  return {
    writeRunArtifacts(run) {
      return writeRunArtifacts({ root, run });
    },
  };
}

export function logRunEvent(event) {
  const input = jsonSafe(event ?? {});
  const safe = {
    timestamp: new Date().toISOString(),
    level: typeof input.level === "string" ? input.level : "info",
    event: typeof input.event === "string" ? input.event : "mls_run",
    runId: typeof input.runId === "string" ? input.runId : null,
    source: typeof input.source === "string" ? input.source : null,
    code: typeof input.code === "string" ? input.code : null,
    counts: {},
  };
  const counts = Object.fromEntries(
    Object.entries(input.counts ?? {}).filter(([, value]) =>
      Number.isFinite(value),
    ),
  );
  process.stdout.write(JSON.stringify({ ...safe, counts }) + "\n");
}

export async function pruneArtifacts({
  root,
  now = new Date(),
  retentionDays = 90,
}) {
  const resolvedRoot = assertSafeArtifactRoot(root);
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()))
    throw new TypeError("now is invalid");
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  ) {
    throw new RangeError("retentionDays is invalid");
  }
  let rootStat;
  try {
    rootStat = await assertNotSymlink(resolvedRoot, "artifact root");
  } catch (error) {
    if (error?.code === "ENOENT") return { removed: [] };
    throw error;
  }
  if (!rootStat.isDirectory())
    throw new Error("artifact root must be a directory");
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const dateEntry of await readdir(resolvedRoot, {
    withFileTypes: true,
  })) {
    const dateDirectory = path.join(resolvedRoot, dateEntry.name);
    assertInside(resolvedRoot, dateDirectory);
    const dateStat = await assertNotSymlink(
      dateDirectory,
      "artifact date directory",
    );
    if (!dateStat.isDirectory()) continue;
    if (!DATE_PATTERN.test(dateEntry.name))
      throw new Error("unsafe artifact directory");
    if (!isValidDateText(dateEntry.name))
      throw new Error("unsafe artifact directory");
    const dateTime = Date.parse(dateEntry.name + "T00:00:00.000Z");
    for (const runEntry of await readdir(dateDirectory, {
      withFileTypes: true,
    })) {
      const runDirectory = path.join(dateDirectory, runEntry.name);
      assertInside(resolvedRoot, runDirectory);
      const runStat = await assertNotSymlink(
        runDirectory,
        "artifact run directory",
      );
      if (!runStat.isDirectory()) continue;
      if (!UUID_PATTERN.test(runEntry.name))
        throw new Error("unsafe artifact run directory");
      if (dateTime < cutoff) {
        await rm(runDirectory, { recursive: true, force: true });
        removed.push(runDirectory);
      }
    }
  }
  return { removed };
}
