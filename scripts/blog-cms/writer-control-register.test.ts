import { expect, test } from "bun:test";
import register from "../../docs/superpowers/evidence/blog-cms/writer-control-register.json";
import { assessWriterControlRegister } from "./writer-control-register";

const now = Date.parse("2026-11-06T13:00:00Z");
const clone = () => structuredClone(register);

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
