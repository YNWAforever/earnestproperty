import assert from "node:assert/strict";
import test from "node:test";

import { createAdminTeamReadModel, decodeAdminTeamCursor } from "./admin-team.server.ts";
import { createAdminTeamServerBoundary } from "./admin-team.ts";

const actor = {
  staffId: "11111111-1111-4111-8111-111111111111",
  authUserId: "auth-admin",
  email: "admin@example.test",
  name: "Admin",
  roles: ["admin"],
  bootstrap: false,
  matchedProfileOnly: false,
};

const staffId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  const queries = [];
  const model = createAdminTeamReadModel({
    queryRows: async (statement, params = []) => {
      queries.push({ statement, params });
      if (statement.includes("team_page")) {
        return [
          {
            id: staffId,
            name: "  Ada Lovelace  ",
            email: "Ada@Example.Test",
            roles: ["admin", "manager"],
            active: true,
            created_at: "2026-08-16T00:00:00.123Z",
            updated_at: "2026-08-16T01:00:00.456Z",
            created_at_cursor: "2026-08-16T00:00:00.123456Z",
            latest_action: "invite",
            latest_action_state: "succeeded",
            latest_retry_after: null,
            latest_provider_expires_at: "2026-08-17T00:00:00.000Z",
            active_count: 7,
            invited_count: 2,
            suspended_count: 1,
            attention_count: 3,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Grace Hopper",
            email: "grace@example.test",
            roles: ["manager"],
            active: true,
            created_at: "2026-08-15T00:00:00.123Z",
            updated_at: "2026-08-15T01:00:00.456Z",
            created_at_cursor: "2026-08-15T00:00:00.123456Z",
            latest_action: null,
            latest_action_state: null,
            latest_retry_after: null,
            latest_provider_expires_at: null,
            active_count: 7,
            invited_count: 2,
            suspended_count: 1,
            attention_count: 3,
          },
        ];
      }
      return [
        {
          id: staffId,
          name: "Ada Lovelace",
          email: "ada@example.test",
          auth_user_id: "auth-ada",
          roles: ["admin"],
          active: true,
          created_at: "2026-08-16T00:00:00.123Z",
          updated_at: "2026-08-16T01:00:00.456Z",
          latest_action: "invite",
          latest_action_state: "retryable_failure",
          latest_safe_error_code: "PROVIDER_UNAVAILABLE",
          latest_retry_after: "2026-08-16T02:00:00.000Z",
          latest_provider_expires_at: "2026-08-17T00:00:00.000Z",
          activity: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              action: "staff.invited",
              outcome: "success",
              createdAt: "2026-08-16T00:00:00.000Z",
            },
          ],
        },
      ];
    },
    fetchStaffAccessSummary: async () => ({
      staffId,
      roles: ["admin"],
      active: true,
      isSelf: false,
      isLastAdmin: false,
      isProtected: false,
      owned: { inquiries: 2 },
      ownedTotal: 2,
    }),
  });
  return { model, queries };
}

test("listAdminTeam projects safe filtered members, counts, and a keyset cursor", async () => {
  const { model, queries } = fixture();
  const result = await model.listAdminTeam(
    {
      q: "  ADA@EXAMPLE.TEST  ",
      role: "admin",
      state: "active",
      limit: 1,
      cursor: Buffer.from(
        JSON.stringify({ createdAt: "2026-08-15T00:00:00.654321Z", id: staffId }),
      ).toString("base64url"),
    },
    actor,
  );

  assert.deepEqual(result.counts, { active: 7, invited: 2, suspended: 1, attention: 3 });
  assert.deepEqual(result.members[0], {
    id: staffId,
    name: "Ada Lovelace",
    email: "Ada@Example.Test",
    roles: ["admin", "manager"],
    accessState: "active",
    invitationState: "sent",
    invitationRetryAfter: null,
    invitationExpiresAt: "2026-08-17T00:00:00.000Z",
    createdAt: "2026-08-16T00:00:00.123Z",
    updatedAt: "2026-08-16T01:00:00.456Z",
    needsAttention: false,
  });
  assert.deepEqual(decodeAdminTeamCursor(result.nextCursor), {
    createdAt: "2026-08-16T00:00:00.123456Z",
    id: staffId,
  });

  assert.equal(queries.length, 1);
  const { statement, params } = queries[0];
  assert.match(statement, /FROM staff_users s/);
  assert.match(statement, /staff_roles/);
  assert.match(statement, /LEFT JOIN LATERAL[\s\S]*staff_identity_actions/);
  assert.match(statement, /ILIKE/);
  assert.match(statement, /ORDER BY created_at DESC, id DESC/);
  assert.match(statement, /\(s\.created_at, s\.id\) < \(/);
  assert.match(statement, /COUNT\(\*\) FILTER \(WHERE active\) AS active_count/);
  assert.doesNotMatch(statement, /\bOFFSET\b/);
  assert.equal(params[0], "ada@example.test");
  assert.equal(params[1], "admin");
  assert.equal(params[2], "active");
  assert.equal(params[3], "2026-08-15T00:00:00.654321Z");
  assert.equal(params[4], staffId);
  assert.equal(params.at(-1), 2);
});

test("getAdminTeamMember returns a safe detail projection with ownership and activity", async () => {
  const { model } = fixture();
  const result = await model.getAdminTeamMember({ staffId }, actor);

  assert.equal(result.member.id, staffId);
  assert.equal(result.member.invitationState, "failed");
  assert.equal(result.member.needsAttention, true);
  assert.equal(result.identity.authUserLinked, true);
  assert.deepEqual(result.ownership, { counts: { inquiries: 2 }, total: 2 });
  assert.equal(result.latestOperation.safeErrorCode, "PROVIDER_UNAVAILABLE");
  assert.deepEqual(result.recentActivity, [
    {
      id: "33333333-3333-4333-8333-333333333333",
      action: "staff.invited",
      outcome: "success",
      createdAt: "2026-08-16T00:00:00.000Z",
    },
  ]);
  assert.match(result.version, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(result), /token|provider_payload|email_body|cookie|password/i);
});

test("invalid list and member inputs fail closed with 400", async () => {
  const { model } = fixture();
  for (const input of [
    { q: "x".repeat(201) },
    { role: "owner" },
    { state: "deleted" },
    { cursor: "not-a-cursor" },
    { limit: 51 },
  ]) {
    await assert.rejects(
      () => model.listAdminTeam(input, actor),
      (error) => error instanceof Response && error.status === 400,
    );
  }
  await assert.rejects(
    () => model.getAdminTeamMember({ staffId: "not-a-uuid" }, actor),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("admin Team cursors require canonical base64url and real UTC microsecond timestamps", () => {
  const valid = Buffer.from(
    JSON.stringify({ createdAt: "2028-02-29T23:59:59.123456Z", id: staffId }),
  ).toString("base64url");
  assert.deepEqual(decodeAdminTeamCursor(valid), {
    createdAt: "2028-02-29T23:59:59.123456Z",
    id: staffId,
  });

  const impossibleDate = Buffer.from(
    JSON.stringify({ createdAt: "2026-02-30T12:00:00.123456Z", id: staffId }),
  ).toString("base64url");
  for (const cursor of [valid + "=", valid + " ", impossibleDate]) {
    assert.throws(
      () => decodeAdminTeamCursor(cursor),
      (error) => error instanceof Response && error.status === 400,
    );
  }
});

test("server read boundary authorizes admin and manager before loading the data module", async () => {
  const request = new Request("https://earnest.test/admin/team");
  const calls = [];
  const boundary = createAdminTeamServerBoundary({
    requireStaffAccess: async (receivedRequest, roles) => {
      calls.push({ kind: "auth", receivedRequest, roles });
      return actor;
    },
    loadReadModel: async () => ({
      listAdminTeam: async (input, receivedActor) => {
        calls.push({ kind: "read", input, receivedActor });
        return {
          members: [],
          counts: { active: 0, invited: 0, suspended: 0, attention: 0 },
          nextCursor: null,
        };
      },
      getAdminTeamMember: async () => assert.fail("not called"),
    }),
  });
  await boundary.listAdminTeam({ q: "Ada" }, request);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["auth", "read"],
  );
  assert.equal(calls[0].receivedRequest, request);
  assert.deepEqual(calls[0].roles, ["admin", "manager"]);

  for (const deniedCase of [
    { name: "Agent", status: 403, body: "Forbidden" },
    { name: "unauthenticated", status: 401, body: "Unauthorized" },
  ]) {
    let loaded = false;
    let queryCalls = 0;
    const denied = createAdminTeamServerBoundary({
      requireStaffAccess: async () => {
        throw new Response(deniedCase.body, { status: deniedCase.status });
      },
      loadReadModel: async () => {
        loaded = true;
        return {
          listAdminTeam: async () => {
            queryCalls += 1;
            return assert.fail("read must not run after authorization failure");
          },
          getAdminTeamMember: async () => {
            queryCalls += 1;
            return assert.fail("read must not run after authorization failure");
          },
        };
      },
    });
    await assert.rejects(
      () => denied.getAdminTeamMember({ staffId }, request),
      (error) => error instanceof Response && error.status === deniedCase.status,
    );
    assert.equal(loaded, false, `${deniedCase.name} must not load the read module`);
    assert.equal(queryCalls, 0, `${deniedCase.name} must not query the read model`);
  }
});
