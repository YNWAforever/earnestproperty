import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

// FX-05b: only live website intake may enqueue a staff lead alert. Backfills,
// imports and reconciles create leads without alerting staff about old history.
const root = process.cwd();
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", ".output", ".vercel"]);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const rel = (file) => relative(root, file).split(sep).join("/");
const sourceFiles = (dirs, pattern) =>
  dirs.flatMap((d) => walk(join(root, d))).filter((f) => pattern.test(f));

const ALLOWLISTED_IMPORTERS = ["src/lib/neon/website-inquiry.js"];
// The handler and job registry import only the job-type constants to run the job.
const CONSTANT_CONSUMERS = new Set([
  "src/lib/whatsapp-enquiries/lead-alert.server.ts",
  "src/lib/control-plane/job-handlers.server.ts",
]);
const EXTEND_MESSAGE =
  "Only live website intake may enqueue a lead alert. FX-02 (WhatsApp inbound), FX-05c and FX-09 extend this allowlist deliberately in their own batches; a backfill or import must never import it.";

test("only allowlisted intake modules import the enqueue fragment", () => {
  const importers = sourceFiles(["src", "scripts"], /\.(?:[cm]?[jt]sx?)$/)
    .filter((f) => !/lead-alert-enqueue\.(?:js|d\.ts)$/.test(f))
    .filter((f) => !/\.test\.[cm]?[jt]sx?$/.test(f))
    .filter((f) =>
      /from\s+["'][^"']*lead-alert-enqueue(?:\.js)?["']|import\(\s*["'][^"']*lead-alert-enqueue/.test(
        readFileSync(f, "utf8"),
      ),
    )
    .map(rel)
    .filter((f) => !CONSTANT_CONSUMERS.has(f))
    .sort();
  assert.deepEqual(importers, ALLOWLISTED_IMPORTERS, EXTEND_MESSAGE);
});

test("no script or migration spells the alert job type outside the handler and registry", () => {
  const allowed = new Set([
    "src/lib/neon/lead-alert-enqueue.js",
    "src/lib/neon/lead-alert-enqueue.d.ts",
    "src/lib/whatsapp-enquiries/lead-alert.server.ts",
    "src/lib/control-plane/job-handlers.server.ts",
  ]);
  const offenders = sourceFiles(["scripts", "neon/migrations"], /\.(?:[cm]?[jt]sx?|sql)$/)
    .filter((f) => !/\.test\.[cm]?[jt]sx?$/.test(f))
    .map(rel)
    .filter((f) => !allowed.has(f))
    .filter((f) => readFileSync(join(root, f), "utf8").includes("lead.staff.alert"));
  assert.deepEqual(offenders, [], EXTEND_MESSAGE);
});
