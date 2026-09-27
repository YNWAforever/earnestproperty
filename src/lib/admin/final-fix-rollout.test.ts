import { describe, expect, test } from "bun:test";
import { resolveFinalFixUiFlags } from "./final-fix-rollout";

describe("final remediation UI rollout", () => {
  test("production defaults every new surface off until explicitly enabled", () => {
    expect(resolveFinalFixUiFlags({}, true)).toEqual({
      staffDirectorySetup: false,
      staffReviewEnforcement: false,
      linkBatchImport: false,
      salesPerformanceReporting: false,
    });
  });
  test("explicit true enables one surface and false can pause development rollout", () => {
    expect(
      resolveFinalFixUiFlags(
        {
          VITE_STAFF_DIRECTORY_SETUP: "true",
          VITE_STAFF_REVIEW_ENFORCEMENT: "true",
          VITE_LINK_BATCH_IMPORT: "false",
          VITE_SALES_PERFORMANCE_REPORTING: "1",
        },
        true,
      ),
    ).toEqual({
      staffDirectorySetup: true,
      staffReviewEnforcement: true,
      linkBatchImport: false,
      salesPerformanceReporting: false,
    });
    expect(resolveFinalFixUiFlags({ VITE_LINK_BATCH_IMPORT: "false" }, false).linkBatchImport).toBe(
      false,
    );
  });
});
