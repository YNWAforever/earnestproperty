/**
 * Offline only:
 * bun --no-env-file scripts/youtube-sync-preview.ts --uploads uploads.json \
 *   --inventory inventory.json --json preview.json --markdown preview.md
 *
 * uploads.json: { channel: { id, verified, capturedAt, complete, synthetic },
 *   uploads: YouTubePreviewUpload[], boundaryVideoId: string | null }
 * inventory.json: { rows: YouTubeInventoryRow[], capturedAt, complete,
 *   scope: "full_db" | "public_only" | "unknown", synthetic }
 *
 * Types live in youtube-preview.ts. Unknown descriptions and row states are null.
 * No credentials, environment configuration, provider or repository imports.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import {
  previewYouTubeBackfill,
  type YouTubeBackfillPreview,
} from "../src/lib/youtube-sync/youtube-preview";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const FLAGS = ["--uploads", "--inventory", "--json", "--markdown"] as const;
type Flag = (typeof FLAGS)[number];
const USAGE =
  "bun --no-env-file scripts/youtube-sync-preview.ts --uploads <uploads.json> --inventory <inventory.json> --json <new-preview.json> --markdown <new-preview.md>";

function localPath(value: string): string {
  if (
    !value ||
    /^[/\\]{2}/.test(value) ||
    (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[/\\]/i.test(value))
  ) {
    throw new Error("Only local filesystem paths are allowed");
  }
  // Reject Windows alternate streams as well as remote and device paths.
  if (value.replace(/^[a-z]:/i, "").includes(":"))
    throw new Error("Only ordinary local filesystem paths are allowed");
  return resolve(value);
}

function parseArgs(args: string[]): Record<Flag, string> {
  const options = new Map<Flag, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] as Flag;
    if (!FLAGS.includes(flag)) throw new Error(`Unsupported option: ${args[index]}`);
    if (options.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing file path for ${flag}`);
    options.set(flag, localPath(value));
  }
  for (const flag of FLAGS) {
    if (!options.has(flag)) throw new Error(`Required option: ${flag}. Usage: ${USAGE}`);
  }
  return Object.fromEntries(options) as Record<Flag, string>;
}

function readJson(path: string): unknown {
  if (extname(path).toLowerCase() !== ".json")
    throw new Error("Input must be an explicit JSON file");
  const resolved = localPath(realpathSync(path));
  const fd = openSync(resolved, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Input must be a regular JSON file");
    if (stat.size > MAX_FILE_BYTES) throw new Error("Input file size limit exceeded (16 MiB)");
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE_BYTES + 1));
    let total = 0;
    while (total < bytes.length) {
      const read = readSync(fd, bytes, total, bytes.length - total, null);
      if (read === 0) break;
      total += read;
    }
    if (total > stat.size)
      throw new Error("Input file changed during read; capture stable evidence first");
    return JSON.parse(
      bytes
        .subarray(0, total)
        .toString("utf8")
        .replace(/^\uFEFF/, ""),
    );
  } finally {
    closeSync(fd);
  }
}

function outputPath(path: string): string {
  // Resolve the existing parent to catch aliases and remote junction targets.
  const parent = localPath(realpathSync(dirname(path)));
  const resolved = join(parent, basename(path));
  if (existsSync(resolved))
    throw new Error("Output file already exists; choose new evidence paths");
  return resolved;
}

function jsonBlock(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}json\n${text}\n${fence}`;
}

function markdown(report: YouTubeBackfillPreview): string {
  const lines = [
    "# Offline YouTube backfill preview",
    "",
    report.synthetic
      ? "**SYNTHETIC SAMPLE: no live verification.**"
      : "**Supplied file evidence; not independently verified.**",
    "",
    `Channel: ${report.channelId}`,
    "",
    `Channel capture: ${report.evidence.channel.capturedAt}; complete: ${report.evidence.channel.complete}.`,
    "",
    `Inventory capture: ${report.evidence.inventory.capturedAt}; scope: ${report.evidence.inventory.scope}; complete DB inventory: ${report.inventoryIsComplete}.`,
    "",
    "Counts describe conditional comparisons of supplied rows. Exact writes: unknown.",
    "",
    "| Classification | Count |",
    "| --- | ---: |",
    ...Object.entries(report.counts).map(([kind, count]) => `| ${kind} | ${count} |`),
    "",
    "## Evidence limits",
    "",
    ...report.warnings.map((warning) => `- ${warning}`),
    "",
    "## Boundary and targeted backfill",
    "",
    jsonBlock({
      boundary: report.boundary,
      targetedBackfillIds: report.targetedBackfillIds,
      unmatchedInventoryRowIds: report.unmatchedInventoryRowIds,
    }),
    "",
  ];
  for (const entry of report.entries) {
    lines.push(
      `## ${entry.videoId}: ${entry.classification}`,
      "",
      "### Existing evidence",
      "",
      jsonBlock(entry.existingEvidence),
      "",
      "### Candidate evidence",
      "",
      jsonBlock(entry.candidateEvidence),
      "",
      "### Conditional proposed values and Expected publication",
      "",
      jsonBlock({
        proposed: entry.proposed,
        expectedPublication: entry.expectedPublication,
        changeFields: entry.changeFields,
        olderThanBoundary: entry.olderThanBoundary,
        uncertainties: entry.uncertainties,
      }),
      "",
    );
  }
  return lines.join("\n");
}

function writeOutputs(
  jsonPath: string,
  markdownPath: string,
  report: YouTubeBackfillPreview,
): void {
  const created: { path: string; fd: number }[] = [];
  try {
    for (const path of [jsonPath, markdownPath]) created.push({ path, fd: openSync(path, "wx") });
    writeFileSync(created[0].fd, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(created[1].fd, markdown(report), "utf8");
  } catch (error) {
    for (const file of created) {
      closeSync(file.fd);
      unlinkSync(file.path);
    }
    throw error;
  }
  for (const file of created) closeSync(file.fd);
}

function main(args: string[]): void {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      `${USAGE}\nUploads file: {channel:{id,verified,capturedAt,complete,synthetic},uploads,boundaryVideoId}\nInventory file: {rows,capturedAt,complete,scope:full_db|public_only|unknown,synthetic}\nOnly local files. Outputs must be new; each input <=16 MiB and <=10000 rows.\n`,
    );
    return;
  }
  const options = parseArgs(args);
  const jsonPath = outputPath(options["--json"]);
  const markdownPath = outputPath(options["--markdown"]);
  if (jsonPath.toLowerCase() === markdownPath.toLowerCase())
    throw new Error("Output paths must be distinct");
  const uploads = readJson(options["--uploads"]);
  if (!uploads || typeof uploads !== "object" || Array.isArray(uploads))
    throw new Error("Invalid uploads JSON object");
  const report = previewYouTubeBackfill({
    ...uploads,
    inventory: readJson(options["--inventory"]),
  });
  writeOutputs(jsonPath, markdownPath, report);
  process.stdout.write(
    "Offline preview JSON and Markdown written; no writes were executed against a database.\n",
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `Offline preview failed: ${error instanceof Error ? error.message : "Invalid input"}\n`,
  );
  process.exitCode = 1;
}
