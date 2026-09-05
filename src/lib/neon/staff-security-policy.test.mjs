import assert from "node:assert/strict";
import test from "node:test";

import * as staffSecurityPolicy from "./staff-security-policy.ts";

const { decideAgentProfileMutation, shouldBootstrapFirstAdmin, isFirstAdminBootstrapEligible } =
  staffSecurityPolicy;

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
    decideAgentProfileMutation(manager, { auth_user_id: null, email: null, active: true }, null),
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

const roleChangeBase = {
  actorRoles: ["admin"],
  actorStaffId: "actor-1",
  targetStaffId: "target-1",
  currentRoles: ["agent"],
  nextRoles: ["manager"],
  otherAdminCount: 1,
  targetIsProtected: false,
};

const deactivationBase = {
  actorRoles: ["admin"],
  actorStaffId: "actor-1",
  targetStaffId: "target-1",
  targetRoles: ["agent"],
  otherAdminCount: 1,
  ownedTotal: 0,
  reassignToStaffId: null,
  targetIsProtected: false,
};

test("only admins may change roles", () => {
  const { decideStaffRoleChange } = staffSecurityPolicy;
  assert.deepEqual(decideStaffRoleChange(roleChangeBase), { allowed: true });
  assert.deepEqual(decideStaffRoleChange({ ...roleChangeBase, actorRoles: ["manager"] }), {
    allowed: false,
    reason: "not-admin",
  });
  assert.deepEqual(decideStaffRoleChange({ ...roleChangeBase, actorRoles: ["agent"] }), {
    allowed: false,
    reason: "not-admin",
  });
});

test("an admin cannot remove their own admin role, but may drop their own manager role", () => {
  const { decideStaffRoleChange } = staffSecurityPolicy;
  const self = { ...roleChangeBase, targetStaffId: roleChangeBase.actorStaffId };

  assert.deepEqual(
    decideStaffRoleChange({
      ...self,
      currentRoles: ["admin", "manager"],
      nextRoles: ["manager"],
    }),
    { allowed: false, reason: "self-admin-removal" },
  );

  // Dropping your own non-admin role is fine -- the guard is about lockout.
  assert.deepEqual(
    decideStaffRoleChange({
      ...self,
      currentRoles: ["admin", "manager"],
      nextRoles: ["admin"],
    }),
    { allowed: true },
  );
});

// Accounts on ADMIN_BOOTSTRAP_EMAILS are the owner's own. Without this, a second
// admin could strip the owner's role or disable them and take over the system.
test("an allowlisted account cannot be demoted or deactivated by anyone", () => {
  const { decideStaffRoleChange, decideStaffDeactivation } = staffSecurityPolicy;

  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      targetIsProtected: true,
    }),
    { allowed: false, reason: "protected-account" },
  );

  // Adding a role to a protected account is still fine -- only losing admin is blocked.
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["admin", "manager"],
      targetIsProtected: true,
    }),
    { allowed: true },
  );

  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, targetIsProtected: true }), {
    allowed: false,
    reason: "protected-account",
  });

  // Compound-failure priority: when two guards could both fire, the reason
  // returned is whichever one no follow-up action could resolve -- never one
  // that would look fixable but isn't. Protection blocks every actor, not
  // just this one, so it outranks the self-only guards below even when the
  // target is also the actor.
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      targetStaffId: roleChangeBase.actorStaffId,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      targetIsProtected: true,
    }),
    { allowed: false, reason: "protected-account" },
  );

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      targetStaffId: deactivationBase.actorStaffId,
      targetIsProtected: true,
    }),
    { allowed: false, reason: "protected-account" },
  );
});

test("the last admin role in the system cannot be removed", () => {
  const { decideStaffRoleChange } = staffSecurityPolicy;
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      otherAdminCount: 0,
    }),
    { allowed: false, reason: "last-admin" },
  );

  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      otherAdminCount: 1,
    }),
    { allowed: true },
  );

  // A malformed otherAdminCount (e.g. Number() on a non-numeric row) must
  // fail closed like a count of 0, not silently skip the guard.
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      currentRoles: ["admin"],
      nextRoles: ["manager"],
      otherAdminCount: NaN,
    }),
    { allowed: false, reason: "last-admin" },
  );

  // Same priority rule: even as the last admin, removing your OWN admin role
  // always reads as self-admin-removal, never last-admin -- another admin
  // could never do this for you either, since self-removal is blocked
  // unconditionally, so "last-admin" would misleadingly imply a fix exists.
  assert.deepEqual(
    decideStaffRoleChange({
      ...roleChangeBase,
      targetStaffId: roleChangeBase.actorStaffId,
      currentRoles: ["admin"],
      nextRoles: [],
      otherAdminCount: 0,
    }),
    { allowed: false, reason: "self-admin-removal" },
  );
});

test("deactivation requires admin, a different person, and a successor when they own work", () => {
  const { decideStaffDeactivation } = staffSecurityPolicy;

  assert.deepEqual(decideStaffDeactivation(deactivationBase), { allowed: true });

  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, actorRoles: ["manager"] }), {
    allowed: false,
    reason: "not-admin",
  });

  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, targetStaffId: "actor-1" }), {
    allowed: false,
    reason: "self",
  });

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      targetRoles: ["admin"],
      otherAdminCount: 0,
    }),
    { allowed: false, reason: "last-admin" },
  );

  // The last-admin guard requires the TARGET to hold the admin role --
  // otherAdminCount alone must never be sufficient reason to block.
  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, otherAdminCount: 0 }), {
    allowed: true,
  });

  // Same priority rule: naming a successor would not unblock this -- the
  // system would still lose its only admin -- so last-admin outranks
  // successor-required even when both conditions hold at once.
  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      targetRoles: ["admin"],
      otherAdminCount: 0,
      ownedTotal: 3,
      reassignToStaffId: null,
    }),
    { allowed: false, reason: "last-admin" },
  );

  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, ownedTotal: 3 }), {
    allowed: false,
    reason: "successor-required",
  });

  // A malformed ownedTotal must fail closed too -- assume work is owned
  // rather than silently allowing deactivation without a successor.
  assert.deepEqual(decideStaffDeactivation({ ...deactivationBase, ownedTotal: NaN }), {
    allowed: false,
    reason: "successor-required",
  });

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      ownedTotal: 3,
      reassignToStaffId: "target-1",
    }),
    { allowed: false, reason: "successor-is-target" },
  );

  assert.deepEqual(
    decideStaffDeactivation({
      ...deactivationBase,
      ownedTotal: 3,
      reassignToStaffId: "successor-1",
    }),
    { allowed: true },
  );
});

test("bootstrap eligibility never overrides an existing bound or privileged identity", () => {
  const input = {
    email: "owner@example.test",
    allowlistedEmails: new Set(["owner@example.test"]),
    access: null,
    staffRows: [],
  };
  for (const row of [
    { authUserId: "disabled-owner", roles: [] },
    { authUserId: null, roles: ["viewer"] },
    { authUserId: "owner", roles: ["admin"] },
  ]) {
    assert.equal(shouldBootstrapFirstAdmin({ ...input, staffRows: [row] }), false);
  }
  assert.equal(shouldBootstrapFirstAdmin({ ...input, email: "unlisted@example.test" }), false);
  assert.equal(shouldBootstrapFirstAdmin({ ...input, allowlistedEmails: new Set() }), false);
});
