import assert from "node:assert/strict";
import test from "node:test";

import * as policy from "./staff-lifecycle-policy.ts";

test("team access matrix defaults deny", () => {
  assert.equal(policy.isStaffRoleSet(["admin", "manager"]), true);
  assert.equal(policy.isStaffRoleSet(["admin", "unknown"]), false);
  assert.equal(policy.isStaffRoleSet(["admin", "admin"]), false);
  assert.deepEqual(policy.decideTeamAccess({ actorRoles: ["admin"], capability: "invite" }), {
    allowed: true,
  });
  assert.deepEqual(policy.decideTeamAccess({ actorRoles: ["manager"], capability: "directory" }), {
    allowed: true,
    readOnly: true,
  });
  assert.deepEqual(policy.decideTeamAccess({ actorRoles: ["manager"], capability: "reset" }), {
    allowed: false,
    reason: "not-authorized",
  });
  assert.deepEqual(policy.decideTeamAccess({ actorRoles: ["agent"], capability: "directory" }), {
    allowed: false,
    reason: "not-authorized",
  });
  assert.deepEqual(policy.decideTeamAccess({ actorRoles: ["unknown"], capability: "directory" }), {
    allowed: false,
    reason: "not-authorized",
  });
  assert.deepEqual(
    policy.decideTeamAccess({ actorRoles: ["admin", "unknown"], capability: "invite" }),
    {
      allowed: false,
      reason: "not-authorized",
    },
  );
  assert.deepEqual(
    policy.decideTeamAccess({ actorRoles: ["admin", "admin"], capability: "invite" }),
    {
      allowed: false,
      reason: "not-authorized",
    },
  );
  assert.deepEqual(
    policy.decideTeamAccess({ actorRoles: ["admin", "manager"], capability: "invite" }),
    {
      allowed: true,
    },
  );
});

test("self reset, self suspend, and unknown targets deny", () => {
  assert.deepEqual(policy.decideSelfReset({ actorStaffId: "actor", targetStaffId: "actor" }), {
    allowed: false,
    reason: "self",
  });
  assert.deepEqual(policy.decideSelfSuspend({ actorStaffId: "actor", targetStaffId: "actor" }), {
    allowed: false,
    reason: "self",
  });
  assert.deepEqual(policy.decideSelfReset({ actorStaffId: "actor", targetStaffId: null }), {
    allowed: false,
    reason: "unknown-target",
  });
  assert.deepEqual(policy.decideSelfSuspend({ actorStaffId: null, targetStaffId: "target" }), {
    allowed: false,
    reason: "unknown-target",
  });
  assert.deepEqual(policy.decideSelfReset({ actorStaffId: "actor", targetStaffId: "target" }), {
    allowed: true,
  });
});

test("email normalization and lifecycle transitions are deterministic", () => {
  assert.equal(policy.normalizeStaffEmail("  New.User@Example.TEST "), "new.user@example.test");
  assert.equal(
    policy.normalizeStaffEmail("\u00c9@EXAMPLE.TEST"),
    policy.normalizeStaffEmail("E\u0301@example.test"),
  );
  assert.deepEqual(
    policy.decideInvitationTransition({
      action: "invite",
      currentState: "none",
      providerOutcome: "PROVIDER_OK",
    }),
    { allowed: true },
  );
  assert.deepEqual(
    policy.decideInvitationTransition({
      action: "invite",
      currentState: "pending",
      providerOutcome: "PROVIDER_OK",
    }),
    { allowed: false, reason: "duplicate-invitation" },
  );
  assert.deepEqual(
    policy.decideInvitationTransition({
      action: "resend",
      currentState: "expired",
      providerOutcome: "PROVIDER_OK",
    }),
    { allowed: true },
  );
  assert.deepEqual(
    policy.decideInvitationTransition({
      action: "resend",
      currentState: "none",
      providerOutcome: "PROVIDER_OK",
    }),
    { allowed: false, reason: "invitation-not-found" },
  );
  assert.deepEqual(
    policy.decideInvitationTransition({
      action: "resend",
      currentState: "failed",
      providerOutcome: "PROVIDER_UNAVAILABLE",
    }),
    { allowed: true },
  );
  assert.deepEqual(
    policy.decideReactivation({ authUserId: null, providerOutcome: "PROVIDER_OK" }),
    { allowed: false, reason: "identity-required" },
  );
  assert.deepEqual(
    policy.decideReactivation({
      authUserId: "auth-1",
      providerOutcome: "PROVIDER_IDENTITY_NOT_FOUND",
    }),
    { allowed: false, reason: "PROVIDER_IDENTITY_NOT_FOUND" },
  );
  assert.deepEqual(
    policy.decideReactivation({ authUserId: "auth-1", providerOutcome: "raw token=never-expose" }),
    { allowed: false, reason: "PROVIDER_UNAVAILABLE" },
  );
  assert.deepEqual(
    policy.decideReactivation({ authUserId: "auth-1", providerOutcome: "PROVIDER_OK" }),
    { allowed: true },
  );
});

test("cooldowns are injected and provider outcomes remain stable codes", () => {
  const now = new Date("2026-08-16T00:00:00.000Z");
  assert.equal(
    policy.cooldownRetryAfter({
      action: "invitation",
      now,
      lastRequestedAt: "2026-08-15T23:50:00.000Z",
    }),
    "2026-08-16T00:05:00.000Z",
  );
  assert.equal(
    policy.cooldownRetryAfter({
      action: "password-reset",
      now,
      lastRequestedAt: "2026-08-15T23:50:00.000Z",
    }),
    null,
  );
  assert.equal(
    policy.cooldownRetryAfter({ action: "password-reset", now, lastRequestedAt: "bad-date" }),
    null,
  );
  for (const [status, code] of [
    [400, "PROVIDER_INVALID_REQUEST"],
    [401, "PROVIDER_UNAUTHORIZED"],
    [403, "PROVIDER_FORBIDDEN"],
    [404, "PROVIDER_IDENTITY_NOT_FOUND"],
    [409, "PROVIDER_CONFLICT"],
    [429, "PROVIDER_RATE_LIMITED"],
  ]) {
    assert.equal(policy.mapProviderOutcome({ status, resource: "identity" }), code);
  }
  assert.equal(
    policy.mapProviderOutcome({ status: 404, resource: "invitation" }),
    "PROVIDER_INVITATION_NOT_FOUND",
  );
  assert.equal(
    policy.mapProviderOutcome({ status: 500, resource: "identity" }),
    "PROVIDER_UNAVAILABLE",
  );
});
