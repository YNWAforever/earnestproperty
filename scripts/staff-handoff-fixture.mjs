import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function validateStaffHandoffFixture(baseUrlValue, fixturePath, exists = existsSync) {
  if (!baseUrlValue) throw new Error("BLOCKED: PLAYWRIGHT_BASE_URL is required");
  if (!fixturePath) throw new Error("BLOCKED: STAFF_HANDOFF_BROWSER_FIXTURE is required");
  const path = resolve(fixturePath);
  if (!exists(path)) throw new Error("BLOCKED: synthetic fixture manifest does not exist");
  const base = new URL(baseUrlValue);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
    throw new Error("BLOCKED: browser target must be an HTTP(S) app URL without credentials");
  return { path, base };
}

export function validateStaffHandoffManifest(manifest, base, exists = existsSync) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.synthetic !== true ||
    !["isolated-staging", "isolated-local"].includes(manifest.targetKind)
  )
    throw new Error("BLOCKED: fixture must identify an approved isolated synthetic target");
  for (const key of ["agentAState", "agentBState", "viewerState"]) {
    if (
      typeof manifest[key] !== "string" ||
      !manifest[key].trim() ||
      !exists(resolve(manifest[key]))
    )
      throw new Error(`BLOCKED: ${key} storageState is missing`);
  }
  for (const key of ["url", "staleUrl"]) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim())
      throw new Error(`BLOCKED: ${key} is required in synthetic fixture`);
    const target = new URL(manifest[key], base);
    if (target.origin !== base.origin)
      throw new Error(`BLOCKED: ${key} must share PLAYWRIGHT_BASE_URL origin`);
  }
  for (const key of [
    "firstNotificationId",
    "secondNotificationId",
    "staleNotificationId",
    "requestedName",
  ]) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim())
      throw new Error(`BLOCKED: ${key} is required in synthetic fixture`);
  }
  if (manifest.firstNotificationId === manifest.secondNotificationId)
    throw new Error("BLOCKED: synthetic enquiries must have distinct notification IDs");
  return manifest;
}
