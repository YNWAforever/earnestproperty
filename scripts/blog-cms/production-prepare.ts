/** Local fixed captured-source preparation. bun --no-env-file .../production-prepare.ts
 * Prints a review summary only; no filesystem or remote writes. */
import { readFileSync } from "node:fs";
import {
  prepareProductionPacket,
  reviewProductionPacket,
  PRODUCTION_TARGET,
} from "./production-adapter";

if (process.argv.length > 2) throw new Error("PRODUCTION_PREPARE_NO_EXECUTION_FLAGS");
const bytes = readFileSync(
  new URL(
    "../../.private-sync-evidence/blog-import/public-source-2026-11-05T11-54-46-574Z/normalized-main-navigation/source-bundle.json",
    import.meta.url,
  ),
);
const packet = prepareProductionPacket({
  target: PRODUCTION_TARGET,
  source: {
    bytes,
    expectedSha256: "60f95f002b0b0f1da1ad4145b7a8d02f14ab19066e9bd3a18bd9b3563a71427e",
  },
});
console.log(
  JSON.stringify(
    {
      status: packet.status,
      manifestFingerprint: packet.manifestFingerprint,
      planFingerprint: packet.plan.fingerprint,
      targetFingerprint: packet.targetFingerprint,
      sourceByteSha256: packet.sourceByteSha256,
      sourceFingerprint: packet.sourceFingerprint,
      snapshotFingerprint: packet.snapshotFingerprint,
      counts: {
        articles: packet.plan.insert.length,
        categories: packet.plan.inventory.categories.length,
        settings: packet.plan.inventory.settings.length,
        conflicts: packet.plan.conflicts.length,
      },
      ...reviewProductionPacket(packet, packet.manifestFingerprint),
    },
    null,
    2,
  ),
);
