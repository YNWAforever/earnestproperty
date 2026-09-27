import assert from "node:assert/strict";
import test from "node:test";
import { dueWorkHealth, summarizeStaffCoverage } from "./service-health-model.ts";

const readiness = (staffId, ready, mappingMissing = false) => ({
  staffId,
  assignment: {
    state: ready ? "ready" : "blocked",
    reasons: mappingMissing ? [{ code: "mapping_missing" }] : [],
  },
  staffWhatsapp: { state: "blocked", reasons: [] },
});

test("coverage uses the active intake scope and keeps missing mappings in the denominator", () => {
  const ids = Array.from({ length: 27 }, (_, index) => `staff-${index}`);
  const coverage = summarizeStaffCoverage(
    ids,
    ids.map((id, index) => readiness(id, index === 0, index !== 0)),
    "configured channel",
  );
  assert.equal(coverage.eligibleStaff, 27);
  assert.equal(coverage.assignmentReadyStaff, 1);
  assert.equal(coverage.missingMappingStaff, 26);
  assert.equal(coverage.staffWhatsappReadyStaff, 0);
});

test("an idle worker without due work does not raise an alarm", () => {
  assert.deepEqual(
    dueWorkHealth({
      now: "2026-09-27T00:00:00Z",
      oldestDueAt: null,
      overdueJobs: 0,
      expiredLeases: 0,
      heartbeatAt: null,
      lagSeconds: 300,
    }),
    [],
  );
});

test("overdue work and expired lease raise distinct alarms", () => {
  const reasons = dueWorkHealth({
    now: "2026-09-27T00:10:00Z",
    oldestDueAt: "2026-09-27T00:00:00Z",
    overdueJobs: 2,
    expiredLeases: 1,
    heartbeatAt: null,
    lagSeconds: 300,
  });
  assert.deepEqual(reasons, [
    "SERVICE_LEASE_EXPIRED",
    "SERVICE_DUE_WORK_OVERDUE",
    "SERVICE_WORKER_NOT_OBSERVED",
  ]);
});
