import { readFileSync } from "node:fs";
import { assessReleaseEvidence } from "../../src/lib/whatsapp-enquiries/release-readiness.ts";
const file = process.argv[2];
if (!file)
  throw new Error("Usage: node scripts/whatsapp-enquiries/check-release.mjs <release-record.json>");
try {
  const result = assessReleaseEvidence(JSON.parse(readFileSync(file, "utf8")));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
} catch {
  console.error("Invalid or incomplete release record");
  process.exitCode = 1;
}
