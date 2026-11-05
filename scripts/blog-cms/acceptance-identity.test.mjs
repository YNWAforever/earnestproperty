import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  captureIdentity,
  recordSuccessfulBuild,
  verifyBuildReceipt,
  receiptPath,
} from "./acceptance-identity.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "task8-binding-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), "task8-binding-")));
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "--quiet", root]); // No commits, including in fixture repositories.
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put(".gitignore", ".output/\n.audit/\nnode_modules/\n.env*\n.npmrc\npublic/ignored.local\n");
  for (const path of [
    "src/app.ts",
    "public/image.svg",
    "public/ignored.local",
    "bunfig.toml",
    "eslint.config.js",
    "playwright.config.ts",
    "playwright.admin-owned.config.ts",
    "tsconfig.json",
    "vite.config.ts",
    "vercel.ts",
    "wrangler.jsonc",
    "components.json",
    ".prettierrc",
    ".npmrc",
    ".gitattributes",
    "package.json",
    "package-lock.json",
    "ops/config.json",
    "workers/app.ts",
  ])
    put(path, path + " original");
  const build = () => {
    put(".output/nitro.json", '{"preset":"node-server"}');
    put(".output/server/index.mjs", "// fixture artifact, not an actual build");
    put(".output/public/image.svg", "fixture asset");
    return { status: 0 };
  };
  return { root, put, build };
}

test("identity covers public assets and every existing root build/test/config input", (t) => {
  const { root, put } = fixture(t);
  const original = captureIdentity(root);
  for (const path of [
    "public/image.svg",
    "public/ignored.local",
    "bunfig.toml",
    "eslint.config.js",
    "playwright.config.ts",
    "vercel.ts",
    "wrangler.jsonc",
    ".prettierrc",
    ".npmrc",
    "ops/config.json",
    "workers/app.ts",
  ]) {
    assert.ok(original.files[path], path);
    put(path, "changed");
    assert.notEqual(captureIdentity(root).sourceSha256, original.sourceSha256, path);
    put(path, path + " original");
  }
  put("docs/superpowers/evidence/blog-cms/acceptance.md", "mutable report");
  assert.equal(captureIdentity(root).sourceSha256, original.sourceSha256);
});

test("only a successful stable-source build creates a usable receipt; failed rebuild invalidates the old receipt", async (t) => {
  const { root, put, build } = fixture(t);
  assert.throws(() => verifyBuildReceipt(root), /RECEIPT_MISSING/);
  await recordSuccessfulBuild(root, build);
  await assert.rejects(
    recordSuccessfulBuild(root, () => ({ status: 0 })),
    /OUTPUT_MISSING/,
  );
  assert.throws(() => verifyBuildReceipt(root), /RECEIPT_MISSING/);
  const receipt = await recordSuccessfulBuild(root, build);
  assert.equal(receipt.exitCode, 0);
  const binding = verifyBuildReceipt(root);
  assert.equal(binding.sourceSha256, receipt.sourceSha256);
  assert.equal(binding.builtSha256, receipt.builtSha256);
  await assert.rejects(
    recordSuccessfulBuild(root, () => ({ status: 7 })),
    /BUILD_FAILED/,
  );
  assert.throws(() => verifyBuildReceipt(root), /RECEIPT_MISSING/);
  await assert.rejects(
    recordSuccessfulBuild(root, () => {
      put("src/app.ts", "changed during build");
      return build();
    }),
    /SOURCE_CHANGED_DURING_BUILD/,
  );
  assert.throws(() => verifyBuildReceipt(root), /RECEIPT_MISSING/);
});

test("preflight rejects stale source, edited/deleted/new output and invalid receipt, while evidence append is allowed", async (t) => {
  const { root, put, build } = fixture(t);
  await recordSuccessfulBuild(root, build);
  put("docs/superpowers/evidence/blog-cms/acceptance.md", "append evidence");
  verifyBuildReceipt(root);
  put("public/image.svg", "changed asset");
  assert.throws(() => verifyBuildReceipt(root), /SOURCE_MISMATCH/);
  put("public/image.svg", "public/image.svg original");
  put(".output/server/index.mjs", "tampered");
  assert.throws(() => verifyBuildReceipt(root), /OUTPUT_MISMATCH/);
  build();
  rmSync(join(root, ".output/public/image.svg"));
  assert.throws(() => verifyBuildReceipt(root), /OUTPUT_MISMATCH/);
  build();
  put(".output/server/unexpected.mjs", "extra artifact");
  assert.throws(() => verifyBuildReceipt(root), /OUTPUT_MISMATCH/);
  rmSync(join(root, ".output/server/unexpected.mjs"));
  const receipt = JSON.parse(readFileSync(receiptPath(root), "utf8"));
  writeFileSync(receiptPath(root), JSON.stringify({ ...receipt, exitCode: 1 }));
  assert.throws(() => verifyBuildReceipt(root), /RECEIPT_INVALID/);
});

test("build/preflight refuses dotenv even when ignored, and incomplete output cannot be certified", async (t) => {
  const { root, put, build } = fixture(t);
  await recordSuccessfulBuild(root, build);
  put(".env.production.local", "DUMMY_ONLY=1");
  assert.throws(() => verifyBuildReceipt(root), /ENV_FILE/);
  await assert.rejects(recordSuccessfulBuild(root, build), /ENV_FILE/);
  rmSync(join(root, ".env.production.local"));
  rmSync(join(root, ".output/server/index.mjs"));
  await assert.rejects(
    recordSuccessfulBuild(root, () => ({ status: 0 })),
    /OUTPUT_MISSING/,
  );
});

test("actual HTTP runner rejects stale source and output before Docker/server/browser initialization", async (t) => {
  const { root, put, build } = fixture(t);
  await recordSuccessfulBuild(root, build);
  put("bunfig.toml", "stale input");
  const child = spawnSync(process.execPath, [join(repoRoot, "scripts/test-blog-cms-http.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /SOURCE_MISMATCH/);
  assert.doesNotMatch(child.stdout, /HTTP server ready|owned-db|BUILD_BINDING/);
  put("bunfig.toml", "bunfig.toml original");
  put(".output/server/index.mjs", "tampered output");
  const outputChild = spawnSync(
    process.execPath,
    [join(repoRoot, "scripts/test-blog-cms-http.mjs")],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(outputChild.status, 1, outputChild.stderr);
  assert.match(outputChild.stderr, /OUTPUT_MISMATCH/);
  assert.doesNotMatch(outputChild.stdout, /HTTP server ready|owned-db|BUILD_BINDING/);
});
