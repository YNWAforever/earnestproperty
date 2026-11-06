// Content identity and successful-build binding for the uncommitted local candidate.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const receiptPath = (root) => join(root, ".audit/blog-cms/build-receipt.json");
const excluded = (path) =>
  /^(docs\/|\.superpowers\/|\.audit(?:[-/]|$)|\.private-sync-evidence\/|\.task-logs\/)/.test(path);
const scope =
  "v2: all Git-visible files except documentation/evidence; all public assets and root build/config inputs, including ignored ones";

function walk(root, dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = (dir + "/" + entry.name).replaceAll("\\", "/");
    assert.ok(!entry.isSymbolicLink(), "BLOG_ACCEPTANCE_SYMLINK: " + path);
    return entry.isDirectory() ? walk(root, path) : [path];
  });
}
function filesMap(root, paths) {
  return Object.fromEntries(
    [...new Set(paths)].sort().map((path) => {
      assert.ok(!lstatSync(join(root, path)).isSymbolicLink(), "BLOG_ACCEPTANCE_SYMLINK: " + path);
      return [path, hash(readFileSync(join(root, path)))];
    }),
  );
}
function assertNoEnvFiles(root) {
  assert.ok(
    !readdirSync(root).some((name) => name.startsWith(".env") && name !== ".env.example"),
    "BLOG_ACCEPTANCE_ENV_FILE",
  );
}
export function captureIdentity(root = process.cwd()) {
  root = resolve(root);
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const paths = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter((path) => path && !excluded(path));
  // Vite copies public/ even when a file is gitignored. Root configs likewise remain inputs.
  if (existsSync(join(root, "public"))) paths.push(...walk(root, "public"));
  paths.push(
    ...readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          (/\.(?:[cm]?[jt]sx?|jsonc?|toml|ya?ml|html|css)$/.test(entry.name) ||
            /^\.(?:npmrc|nvmrc|node-version|gitattributes|gitignore|prettier.*|vercelignore)$/.test(
              entry.name,
            )),
      )
      .map((entry) => entry.name),
  );
  const files = filesMap(root, paths);
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8" });
  const built = existsSync(join(root, ".output/nitro.json"))
    ? filesMap(root, walk(root, ".output"))
    : null;
  // The diff is supplementary; the file map also covers untracked and ignored build inputs.
  const diff =
    head.status === 0
      ? git([
          "diff",
          "--binary",
          "HEAD",
          "--",
          ".",
          ":(exclude)docs",
          ":(exclude).audit*",
          ":(exclude).superpowers",
        ])
      : "";
  return {
    identityVersion: 2,
    head: head.status === 0 ? head.stdout.trim() : null,
    scope,
    sourceSha256: hash(JSON.stringify(files)),
    trackedDiffSha256: hash(diff),
    builtSha256: built ? hash(JSON.stringify(built)) : null,
    files,
    built,
  };
}

export function cleanBuildEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|OS)$/i.test(
        key,
      ),
    ),
  );
}

/** The injectable build port is used only by isolated fixture tests; CLI always runs npm build. */
export async function recordSuccessfulBuild(
  root = process.cwd(),
  runBuild = () =>
    spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: root,
      env: cleanBuildEnvironment(),
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: "inherit",
      timeout: 300000,
    }),
) {
  rmSync(receiptPath(root), { force: true }); // A failed rebuild cannot leave an earlier PASS receipt.
  assertNoEnvFiles(root);
  const before = captureIdentity(root);
  // Never certify a leftover artifact after a successful-but-no-output command.
  const outputDir = resolve(root, ".output");
  assert.equal(dirname(outputDir), resolve(root));
  assert.ok(
    !existsSync(outputDir) || !lstatSync(outputDir).isSymbolicLink(),
    "BLOG_ACCEPTANCE_SYMLINK",
  );
  rmSync(outputDir, { recursive: true, force: true });
  const result = await runBuild();
  assert.ok(
    !result.error && result.status === 0,
    "BLOG_ACCEPTANCE_BUILD_FAILED: exit=" + result.status,
  );
  const after = captureIdentity(root);
  assert.equal(
    after.sourceSha256,
    before.sourceSha256,
    "BLOG_ACCEPTANCE_SOURCE_CHANGED_DURING_BUILD",
  );
  assert.equal(after.head, before.head, "BLOG_ACCEPTANCE_SOURCE_CHANGED_DURING_BUILD");
  assert.ok(
    after.builtSha256 && existsSync(join(root, ".output/server/index.mjs")),
    "BLOG_ACCEPTANCE_OUTPUT_MISSING",
  );
  const receipt = {
    receiptVersion: 1,
    identityVersion: 2,
    command: "npm run build",
    exitCode: 0,
    environmentPolicy: "os-only-v1; no dotenv",
    nodeVersion: process.version,
    builtAt: new Date().toISOString(),
    head: after.head,
    sourceSha256: after.sourceSha256,
    trackedDiffSha256: after.trackedDiffSha256,
    builtSha256: after.builtSha256,
  };
  mkdirSync(dirname(receiptPath(root)), { recursive: true });
  writeFileSync(receiptPath(root), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  return receipt;
}

export function verifyBuildReceipt(root = process.cwd()) {
  assertNoEnvFiles(root);
  assert.ok(
    existsSync(receiptPath(root)),
    "BLOG_ACCEPTANCE_BUILD_RECEIPT_MISSING: run npm run acceptance:blog-cms:build",
  );
  const bytes = readFileSync(receiptPath(root));
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString());
  } catch {
    throw new Error("BLOG_ACCEPTANCE_BUILD_RECEIPT_INVALID");
  }
  assert.ok(
    receipt.receiptVersion === 1 &&
      receipt.identityVersion === 2 &&
      receipt.exitCode === 0 &&
      receipt.command === "npm run build" &&
      receipt.environmentPolicy === "os-only-v1; no dotenv" &&
      receipt.nodeVersion === process.version,
    "BLOG_ACCEPTANCE_BUILD_RECEIPT_INVALID",
  );
  const current = captureIdentity(root);
  assert.ok(
    receipt.head === current.head && receipt.sourceSha256 === current.sourceSha256,
    "BLOG_ACCEPTANCE_SOURCE_MISMATCH",
  );
  assert.ok(
    current.builtSha256 &&
      receipt.builtSha256 === current.builtSha256 &&
      existsSync(join(root, ".output/server/index.mjs")),
    "BLOG_ACCEPTANCE_OUTPUT_MISMATCH",
  );
  return {
    receiptSha256: hash(bytes),
    head: current.head,
    sourceSha256: current.sourceSha256,
    builtSha256: current.builtSha256,
    nodeVersion: process.version,
    builtAt: receipt.builtAt,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(captureIdentity(), null, 2));
