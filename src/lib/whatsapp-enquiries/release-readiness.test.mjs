import test from "node:test";
import assert from "node:assert/strict";
import { assessReleaseEvidence } from "./release-readiness.ts";
const record = () => ({
  codeSha: "a".repeat(40),
  workingTreeClean: false,
  environment: null,
  companyChannelId: null,
  appliedMigrations: [],
  policyId: null,
  policyApproved: false,
  copyVersion: null,
  staffMappingEvidence: null,
  providerReadbackEvidence: null,
  templateEvidence: null,
  workerCapabilityEvidence: null,
  workerLagSeconds: null,
  approvedLagSeconds: null,
  approvedRecipientEvidence: null,
  websitePlacementEvidence: null,
  property28hsePlacementEvidence: null,
  youtubePlacementEvidence: null,
  testTenantScenarioEvidence: null,
  rollbackDrillEvidence: null,
  releaseApprover: null,
  pilot: { branches: 1, staff: 2, managers: 1 },
});
test("AT53-56 offline implementation cannot certify a live pilot", () => {
  const r = assessReleaseEvidence(record());
  assert.equal(r.ready, false);
  for (const code of [
    "CODE_NOT_FROZEN",
    "MISSING_providerReadbackEvidence",
    "MISSING_testTenantScenarioEvidence",
    "MISSING_rollbackDrillEvidence",
    "SERVICE_LAG_UNVERIFIED",
  ])
    assert.ok(r.blockers.includes(code));
});
test("pilot readiness refuses wider scope and unmeasured/late service lane", () => {
  const r = record();
  r.workerLagSeconds = 121;
  r.approvedLagSeconds = 120;
  r.pilot.staff = 3;
  const b = assessReleaseEvidence(r).blockers;
  assert.ok(b.includes("SERVICE_LAG_UNVERIFIED"));
  assert.ok(b.includes("PILOT_SCOPE_UNAPPROVED"));
});

test("complete synthetic evidence passes only the document completeness gate", () => {
  const r = record();
  for (const key of Object.keys(r)) if (r[key] === null) r[key] = "synthetic-reviewed-reference";
  r.workingTreeClean = true;
  r.policyApproved = true;
  r.workerLagSeconds = 20;
  r.approvedLagSeconds = 60;
  r.appliedMigrations = [
    "20260912120000_whatsapp_enquiry_events.sql",
    "20260912130000_whatsapp_enquiry_episodes.sql",
    "20260912140000_whatsapp_assignment_evidence.sql",
    "20260912150000_whatsapp_service_workflow.sql",
  ];
  assert.deepEqual(assessReleaseEvidence(r), { ready: true, blockers: [] });
  r.appliedMigrations.pop();
  assert.ok(assessReleaseEvidence(r).blockers.some((x) => x.startsWith("MISSING_MIGRATION:")));
});
