/** Files provisioned by the operator outside the checkout. No request or env overrides. */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonical } from "../../src/lib/blog/reconcile";
import { productionTargetSchema } from "./production-evidence";
import type { ProductionTarget } from "./production-evidence";

const directory =
  process.platform === "win32"
    ? "C:\\ProgramData\\Earnestproperty\\blog-release"
    : "/etc/earnestproperty/blog-release";

function readProvisionedFile(name: string, failure: string): unknown {
  try {
    const path = join(directory, name);
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.size > 65536) throw new Error();
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(failure);
  }
}

export function loadProductionAuthority() {
  return readProvisionedFile(
    "authority.json",
    "PRODUCTION_EXECUTION_UNAVAILABLE: trusted authority absent",
  );
}

export function loadProductionCredential(target: ProductionTarget) {
  const failure = "PRODUCTION_EXECUTION_UNAVAILABLE: target credential absent or invalid";
  const result = z
    .object({
      format: z.literal("earnest-blog-release-credential-v1"),
      target: productionTargetSchema,
      password: z.string().min(1).max(4096),
    })
    .strict()
    .safeParse(readProvisionedFile("credential.json", failure));
  if (!result.success || canonical(result.data.target) !== canonical(target))
    throw new Error(failure);
  return result.data.password;
}

export function loadCurrentFence() {
  return readProvisionedFile("active-fence.json", "PRODUCTION_FENCE_MISSING");
}
