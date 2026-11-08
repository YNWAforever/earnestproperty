import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { approvalSchema, digest, sha256, validateApproval, validateInput } from "./hosted-contract";

try {
  const [mode, inputPath, approvalPath, output, reviewedApprovalHash, ...extra] =
    process.argv.slice(2);
  assert.ok(
    !extra.length && (mode === "validate" || mode === "execute"),
    "usage: validate INPUT | execute INPUT APPROVAL NEW_PRIVATE_OUTPUT REVIEWED_APPROVAL_FILE_SHA256",
  );
  assert.ok(inputPath, "explicit input file required; no environment discovery");
  const input = validateInput(JSON.parse(readFileSync(inputPath, "utf8")));
  if (mode === "validate") {
    assert.ok(!approvalPath && !output && !reviewedApprovalHash);
    console.log(
      JSON.stringify({ status: "VALID_INPUT_NOT_HOSTED_ACCEPTANCE", inputSha256: digest(input) }),
    );
  } else {
    assert.ok(approvalPath && output && reviewedApprovalHash, "all execution bindings required");
    assert.match(reviewedApprovalHash, /^[a-f0-9]{64}$/);
    const bytes = readFileSync(approvalPath);
    assert.equal(
      sha256(bytes),
      reviewedApprovalHash,
      "independently reviewed approval seal required",
    );
    const approval = approvalSchema.parse(JSON.parse(bytes.toString()));
    const git = (...args: string[]) =>
      execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
    const commit = git("rev-parse", "HEAD");
    assert.equal(git("branch", "--show-current"), "codex/blog-cms-release");
    assert.equal(git("status", "--porcelain"), "", "runner must be committed and clean");
    validateApproval(input, approval, commit);
    const { executeHosted } = await import("./hosted-runtime");
    await executeHosted(input, approval, commit, output, process.env);
    console.log("PASS_HOSTED: exact receipt written; production acceptance remains separate");
  }
} catch {
  // Provider/driver exceptions may contain credentials or private records. Journal is private.
  console.error(
    "BLOCKED_OR_FAILED: no hosted acceptance receipt. Check input/approval and the private incomplete journal; never infer cleanup from exit status.",
  );
  process.exitCode = 1;
}
