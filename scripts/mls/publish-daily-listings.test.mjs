import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicationArgs } from "./publication-cli-args.mjs";
const basic = ["--payload", "full.json", "--report", "report.json"];
test("legacy args retain the existing daily operator interface", () => {
  assert.deepEqual(parsePublicationArgs(basic), {
    payloadPath: "full.json",
    reportPath: "report.json",
  });
});
test("named args require a distinct publication sidecar and canonical hash", () => {
  assert.deepEqual(
    parsePublicationArgs([
      ...basic,
      "--publication-plan",
      "plan.json",
      "--publication-plan-hash",
      "a".repeat(64),
    ]),
    {
      payloadPath: "full.json",
      reportPath: "report.json",
      publicationPlanPath: "plan.json",
      publicationPlanHash: "a".repeat(64),
    },
  );
});
for (const tail of [
  ["--publication-plan", "plan.json"],
  ["--publication-plan-hash", "a".repeat(64)],
  ["--publication-plan", "plan.json", "--publication-plan-hash", "x"],
  ["--publication-plan", "plan.json", "--publication-plan", "other.json"],
  ["--review-plan", "price-plan.json"],
  ["--apply"],
  ["--publication-plan", "--report"],
])
  test(`invalid named CLI never silently becomes a batch command: ${tail.join(" ")}`, () => {
    assert.throws(() => parsePublicationArgs([...basic, ...tail]), /INVALID_ARGUMENTS/);
  });
