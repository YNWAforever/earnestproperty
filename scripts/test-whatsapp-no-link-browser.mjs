import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const baseValue = process.env.PLAYWRIGHT_BASE_URL;
const manifestPath = process.env.NO_LINK_BROWSER_FIXTURE;
if (!baseValue || !manifestPath)
  throw Error("BLOCKED_EXTERNAL: isolated app URL and synthetic no-link fixture are required");
const base = new URL(baseValue);
if (!["127.0.0.1", "localhost"].includes(base.hostname) || base.username || base.password)
  throw Error("BLOCKED_EXTERNAL: no-link browser checks only run against an isolated loopback app");
const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
if (manifest.synthetic !== true || manifest.targetKind !== "isolated-local")
  throw Error("BLOCKED_EXTERNAL: fixture must identify an isolated local synthetic target");
for (const key of ["agentAState", "agentBState", "viewerState"])
  if (typeof manifest[key] !== "string" || !existsSync(resolve(manifest[key])))
    throw Error(`BLOCKED_EXTERNAL: missing ${key} storage state`);
for (const key of ["conversationUrl", "otherConversationUrl"]) {
  if (typeof manifest[key] !== "string" || new URL(manifest[key], base).origin !== base.origin)
    throw Error(`BLOCKED_EXTERNAL: ${key} must remain on the isolated app origin`);
}
if (!Array.isArray(manifest.messageTexts) || manifest.messageTexts.length < 30)
  throw Error("BLOCKED_EXTERNAL: 30 synthetic messages are required");
if (!manifest.externalListingId || !manifest.publicListingNo || !manifest.privateMessageText)
  throw Error("BLOCKED_EXTERNAL: synthetic listing identifiers are required");
console.log(
  JSON.stringify({ targetKind: manifest.targetKind, synthetic: true, providerSend: false }),
);
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "e2e/whatsapp-no-link.spec.ts"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
