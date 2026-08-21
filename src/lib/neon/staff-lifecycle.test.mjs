import assert from "node:assert/strict";
import test from "node:test";

import * as lifecycleModule from "./staff-lifecycle.server.ts";

const { createStaffLifecycleService } = lifecycleModule;

const admin = {
  staffId: "11111111-1111-4111-8111-111111111111",
  authUserId: "auth-admin",
  email: "admin@example.test",
  name: "Admin",
  roles: ["admin"],
  bootstrap: false,
  matchedProfileOnly: false,
};
const manager = { ...admin, staffId: "33333333-3333-4333-8333-333333333333", roles: ["manager"] };
const targetId = "22222222-2222-4222-8222-222222222222";
const request = new Request("https://earnest.test/admin/team");

function fixture(overrides = {}) {
  const calls = {
    provider: [],
    actions: [],
    audit: [],
    transactions: [],
    roleChanges: [],
    activeChanges: [],
  };
  const staff = new Map();
  const latestActions = new Map();
  const actionRows = new Map();
  const actionRowsById = new Map();
  const clock = { current: new Date("2026-08-16T00:00:00.000Z") };
  let actionNumber = 0;
  const identityActions = {
    async beginIdentityAction(input) {
      calls.actions.push({ method: "begin", input });
      const existing = actionRows.get(input.idempotencyKey);
      if (existing) return { operationId: existing.id, isExisting: true, state: existing.state };
      const row = {
        id: `00000000-0000-4000-8000-${String(++actionNumber).padStart(12, "0")}`,
        state: "pending",
      };
      actionRows.set(input.idempotencyKey, row);
      actionRowsById.set(row.id, row);
      return { operationId: row.id, isExisting: false, state: row.state };
    },
    async markIdentityActionSucceeded(input) {
      calls.actions.push({ method: "succeeded", input });
      const row = actionRowsById.get(input.operationId);
      if (row) row.state = "succeeded";
    },
    async markIdentityActionRetryable(input) {
      calls.actions.push({ method: "retryable", input });
      const row = actionRowsById.get(input.operationId);
      if (row) row.state = "retryable_failure";
    },
    async markIdentityActionTerminal(input) {
      calls.actions.push({ method: "terminal", input });
      const row = actionRowsById.get(input.operationId);
      if (row) row.state = "terminal_failure";
    },
    async findIdentityActionCooldown() {
      return null;
    },
  };
  const service = createStaffLifecycleService({
    organizationId: "org-earnest",
    provider: {
      async sendInvitation(input) {
        calls.provider.push({ method: "invite", input });
        return { state: "sent", expiresAt: "2026-08-17T00:00:00.000Z" };
      },
      async resendInvitation(input) {
        calls.provider.push({ method: "resend", input });
        return { state: "sent", expiresAt: "2026-08-17T00:00:00.000Z" };
      },
      async requestPasswordReset(input) {
        calls.provider.push({ method: "reset", input });
      },
      async revokeUserSessions(input) {
        calls.provider.push({ method: "revoke", input });
      },
      async resolveUser(input) {
        calls.provider.push({ method: "resolve", input });
        return {
          id: input.authUserId,
          email: "target@example.test",
          name: null,
          emailVerified: true,
        };
      },
    },
    queryRows: async (statement, params = []) => {
      if (statement.includes("FROM staff_users") && statement.includes("WHERE id")) {
        const row = staff.get(params[0]);
        return row ? [row] : [];
      }
      if (statement.includes("FROM staff_identity_actions")) {
        return latestActions.get(params[0]) ?? [];
      }
      return [];
    },
    transactionRows: async (statements) => {
      calls.transactions.push(statements);
      const first = statements[0];
      if (first.statement.includes("INSERT INTO staff_users")) {
        const email = first.params[0];
        const existing = [...staff.values()].find((row) => row.email === email);
        const row = existing ?? {
          id: targetId,
          email,
          auth_user_id: null,
          active: true,
          roles: ["agent"],
        };
        staff.set(row.id, row);
        return [[row]];
      }
      return [];
    },
    identityActions,
    updateStaffRoles: async (input, actor) => {
      calls.roleChanges.push({ input, actor });
      return { ok: true, roles: input.roles };
    },
    setStaffActive: async (input, actor) => {
      calls.activeChanges.push({ input, actor });
      const existing = staff.get(input.staffId) ?? {
        id: input.staffId,
        email: "target@example.test",
        auth_user_id: "auth-target",
        active: !input.active,
      };
      staff.set(input.staffId, { ...existing, active: input.active });
      return { ok: true, reassigned: input.active ? null : { inquiries: 2 } };
    },
    writeAudit: async (input) => calls.audit.push(input),
    now: () => new Date(clock.current),
    requestId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...overrides,
  });
  return { service, calls, staff, latestActions, identityActions, clock };
}

test("invite normalizes email, upserts one local member/action, and forwards only provider identity fields", async () => {
  const { service, calls } = fixture();
  const first = await service.inviteStaffMember(
    { email: " Ada@Example.Test ", name: "Ada", roles: ["manager", "agent"] },
    admin,
    request,
  );
  const second = await service.inviteStaffMember(
    { email: "ada@example.test", name: "Ada", roles: ["manager", "agent"] },
    admin,
    request,
  );
  assert.deepEqual(first, {
    memberId: targetId,
    invitationState: "sent",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(second.memberId, targetId);
  assert.equal(calls.transactions.length, 2);
  assert.equal(calls.actions.filter((call) => call.method === "begin").length, 2);
  assert.deepEqual(calls.provider[0], {
    method: "invite",
    input: { email: "ada@example.test", organizationId: "org-earnest", request },
  });
  assert.doesNotMatch(JSON.stringify({ first, calls }), /password|token|cookie|provider.*body/i);
});

test("invite retains local staff and makes its operation safely retryable when delivery fails", async () => {
  const { service, calls } = fixture({
    provider: {
      sendInvitation: async () => {
        throw Object.assign(new Error("raw provider message must not escape"), {
          code: "PROVIDER_RATE_LIMITED",
        });
      },
    },
  });
  const result = await service.inviteStaffMember(
    { email: "ada@example.test", roles: ["agent"] },
    admin,
    request,
  );
  assert.equal(result.invitationState, "failed");
  assert.equal(calls.transactions.length, 1);
  assert.equal(calls.actions.at(-1).method, "retryable");
  assert.equal(calls.actions.at(-1).input.safeErrorCode, "PROVIDER_RATE_LIMITED");
  assert.doesNotMatch(JSON.stringify(result), /raw provider message/i);
});

test("resend and reset reuse in-flight action keys only inside their cooldown windows", async () => {
  const resend = fixture();
  resend.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  resend.identityActions.findIdentityActionCooldown = async () => ({
    state: "retryable_failure",
    retryAfter: null,
    providerExpiresAt: null,
  });
  await resend.service.resendStaffInvitation({ staffId: targetId }, admin, request);
  await resend.service.resendStaffInvitation({ staffId: targetId }, admin, request);
  assert.equal(resend.calls.provider.filter((call) => call.method === "resend").length, 1);
  resend.clock.current = new Date("2026-08-16T00:16:00.000Z");
  await resend.service.resendStaffInvitation({ staffId: targetId }, admin, request);
  assert.equal(resend.calls.provider.filter((call) => call.method === "resend").length, 2);
  assert.notEqual(
    resend.calls.actions.filter((call) => call.method === "begin")[0].input.idempotencyKey,
    resend.calls.actions.filter((call) => call.method === "begin").at(-1).input.idempotencyKey,
  );

  const reset = fixture();
  reset.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  await reset.service.sendStaffPasswordReset({ staffId: targetId }, admin, request);
  await reset.service.sendStaffPasswordReset({ staffId: targetId }, admin, request);
  assert.equal(reset.calls.provider.filter((call) => call.method === "reset").length, 1);
  reset.clock.current = new Date("2026-08-16T00:11:00.000Z");
  await reset.service.sendStaffPasswordReset({ staffId: targetId }, admin, request);
  assert.equal(reset.calls.provider.filter((call) => call.method === "reset").length, 2);
});

test("persisted active cooldowns return their ISO retry time before creating an action", async () => {
  const resend = fixture();
  resend.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  resend.latestActions.set(targetId, [
    {
      action: "invite",
      state: "succeeded",
      created_at: "2026-08-16T00:00:00.000Z",
      retry_after: null,
      provider_expires_at: "2026-08-17T00:00:00.000Z",
    },
  ]);
  resend.clock.current = new Date("2026-08-16T00:01:00.000Z");
  const resendResult = await resend.service.resendStaffInvitation(
    { staffId: targetId },
    admin,
    request,
  );
  assert.deepEqual(resendResult, {
    accepted: false,
    retryAfter: "2026-08-16T00:15:00.000Z",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(resend.calls.actions.filter((call) => call.method === "begin").length, 0);
  assert.equal(resend.calls.provider.length, 0);

  const reset = fixture();
  reset.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  reset.latestActions.set(targetId, [
    {
      action: "password_reset",
      state: "succeeded",
      created_at: "2026-08-16T00:00:00.000Z",
      retry_after: null,
      provider_expires_at: null,
    },
  ]);
  reset.clock.current = new Date("2026-08-16T00:01:00.000Z");
  const resetResult = await reset.service.sendStaffPasswordReset(
    { staffId: targetId },
    admin,
    request,
  );
  assert.deepEqual(resetResult, {
    accepted: false,
    retryAfter: "2026-08-16T00:10:00.000Z",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(reset.calls.actions.filter((call) => call.method === "begin").length, 0);
  assert.equal(reset.calls.provider.length, 0);
});

test("a post-delivery audit failure does not downgrade a succeeded invitation", async () => {
  const { service, calls } = fixture({
    writeAudit: async () => {
      throw new Error("audit backend unavailable");
    },
  });
  const result = await service.inviteStaffMember(
    { email: "audit@example.test", roles: ["agent"] },
    admin,
    request,
  );
  assert.equal(result.invitationState, "sent");
  assert.equal(
    calls.actions.some((call) => call.method === "retryable"),
    false,
  );
  assert.equal(
    calls.actions.some((call) => call.method === "succeeded"),
    true,
  );
});

test("expired provider invitation outcomes become terminal safe failures", async () => {
  const invite = fixture({
    provider: {
      sendInvitation: async () => ({ state: "expired", expiresAt: null }),
    },
  });
  const invitation = await invite.service.inviteStaffMember(
    { email: "expired@example.test", roles: ["agent"] },
    admin,
    request,
  );
  assert.equal(invitation.invitationState, "failed");
  assert.equal(invite.calls.actions.at(-1).method, "terminal");

  const resend = fixture({
    provider: {
      resendInvitation: async () => ({ state: "expired", expiresAt: null }),
    },
  });
  resend.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: null,
    active: true,
  });
  resend.identityActions.findIdentityActionCooldown = async () => ({
    state: "retryable_failure",
    retryAfter: null,
    providerExpiresAt: null,
  });
  const result = await resend.service.resendStaffInvitation({ staffId: targetId }, admin, request);
  assert.equal(result.accepted, false);
  assert.equal(resend.calls.actions.at(-1).method, "terminal");
});

test("resend enforces local invitation state and cooldown, and makes missing provider invitations terminal", async () => {
  const { service, calls, staff, identityActions, clock } = fixture();
  staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: null,
    active: true,
  });
  identityActions.findIdentityActionCooldown = async () => ({
    state: "succeeded",
    retryAfter: "2026-08-16T00:15:00.000Z",
    providerExpiresAt: null,
  });
  const cooldown = await service.resendStaffInvitation({ staffId: targetId }, admin, request);
  assert.deepEqual(cooldown, {
    accepted: false,
    retryAfter: "2026-08-16T00:15:00.000Z",
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  identityActions.findIdentityActionCooldown = async () => null;
  await assert.rejects(
    () => service.resendStaffInvitation({ staffId: targetId }, admin, request),
    (error) => error instanceof Response && error.status === 400,
  );
  identityActions.findIdentityActionCooldown = async () => ({
    state: "retryable_failure",
    retryAfter: null,
    providerExpiresAt: null,
  });
  clock.current = new Date("2026-08-16T00:16:00.000Z");
  calls.provider.length = 0;
  await service.resendStaffInvitation({ staffId: targetId }, admin, request);
  assert.equal(calls.provider.at(-1).method, "resend");
  const missing = fixture({
    provider: {
      resendInvitation: async () => {
        throw Object.assign(new Error("secret response"), {
          code: "PROVIDER_INVITATION_NOT_FOUND",
        });
      },
    },
  });
  missing.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: null,
    active: true,
  });
  missing.identityActions.findIdentityActionCooldown = async () => ({
    state: "retryable_failure",
    retryAfter: null,
    providerExpiresAt: null,
  });
  const result = await missing.service.resendStaffInvitation({ staffId: targetId }, admin, request);
  assert.equal(result.accepted, false);
  assert.equal(missing.calls.actions.at(-1).method, "terminal");
});

test("password reset rejects unsafe targets and only sends a provider reset link with safe output/audit data", async () => {
  const { service, calls, staff, identityActions } = fixture();
  staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  const result = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);
  assert.deepEqual(result, {
    accepted: true,
    retryAfter: null,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.deepEqual(calls.provider.at(-1), {
    method: "reset",
    input: {
      email: "target@example.test",
      redirectTo: "https://earnest.test/auth/reset-password",
      request,
    },
  });
  identityActions.findIdentityActionCooldown = async () => ({
    state: "succeeded",
    retryAfter: "2026-08-16T00:10:00.000Z",
    providerExpiresAt: null,
  });
  const cooldown = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);
  assert.equal(cooldown.accepted, false);
  const selfReset = await service.sendStaffPasswordReset(
    { staffId: admin.staffId },
    admin,
    request,
  );
  assert.equal(selfReset.failureCode, "SELF_RESET_NOT_ALLOWED");
  await assert.rejects(
    () => service.sendStaffPasswordReset({ staffId: targetId }, manager, request),
    (error) => error instanceof Response && error.status === 403,
  );
  assert.equal("password" in result, false);
  assert.equal("token" in result, false);
  assert.equal("password" in calls.actions[0].input, false);
  assert.equal("token" in calls.actions[0].input, false);
  assert.equal("password" in (calls.audit[0].metadata ?? {}), false);
  assert.equal("token" in (calls.audit[0].metadata ?? {}), false);
});

test("password reset ignores a stored cooldown once its retryAfter has actually passed", async () => {
  // findIdentityActionCooldown's row-level retry_after is a fixed timestamp
  // written at the time of a prior failure -- it never gets re-evaluated once
  // real time moves past it. The caller must check it against "now" itself,
  // exactly like it already does for the persisted/localCooldown path below.
  const { service, calls, staff, identityActions } = fixture();
  staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  identityActions.findIdentityActionCooldown = async () => ({
    state: "retryable_failure",
    retryAfter: "2026-08-15T23:50:00.000Z", // 10 minutes before fixture's clock.current
    providerExpiresAt: null,
  });

  const result = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);

  assert.equal(result.accepted, true);
  assert.equal(
    calls.provider.some((call) => call.method === "reset"),
    true,
  );
});

test("password reset returns a serializable self-target denial before any store or provider call", async () => {
  const { service, calls, staff } = fixture();
  staff.set(admin.staffId, {
    id: admin.staffId,
    email: admin.email,
    auth_user_id: admin.authUserId,
    active: true,
  });

  const result = await service.sendStaffPasswordReset({ staffId: admin.staffId }, admin, request);

  assert.deepEqual(result, {
    accepted: false,
    retryAfter: null,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    failureCode: "SELF_RESET_NOT_ALLOWED",
  });
  assert.equal(calls.provider.length, 0);
  assert.equal(calls.actions.length, 0);
});

test("password reset uses the linked provider identity email instead of a stale staff directory email", async () => {
  const { service, calls, staff } = fixture();
  staff.set(targetId, {
    id: targetId,
    email: "info@earnesrproperty.com",
    auth_user_id: "auth-target",
    active: true,
  });

  const result = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);

  assert.equal(result.accepted, true);
  assert.deepEqual(calls.provider, [
    {
      method: "resolve",
      input: { authUserId: "auth-target", request },
    },
    {
      method: "reset",
      input: {
        email: "target@example.test",
        redirectTo: "https://earnest.test/auth/reset-password",
        request,
      },
    },
  ]);
});

test("password reset reports a safe action-store failure before requesting provider delivery", async () => {
  const { service, calls, staff, identityActions } = fixture();
  staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  identityActions.findIdentityActionCooldown = async () => {
    throw new Error("raw database details must not escape");
  };

  const result = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);

  assert.deepEqual(result, {
    accepted: false,
    retryAfter: null,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    failureCode: "STAFF_ACTION_STORE_UNAVAILABLE",
  });
  assert.equal(calls.provider.length, 0);
  assert.equal(calls.actions.filter((call) => call.method === "begin").length, 0);
  assert.doesNotMatch(JSON.stringify(result), /raw database details/i);
});

test("password reset stays safe when recording a provider failure itself fails", async () => {
  const { service, staff, identityActions } = fixture({
    provider: {
      resolveUser: async () => {
        throw Object.assign(new Error("provider outage"), { code: "PROVIDER_UNAVAILABLE" });
      },
    },
  });
  staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  identityActions.markIdentityActionRetryable = async () => {
    throw new Error("transient connection reset while recording the failure");
  };

  const result = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);

  assert.equal(result.accepted, false);
  assert.equal(result.requestId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("role changes delegate to the protected existing transaction and emit sanitized lifecycle audit", async () => {
  const { service, calls } = fixture();
  const result = await service.changeStaffRoles(
    { staffId: targetId, roles: ["manager"] },
    admin,
    request,
  );
  assert.deepEqual(result, {
    ok: true,
    roles: ["manager"],
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.deepEqual(calls.roleChanges[0].input, { staffId: targetId, roles: ["manager"] });
  assert.equal(calls.audit.at(-1).action, "staff.roles_changed");
  assert.equal(calls.audit.at(-1).permission, "staff.manage");
});

test("suspension preserves local deactivation when revocation fails, while reactivation resolves the linked identity first", async () => {
  const suspension = fixture({
    provider: {
      revokeUserSessions: async () => {
        throw Object.assign(new Error("do not leak"), { code: "PROVIDER_UNAVAILABLE" });
      },
    },
  });
  suspension.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: true,
  });
  const suspended = await suspension.service.changeStaffActive(
    { staffId: targetId, active: false },
    admin,
    request,
  );
  assert.equal(suspended.ok, true);
  assert.equal(suspension.calls.activeChanges.length, 1);
  assert.equal(suspension.calls.actions.at(-1).method, "retryable");
  assert.equal(suspension.calls.activeChanges[0].input.active, false);
  const activation = fixture();
  activation.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: "auth-target",
    active: false,
  });
  await activation.service.changeStaffActive({ staffId: targetId, active: true }, admin, request);
  assert.deepEqual(activation.calls.provider[0], {
    method: "resolve",
    input: { authUserId: "auth-target", request },
  });
  assert.deepEqual(activation.calls.activeChanges[0].input, {
    staffId: targetId,
    active: true,
    reassignToStaffId: null,
  });
  const absent = fixture();
  absent.staff.set(targetId, {
    id: targetId,
    email: "target@example.test",
    auth_user_id: null,
    active: false,
  });
  await assert.rejects(
    () => absent.service.changeStaffActive({ staffId: targetId, active: true }, admin, request),
    (error) => error instanceof Response && error.status === 400,
  );
  assert.equal(absent.calls.activeChanges.length, 0);
});

test("default lifecycle dependencies defer unrelated admin and audit modules", async () => {
  assert.equal(typeof lifecycleModule.createDefaultStaffLifecycleDependencies, "function");

  let adminDataLoads = 0;
  let auditLoads = 0;
  const dependencies = await lifecycleModule.createDefaultStaffLifecycleDependencies({
    loadAdminData: async () => {
      adminDataLoads += 1;
      throw new Error("admin data should stay lazy");
    },
    loadAudit: async () => {
      auditLoads += 1;
      throw new Error("audit should stay lazy");
    },
  });

  assert.equal(adminDataLoads, 0);
  assert.equal(auditLoads, 0);
  assert.equal(typeof dependencies.updateStaffRoles, "function");
  assert.equal(typeof dependencies.setStaffActive, "function");
  assert.equal(typeof dependencies.writeAudit, "function");
});

test("session revocation deletes neon_auth.session rows instead of calling the provider's admin API", async () => {
  // POST /admin/revoke-user-sessions requires a browser session cookie this
  // server can never hold (Neon's docs state admin ops are cookie-session
  // only; every forwarded credential was rejected 401 live). The endpoint's
  // entire server-side effect is internalAdapter.deleteSessions(userId) -- a
  // delete on the same neon_auth.session table this database holds -- so the
  // direct delete is equivalent, and strictly better than the always-401 call.
  assert.equal(typeof lifecycleModule.createNeonAuthSessionRevoker, "function");

  const queries = [];
  const revoke = lifecycleModule.createNeonAuthSessionRevoker(async (statement, params) => {
    queries.push({ statement, params });
    return [];
  });

  await revoke({ userId: "auth-target", request: new Request("https://earnest.test/x") });

  assert.match(queries[0].statement, /DELETE FROM neon_auth\.session/);
  assert.match(queries[0].statement, /"userId" = \$1/);
  assert.deepEqual(queries[0].params, ["auth-target"]);

  const broken = lifecycleModule.createNeonAuthSessionRevoker(async () => {
    throw new Error("raw database details must not escape");
  });
  await assert.rejects(
    () => broken({ userId: "auth-any", request: new Request("https://earnest.test/x") }),
    (error) => error.code === "PROVIDER_UNAVAILABLE" && !/raw database/.test(error.message),
  );
});

test("a legacy terminal invitation failure no longer bricks the member permanently", async () => {
  // Production evidence: Neon Auth's organization plugin is disabled on this
  // instance, so POST /organization/invite-member answered 404 ->
  // PROVIDER_INVITATION_NOT_FOUND -> markIdentityActionTerminal. A terminal
  // row then blocked BOTH paths with no escape hatch: resend threw
  // 400 "Invitation is not available to resend." (surfaced as 這項團隊操作未能執行)
  // and re-inviting hit the same idempotency key and returned "failed"
  // forever. Invitations are recorded locally now, so no provider can declare
  // one permanently gone -- the terminal guard only poisons legacy rows.
  const { service, staff, latestActions } = fixture();
  staff.set(targetId, {
    id: targetId,
    email: "kevinfong@example.test",
    auth_user_id: null,
    active: true,
  });
  latestActions.set(targetId, [
    {
      action: "invite",
      state: "terminal_failure",
      created_at: "2026-08-20T00:00:00.000Z",
      retry_after: null,
      provider_expires_at: null,
    },
  ]);

  const result = await service.resendStaffInvitation({ staffId: targetId }, admin, request);

  assert.equal(result.accepted, true);
});

test("invitations are recorded locally without any provider HTTP call", async () => {
  // No server-side credential exists for /organization/invite-member (Neon
  // docs: cookie-session only), and even an authenticated call only emails if
  // the hosted service configured sendInvitationEmail. Access never depended
  // on the provider invitation anyway: the staff row is committed before the
  // provider call, and auth.server.ts binds the account by verified email at
  // first sign-up. Invitations are therefore recorded locally; the UI tells
  // the admin to share the sign-up link.
  assert.equal(typeof lifecycleModule.createLocalStaffInvitation, "function");

  const invite = lifecycleModule.createLocalStaffInvitation();
  const result = await invite({
    email: "new@example.test",
    organizationId: "",
    request: new Request("https://earnest.test/x"),
  });

  assert.deepEqual(result, { state: "sent", expiresAt: null });
});

test("identity resolution reads neon_auth.user locally instead of calling the provider's admin API", async () => {
  // Every credential shape forwarded to Neon Auth's /admin/get-user has been
  // rejected 401 in production (three distinct attempts, all captured live).
  // The endpoint is redundant anyway: Neon Auth syncs its user table into this
  // database, and auth.server.ts already treats neon_auth."user" as
  // authoritative -- including emailVerified. Identity resolution must not
  // depend on the provider's HTTP admin surface at all.
  assert.equal(typeof lifecycleModule.createNeonAuthUserResolver, "function");

  const queries = [];
  const resolveUser = lifecycleModule.createNeonAuthUserResolver(async (statement, params) => {
    queries.push({ statement, params });
    return [
      { id: "auth-target", email: "target@example.test", name: "Target", email_verified: true },
    ];
  });

  const identity = await resolveUser({
    authUserId: "auth-target",
    request: new Request("https://earnest.test/admin/team"),
  });

  assert.deepEqual(identity, {
    id: "auth-target",
    email: "target@example.test",
    name: "Target",
    emailVerified: true,
  });
  assert.match(queries[0].statement, /FROM neon_auth\."user"/);
  assert.deepEqual(queries[0].params, ["auth-target"]);

  const missing = lifecycleModule.createNeonAuthUserResolver(async () => []);
  await assert.rejects(
    () => missing({ authUserId: "auth-gone", request: new Request("https://earnest.test/x") }),
    (error) => error.code === "PROVIDER_IDENTITY_NOT_FOUND",
  );

  const broken = lifecycleModule.createNeonAuthUserResolver(async () => {
    throw new Error("raw database details must not escape");
  });
  await assert.rejects(
    () => broken({ authUserId: "auth-any", request: new Request("https://earnest.test/x") }),
    (error) => error.code === "PROVIDER_UNAVAILABLE" && !/raw database/.test(error.message),
  );
});

// `dependencies.requestId ?? crypto.randomUUID` (no dependencies.requestId
// override -- i.e. the real default path createDefaultStaffLifecycleDependencies
// takes in production) stores the *unbound* method reference. Calling it later as
// a bare `nextRequestId()` detaches it from `crypto`, which a spec-strict WebCrypto
// implementation rejects with "Illegal invocation" / "Value of \"this\" must be of
// type Crypto" -- exactly the error a live production request returned (captured
// from the raw seroval response body of a real `/admin/team` password-reset call).
// V8 as embedded in plain `node --test` does not enforce this (`crypto.randomUUID`
// works fine detached there), which is exactly why this survived: every existing
// fixture in this file also overrides `requestId`, so the buggy fallback line was
// never exercised by any test, local run, or the discrepancy never surfaced until
// production. This test does not rely on the local runtime being strict -- it
// stubs `globalThis.crypto` with a wrapper that enforces the same branding a
// spec-compliant Crypto interface does, so it fails on the current code
// regardless of which V8 build runs it.
test("lifecycle actions generate a request id without depending on crypto.randomUUID's `this` binding", async () => {
  const realCrypto = globalThis.crypto;
  // A Proxy wrapping the real crypto object can't simulate this: `this` inside a
  // trapped method is the Proxy itself, not `target`, so even a correctly-bound
  // `crypto.randomUUID()` call would appear to fail. Use a plain branded object
  // instead -- the same shape a spec-strict native Crypto class enforces via an
  // internal slot: only a call whose receiver *is* this exact object passes.
  const strictCrypto = {
    randomUUID() {
      if (this !== strictCrypto) {
        throw new TypeError('Value of "this" must be of type Crypto');
      }
      return realCrypto.randomUUID();
    },
  };
  Object.defineProperty(globalThis, "crypto", { value: strictCrypto, configurable: true });
  try {
    const { service, staff } = fixture({ requestId: undefined });
    staff.set(targetId, {
      id: targetId,
      email: "target@example.test",
      auth_user_id: "auth-target",
      active: true,
    });

    const result = await service.sendStaffPasswordReset({ staffId: targetId }, admin, request);

    assert.equal(result.accepted, true);
    assert.equal(typeof result.requestId, "string");
    assert.ok(result.requestId.length > 0);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
  }
});
