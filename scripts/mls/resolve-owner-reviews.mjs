import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readFrozenImportInput } from "./frozen-import-input.mjs";
import { createSavedImportClient } from "./saved-import-driver.mjs";
import { assertImportTarget } from "../../src/lib/mls/saved-capture-import.mjs";
import {
  inspectOwnerReviewResolution,
  applyOwnerReviewResolution,
} from "../../src/lib/mls/owner-review-resolution.mjs";
export async function main(args = process.argv.slice(2), env = process.env) {
  let path,
    reviewPath,
    exportPath,
    confirmationHash,
    reviewHash,
    apply = false,
    driver = "pg";
  for (let i = 0; i < args.length; i++) {
    if (
      ["--input", "--review-plan", "--export-plan"].includes(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      const flag = args[i],
        value = resolve(args[++i]);
      if (flag === "--input") path = value;
      if (flag === "--review-plan") reviewPath = value;
      if (flag === "--export-plan") exportPath = value;
    } else if (args[i] === "--apply" && !apply) apply = true;
    else if (args[i].startsWith("--confirm-production="))
      confirmationHash = args[i].slice("--confirm-production=".length);
    else if (args[i].startsWith("--confirm-review-plan="))
      reviewHash = args[i].slice("--confirm-review-plan=".length);
    else if (args[i].startsWith("--driver=")) driver = args[i].slice("--driver=".length);
    else throw Error("REVIEW_INVALID_ARGUMENTS");
  }
  if (!path) throw Error("REVIEW_CAPTURE_INPUT_REQUIRED");
  if (!["pg", "neon-ws"].includes(driver)) throw Error("IMPORT_DRIVER_INVALID");
  if (apply && (!reviewPath || exportPath)) throw Error("REVIEW_APPLY_REQUIRES_PLAN_AND_NO_EXPORT");
  if (!reviewPath && !exportPath) throw Error("REVIEW_PLAN_OR_EXPORT_REQUIRED");
  if (exportPath && [path, reviewPath].includes(exportPath))
    throw Error("REVIEW_EXPORT_MUST_NOT_OVERWRITE_INPUT");
  const frozen = await readFrozenImportInput(path);
  // Capture bytes provide the existing target authorization independently of queue approval.
  JSON.parse(frozen.bytes.toString("utf8"));
  const reviewFrozen = reviewPath ? await readFrozenImportInput(reviewPath) : null;
  const input = reviewFrozen ? JSON.parse(reviewFrozen.bytes.toString("utf8")) : null;
  if (
    apply &&
    (!/^[a-f0-9]{64}$/.test(reviewHash ?? "") || reviewHash !== reviewFrozen.inputSha256)
  )
    throw Error("REVIEW_CONFIRMATION_HASH_REQUIRED_OR_MISMATCH");
  assertImportTarget(env, { confirmationHash, inputSha256: frozen.inputSha256 });
  const client = await createSavedImportClient(
    {
      connectionString: env.IMPORT_DATABASE_URL,
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
      statement_timeout: 30000,
      lock_timeout: 10000,
    },
    driver,
  );
  try {
    await client.connect();
    const result = apply
      ? await applyOwnerReviewResolution(client, input, {
          inputSha256: reviewFrozen.inputSha256,
          captureInputSha256: frozen.inputSha256,
        })
      : await inspectOwnerReviewResolution(client, input, { exportSnapshot: Boolean(exportPath) });
    // Exclusive creation avoids overwriting another approved snapshot.
    if (exportPath)
      await writeFile(exportPath, JSON.stringify(result.snapshot, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    const output = {
      mode: apply ? "apply" : "read-only-dry-run",
      captureInputSha256: frozen.inputSha256,
      reviewPlanSha256: reviewFrozen?.inputSha256 ?? null,
      ...result,
    };
    console.log(JSON.stringify(output, null, 2));
    return output;
  } finally {
    await client.end();
  }
}
// Never emit driver errors, connection strings, queries, or database values on failure.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error(
      "REVIEW_COMMAND_FAILED: inspect arguments, target guards, approval hashes, and database availability.",
    );
    process.exitCode = 1;
  });
