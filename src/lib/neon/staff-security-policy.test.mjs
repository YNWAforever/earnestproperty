import assert from "node:assert/strict";
import test from "node:test";

import * as staffSecurityPolicy from "./staff-security-policy.ts";

const {
  decideAgentProfileMutation,
  shouldBootstrapFirstAdmin,
  isFirstAdminBootstrapEligible,
} = staffSecurityPolicy;

const manager = ["manager"];
const admin = ["admin"];
const ordinaryTarget = {
  authUserId: "auth-agent",
  email: "agent@example.com",
  active: true,
  roles: ["agent"],
};
const unchangedIdentity = {
  auth_user_id: ordinaryTarget.authUserId,
  email: ordinaryTarget.email,
  active: ordinaryTarget.active,
};

test("agent editor identity capability is derived from trusted staff roles", () => {
  const { deriveAgentProfileEditorContext } = staffSecurityPolicy;
  assert.equal(typeof deriveAgentProfileEditorContext, "function");
  if (!deriveAgentProfileEditorContext) return;
  assert.deepEqual(deriveAgentProfileEditorContext(admin), { canManageIdentity: true });
  assert.deepEqual(deriveAgentProfileEditorContext(manager), { canManageIdentity: false });
  assert.deepEqual(deriveAgentProfileEditorContext(["agent"]), { canManageIdentity: false });
});

test("manager may publish ordinary public profile fields without changing identity", () => {
  assert.deepEqual(decideAgentProfileMutation(manager, unchangedIdentity, ordinaryTarget), {
    allowed: true,
    mode: "public-profile-only",
  });
});

test("manager may create a profile-only row when target is null", () => {
  assert.deepEqual(
    decideAgentProfileMutation(
      manager,
      { auth_user_id: null, email: null, active: true },
      null,
    ),
    { allowed: true, mode: "public-profile-only" },
  );
});

test("manager cannot mutate identity or access fields on an ordinary staff row", async (t) => {
  const attempts = [
    { ...unchangedIdentity, auth_user_id: "attacker-auth" },
    { ...unchangedIdentity, email: "attacker@example.com" },
    { ...unchangedIdentity, active: false },
  ];

  for (const attempt of attempts) {
    await t.test(JSON.stringify(attempt), () => {
      assert.deepEqual(decideAgentProfileMutation(manager, attempt, ordinaryTarget), {
        allowed: false,
        reason: "identity-access-admin-only",
      });
    });
  }
});

test("manager cannot mutate an admin profile even when identity fields are unchanged", () => {
  const adminTarget = { ...ordinaryTarget, roles: ["admin"] };
  assert.deepEqual(decideAgentProfileMutation(manager, unchangedIdentity, adminTarget), {
    allowed: false,
    reason: "privileged-target-admin-only",
  });
});

test("admin may mutate identity and access fields", () => {
  assert.deepEqual(
    decideAgentProfileMutation(
      admin,
      { auth_user_id: "replacement-auth", email: "new@example.com", active: false },
      { ...ordinaryTarget, roles: ["admin"] },
    ),
    { allowed: true, mode: "identity-and-profile" },
  );
});

test("profile-only staff rows do not block first-admin bootstrap", () => {
  assert.equal(
    isFirstAdminBootstrapEligible([
      { authUserId: null, roles: [] },
      { authUserId: "  ", roles: [] },
    ]),
    true,
  );
  assert.equal(isFirstAdminBootstrapEligible([{ authUserId: "auth-user", roles: [] }]), false);
  assert.equal(isFirstAdminBootstrapEligible([{ authUserId: null, roles: ["manager"] }]), false);
});

test("allowlisted roleless profile-only match may bootstrap from a pre-bind snapshot", () => {
  assert.equal(
    shouldBootstrapFirstAdmin({
      email: "first-admin@example.com",
      allowlistedEmails: new Set(["first-admin@example.com"]),
      access: { roles: [], matchedProfileOnly: true },
      staffRows: [{ authUserId: null, roles: [] }],
    }),
    true,
  );
});

test("arbitrary roleless authenticated staff may not bootstrap", () => {
  assert.equal(
    shouldBootstrapFirstAdmin({
      email: "first-admin@example.com",
      allowlistedEmails: new Set(["first-admin@example.com"]),
      access: { roles: [], matchedProfileOnly: false },
      staffRows: [],
    }),
    false,
  );
});
