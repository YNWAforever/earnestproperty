import assert from "node:assert/strict";
import test from "node:test";
import { deriveTeamOnboarding } from "./team-onboarding-policy.ts";

const base = {
  active: true,
  email: "agent@example.test",
  roles: ["agent"],
  branchId: "branch-1",
  account: "linked",
  emailVerified: true,
  invitation: "none",
  readiness: null,
};

test("active agent without email and verified identity needs attention", () => {
  const result = deriveTeamOnboarding({
    ...base,
    email: null,
    account: "unregistered",
    emailVerified: null,
  });
  assert.ok(result.attentionReasons.includes("EMAIL_MISSING"));
  assert.ok(result.attentionReasons.includes("IDENTITY_UNBOUND"));
});

test("viewer does not require agent branch, Inbox mapping or phone", () => {
  const result = deriveTeamOnboarding({ ...base, roles: ["viewer"], branchId: null });
  assert.equal(result.steps.roleBranch, "ready");
  assert.equal(result.steps.inboxAssignment, "not_required");
  assert.equal(result.steps.staffPhone, "not_required");
  assert.deepEqual(result.attentionReasons, []);
});

test("an agent mapping is separate from optional phone transport", () => {
  const result = deriveTeamOnboarding({
    ...base,
    readiness: {
      staffId: "staff-1",
      displayName: "Agent",
      active: true,
      assignment: { state: "ready", reasons: [] },
      inboxPrivateNote: { state: "blocked", reasons: [] },
      staffWhatsapp: { state: "blocked", reasons: [] },
      maskedDestination: null,
      mappingVersion: null,
      endpointVersion: null,
      checkedAt: new Date().toISOString(),
    },
  });
  assert.equal(result.steps.inboxAssignment, "ready");
  assert.equal(result.steps.staffPhone, "not_required");
  assert.deepEqual(result.attentionReasons, []);
});

test("expired invitation and unverified account remain separate reasons", () => {
  const result = deriveTeamOnboarding({
    ...base,
    account: "unverified",
    emailVerified: false,
    invitation: "expired",
  });
  assert.ok(result.attentionReasons.includes("EMAIL_UNVERIFIED"));
  assert.ok(result.attentionReasons.includes("INVITATION_EXPIRED"));
});
