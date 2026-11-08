import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute, parse, join } from "node:path";
import { createRecoveryReceipt, verifyRecoveryReceipt } from "./recovery-evidence";

function regularFile(path: string, maxBytes: number) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
    throw new Error("RECOVERY_INPUT_FILE");
  return readFileSync(path);
}
function readJson(path: string): unknown {
  return JSON.parse(regularFile(path, 16 * 1024 * 1024).toString("utf8"));
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
}
function outputPath(cwd: string, path: string) {
  const root = resolve(cwd, ".private-sync-evidence/blog-recovery");
  const file = resolve(cwd, path);
  if (!inside(root, file)) throw new Error("RECOVERY_PRIVATE_OUTPUT_PATH");
  // Reject symlink/junction ancestors, including an existing output symlink.
  let ancestor = parse(file).root;
  for (const segment of relative(ancestor, file).split(/[\\/]/)) {
    ancestor = join(ancestor, segment);
    try {
      if (lstatSync(ancestor).isSymbolicLink()) throw new Error("RECOVERY_OUTPUT_SYMLINK");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return file;
}

/** Files only; no environment, credentials, provider clients, signing keys or mutation switches. */
export function runRecoveryCli(args: string[], cwd = process.cwd(), now = Date.now()) {
  const [mode, ...values] = args;
  const allowed = ["--context", "--evidence", "--artifacts", "--receipt"];
  if (!["issue", "verify"].includes(mode) || values.length !== 8)
    throw new Error("RECOVERY_ARGUMENTS");
  const flags = new Map<string, string>();
  for (let i = 0; i < values.length; i += 2) {
    if (
      !allowed.includes(values[i]) ||
      flags.has(values[i]) ||
      !values[i + 1] ||
      values[i + 1].startsWith("--")
    )
      throw new Error("RECOVERY_ARGUMENTS");
    flags.set(values[i], resolve(cwd, values[i + 1]));
  }
  const file = outputPath(cwd, flags.get("--receipt")!);
  const context = readJson(flags.get("--context")!);
  const evidence = readJson(flags.get("--evidence")!);
  const directory = flags.get("--artifacts")!;
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    throw new Error("RECOVERY_ARTIFACT_DIRECTORY");
  const artifacts = new Map<string, Uint8Array>();
  let bytes = 0;
  for (const name of readdirSync(directory)) {
    if (!/^[a-f0-9]{64}$/.test(name)) throw new Error("RECOVERY_ARTIFACT_NAME");
    const path = join(directory, name);
    const stat = lstatSync(path);
    bytes += stat.size;
    if (bytes > 512 * 1024 * 1024) throw new Error("RECOVERY_ARTIFACT_SIZE");
    artifacts.set(name, regularFile(path, 512 * 1024 * 1024));
  }
  const receipt = createRecoveryReceipt(evidence, context, artifacts, now);
  if (mode === "verify") {
    verifyRecoveryReceipt(readJson(file), evidence, context, artifacts, now);
    return { status: "OFFLINE_RECEIPT_VERIFIED", productionAuthorized: false };
  }
  mkdirSync(dirname(file), { recursive: true });
  if (!inside(realpathSync(cwd), realpathSync(dirname(file))))
    throw new Error("RECOVERY_PRIVATE_OUTPUT_PATH");
  writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return {
    status: receipt.record.status,
    productionAuthorized: false,
    receiptSha256: receipt.sha256,
    expiresAt: receipt.record.expiresAt,
  };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(runRecoveryCli(process.argv.slice(2))));
  } catch {
    // Input paths, provider exports and private row/object details must never reach stdout/stderr.
    console.error(
      "RECOVERY_REJECTED: inspect the offline package privately; no authorization issued",
    );
    process.exitCode = 1;
  }
}
