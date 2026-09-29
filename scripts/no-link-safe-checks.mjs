import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    cwd: repo,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

const safeEnv = Object.fromEntries(
  ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
safeEnv.OPS_EVENT_WAKE_ENABLED = "false";
safeEnv.AUDIT_REPO = repo;

const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
if (sha.status !== 0) throw new Error("Cannot identify the test checkout");
const head = sha.stdout.trim();
process.stdout.write(`no-link safe checks: HEAD=${head}; environment=allowlisted local process\n`);

const tests = [
  "webhook",
  "event-classification",
  "workflow",
  "assignment",
  "links",
  "composer",
].map((name) => `src/lib/whatsapp-enquiries/${name}.test.mjs`);
tests.push("src/lib/woztell/inbox-directory.test.mjs");
let code = run("node", ["--test", ...tests], safeEnv);

const probePath = process.argv[2];
if (probePath) {
  if (head !== "b1263bc06aef4d45891dd0b78380574292f70a4b") {
    throw new Error("The original defect probes are only valid against the audit baseline");
  }
  const probe = resolve(probePath);
  const digest = createHash("sha256").update(readFileSync(probe)).digest("hex");
  if (digest !== "d2e508b1ea3acc5fd87f3d56a7930380378a794ce223082736fdda7dec7a127e")
    throw new Error("Unexpected audit probe content");
  code ||= run("node", ["--test", probe], safeEnv);
}
process.exitCode = code;
