export type ReleaseEvidence = {
  codeSha: string;
  workingTreeClean: boolean;
  environment: string | null;
  companyChannelId: string | null;
  appliedMigrations: string[];
  policyId: string | null;
  policyApproved: boolean;
  copyVersion: string | null;
  staffMappingEvidence: string | null;
  providerReadbackEvidence: string | null;
  templateEvidence: string | null;
  workerCapabilityEvidence: string | null;
  workerLagSeconds: number | null;
  approvedLagSeconds: number | null;
  approvedRecipientEvidence: string | null;
  websitePlacementEvidence: string | null;
  property28hsePlacementEvidence: string | null;
  youtubePlacementEvidence: string | null;
  testTenantScenarioEvidence: string | null;
  rollbackDrillEvidence: string | null;
  releaseApprover: string | null;
  pilot: { branches: number; staff: number; managers: number };
};
const requiredMigrations = [
  "20260912120000_whatsapp_enquiry_events.sql",
  "20260912130000_whatsapp_enquiry_episodes.sql",
  "20260912140000_whatsapp_assignment_evidence.sql",
  "20260912150000_whatsapp_service_workflow.sql",
];
export function assessReleaseEvidence(r: ReleaseEvidence) {
  const blockers: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(r.codeSha) || !r.workingTreeClean) blockers.push("CODE_NOT_FROZEN");
  for (const field of [
    "environment",
    "companyChannelId",
    "policyId",
    "copyVersion",
    "staffMappingEvidence",
    "providerReadbackEvidence",
    "templateEvidence",
    "workerCapabilityEvidence",
    "approvedRecipientEvidence",
    "websitePlacementEvidence",
    "property28hsePlacementEvidence",
    "youtubePlacementEvidence",
    "testTenantScenarioEvidence",
    "rollbackDrillEvidence",
    "releaseApprover",
  ] as const)
    if (!r[field]?.trim()) blockers.push(`MISSING_${field}`);
  if (!r.policyApproved) blockers.push("POLICY_UNAPPROVED");
  for (const migration of requiredMigrations)
    if (!r.appliedMigrations.includes(migration)) blockers.push(`MISSING_MIGRATION:${migration}`);
  if (
    r.workerLagSeconds === null ||
    r.approvedLagSeconds === null ||
    !Number.isFinite(r.workerLagSeconds) ||
    !Number.isFinite(r.approvedLagSeconds) ||
    r.workerLagSeconds < 0 ||
    r.approvedLagSeconds <= 0 ||
    r.workerLagSeconds > r.approvedLagSeconds
  )
    blockers.push("SERVICE_LAG_UNVERIFIED");
  if (r.pilot.branches !== 1 || r.pilot.staff !== 2 || r.pilot.managers !== 1)
    blockers.push("PILOT_SCOPE_UNAPPROVED");
  return { ready: blockers.length === 0, blockers };
}
