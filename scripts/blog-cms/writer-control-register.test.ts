import { expect, test } from "bun:test";
import register from "../../docs/superpowers/evidence/blog-cms/writer-control-register.json";
import { assessWriterControlRegister } from "./writer-control-register";

const now = Date.parse("2026-11-06T13:00:00Z");
const clone = () => structuredClone(register);

test("syntactically valid substituted evidence digests cannot validate", () => {
  for (const observation of register.observations) {
    const candidate = clone();
    candidate.observations.find((item) => item.path === observation.path)!.sha256 = "0".repeat(64);
    const result = assessWriterControlRegister(candidate, now);
    expect(result.validProposal).toBe(false);
    expect(result.productionAuthorized).toBe(false);
  }
});

test("old evidence cannot receive a renewed window in the same generation", () => {
  const candidate = clone();
  candidate.observedAt = "2026-11-07T12:40:47Z";
  candidate.expiresAt = "2026-11-08T12:40:47Z";
  expect(assessWriterControlRegister(candidate, now + 86_400_000).validProposal).toBe(false);
  const extended = clone();
  extended.expiresAt = "2026-11-07T12:40:47.500Z";
  expect(assessWriterControlRegister(extended, now).validProposal).toBe(false);
});

test("caller-selected new generation cannot renew old evidence or replace the reviewed catalog", () => {
  const candidate = clone();
  candidate.generation = "blog-cms-writer-proposal-20261107-03";
  candidate.observedAt = "2026-11-07T12:40:47Z";
  candidate.expiresAt = "2026-11-08T12:40:47Z";
  expect(assessWriterControlRegister(candidate, now + 86_400_000).validProposal).toBe(false);
  candidate.observations.forEach((item) => {
    item.sha256 = "1".repeat(64);
  });
  expect(assessWriterControlRegister(candidate, now + 86_400_000).validProposal).toBe(false);
});

test("retired generation 01 is not the active reviewed proposal", () => {
  const candidate = clone();
  candidate.generation = "blog-cms-writer-proposal-20261106-01";
  expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
});

test("capture times are pinned to reviewed evidence, including an unknown Blob capture time", () => {
  for (let index = 0; index < register.observations.length; index++) {
    const candidate = clone();
    candidate.observations[index].capturedAt = "2026-11-06T13:00:00Z";
    const result = assessWriterControlRegister(candidate, now);
    expect(result.errors).toContain("UNREVIEWED_EVIDENCE");
    expect(result.productionAuthorized).toBe(false);
  }
  const missing = clone();
  delete (missing.observations[0] as Record<string, unknown>).capturedAt;
  expect(assessWriterControlRegister(missing, now).validProposal).toBe(false);
});

test("renewal requires a code-reviewed catalog change, not caller-supplied trust", () => {
  const candidate = clone();
  candidate.generation = "blog-cms-writer-proposal-20261107-03";
  expect(assessWriterControlRegister(candidate, now).errors).toContain("UNREVIEWED_GENERATION");
  expect(
    assessWriterControlRegister({ ...candidate, reviewedProposal: candidate }, now).validProposal,
  ).toBe(false);
  // The amended generation is reviewed against the same old bytes, with no new lease.
  expect(assessWriterControlRegister(register, now).validProposal).toBe(true);
  expect(
    assessWriterControlRegister(register, Date.parse("2026-11-07T12:40:47Z")).validProposal,
  ).toBe(false);
});

test("acceptance access cannot become general reopening or owner-implied approval", () => {
  for (const edit of [
    { generalWritersEnabled: true },
    { before: "AFTER_REOPEN" },
    { approval: { approver: "Willy" } },
    { maxDurationMinutes: 120 },
    { releaseDeploymentId: "unreviewed-deployment" },
  ]) {
    const result = assessWriterControlRegister(
      { ...clone(), acceptanceAccess: { ...register.acceptanceAccess, ...edit } },
      now,
    );
    expect(result.validProposal).toBe(false);
    expect(result.productionAuthorized).toBe(false);
  }
});

test("a complete proposal remains blocked and cannot authorize production", () => {
  const result = assessWriterControlRegister(register, now);
  expect(result.validProposal).toBe(true);
  expect(result.productionAuthorized).toBe(false);
  expect(result.blockers).toContain("ACTIVATION_APPROVAL_MISSING");
  expect(result.blockers).toContain("LIVE_FENCE_UNPROVEN");
  expect(result.blockers).toContain("INVENTORY_INCOMPLETE");
});

test("every required writer must be present independently of the submitted inventory", () => {
  for (const writer of register.writers) {
    const candidate = clone();
    candidate.writers = candidate.writers.filter((row) => row.id !== writer.id);
    expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
  }
});

test("duplicates cannot substitute for omitted writers and unknown writers require review", () => {
  const duplicate = clone();
  duplicate.writers.push(duplicate.writers[0]);
  expect(assessWriterControlRegister(duplicate, now).errors).toContain("DUPLICATE_WRITER");
  const unknown = clone();
  unknown.writers[0].id = "unreviewed-writer";
  expect(assessWriterControlRegister(unknown, now).validProposal).toBe(false);
});

test("generation, expiry, pre-state and every operational control are mandatory", () => {
  for (const field of ["generation", "expiresAt", "target", "sourceHead"]) {
    const candidate: Record<string, unknown> = clone();
    delete candidate[field];
    expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
  }
  for (const field of [
    "preState",
    "resources",
    "control",
    "proofSteps",
    "drainCriteria",
    "retainedEvidence",
    "reopenSteps",
  ]) {
    const candidate = clone();
    delete (candidate.writers[0] as Record<string, unknown>)[field];
    expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
  }
});

test("expiry, future observations and invalid clocks fail closed", () => {
  for (const clock of [Date.parse(register.expiresAt), NaN, Infinity, now - 86_400_000]) {
    expect(assessWriterControlRegister(register, clock).validProposal).toBe(false);
  }
  const candidate = clone();
  candidate.expiresAt = candidate.observedAt;
  expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
});

test("generic fence=true, owner approval and invented active proofs never bypass the proposal boundary", () => {
  for (const candidate of [
    true,
    null,
    {},
    { fence: true },
    { ...clone(), fence: true },
    { ...clone(), activationApproval: { approvedBy: "Willy" } },
    { ...clone(), reopenApproval: true },
    { ...clone(), state: "active" },
  ]) {
    const result = assessWriterControlRegister(candidate, now);
    expect(result.validProposal).toBe(false);
    expect(result.productionAuthorized).toBe(false);
  }
  const nested = clone();
  Object.assign(nested.writers[0].control, { fence: true });
  expect(assessWriterControlRegister(nested, now).validProposal).toBe(false);
});

test("target drift, resource substitution and empty controls are rejected", () => {
  const wrongTarget = clone();
  wrongTarget.target.neonBranch = "other-branch";
  expect(assessWriterControlRegister(wrongTarget, now).validProposal).toBe(false);
  const wrongResource = clone();
  wrongResource.writers[0].resources = ["unrelated-project"];
  expect(assessWriterControlRegister(wrongResource, now).validProposal).toBe(false);
  for (const field of [
    "proofSteps",
    "drainCriteria",
    "retainedEvidence",
    "reopenSteps",
    "sources",
  ]) {
    const candidate = clone();
    Object.assign(candidate.writers[0], { [field]: [] });
    expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
  }
});

test("partial pre-state cannot be relabelled complete or stripped of its gaps", () => {
  const candidate = clone();
  candidate.writers[0].preState.gaps = [];
  expect(assessWriterControlRegister(candidate, now).validProposal).toBe(false);
});

test("observation coverage and observed enabled flags cannot be silently substituted", () => {
  const candidate = clone();
  candidate.observations[1] = candidate.observations[0];
  expect(assessWriterControlRegister(candidate, now).errors).toContain("OBSERVATION_COVERAGE");
  const disabled = clone();
  disabled.writerVariables.OWNER_PUBLICATION_DAILY_ENABLED = "false";
  expect(assessWriterControlRegister(disabled, now).validProposal).toBe(false);
});

test("proposal checks do not mutate caller evidence or return any active capability", () => {
  const candidate = clone();
  const before = JSON.stringify(candidate);
  const result = assessWriterControlRegister(candidate, now);
  expect(JSON.stringify(candidate)).toBe(before);
  expect(Object.keys(result).sort()).toEqual([
    "blockers",
    "errors",
    "productionAuthorized",
    "validProposal",
  ]);
  expect(
    assessWriterControlRegister({ ...candidate, inventoryComplete: true }, now).validProposal,
  ).toBe(false);
});
