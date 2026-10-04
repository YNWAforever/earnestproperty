import { resolveFinalFixUiFlags } from "../../../src/lib/admin/final-fix-rollout";
export const finalFixUiFlags = {
  ...resolveFinalFixUiFlags({}, true),
  salesPerformanceReporting: sessionStorage.getItem("analytics-fixture-enabled") !== "false",
};
