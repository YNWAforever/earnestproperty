import assert from "node:assert/strict";
import test from "node:test";

import { createStaffAccessResolver } from "./auth.server.ts";

// requireStaffAccess is the security boundary for every admin server function
// and had no unit coverage: its binding rules were only ever exercised live.
// The resolver factory injects the two things it needs -- the SQL runner and
// the Neon Auth session lookup -- so the rules can be pinned here.
process.env.ADMIN_BOOTSTRAP_EMAILS = "";

const staffId = "22222222-2222-4222-8222-222222222222";
const request = new Request("https://earnest.test/admin/whatsapp", {
  headers: { authorization: "Bearer session-token" },
});
const session = {
  user: { id: "auth-kevin", email: "kevin@example.test", name: "Kevin" },
  session: { token: "session-token" },
};

function fixture({
  staffRow = null,
  emailVerified = false,
  getSession = async () => session,
} = {}) {
  const queries = [];
  const resolver = createStaffAccessResolver({
    queryRows: async (statement, params = []) => {
      queries.push({ statement, params });
      if (statement.includes("FROM staff_users s") && statement.includes("s.active = true")) {
        return staffRow ? [staffRow] : [];
      }
      if (statement.includes('"emailVerified"')) return [{ email_verified: emailVerified }];
      return [];
    },
    getSession,
  });
  return { resolver, queries };
}

const invitedRow = {
  id: staffId,
  auth_user_id: null,
  email: "kevin@example.test",
  name: "Kevin",
  roles: ["admin"],
};

async function denial(promise) {
  const error = await promise.then(
    () => null,
    (reason) => reason,
  );
  assert.ok(error instanceof Response, "expected a thrown Response");
  return { status: error.status, body: (await error.text()).trim() };
}

test("an invited member whose Neon Auth email is verified is bound on first request", async () => {
  const { resolver, queries } = fixture({ staffRow: invitedRow, emailVerified: true });

  const access = await resolver.requireStaffAccess(request, ["admin"]);

  assert.equal(access.staffId, staffId);
  assert.equal(access.authUserId, "auth-kevin");
  assert.deepEqual(access.roles, ["admin"]);
  const bind = queries.find((query) => /UPDATE staff_users/.test(query.statement));
  assert.ok(bind, "the row must be bound to the Neon Auth account");
  assert.deepEqual(bind.params, ["auth-kevin", staffId]);
});

test("an invited member whose Neon Auth email is NOT verified is refused with a distinct reason", async () => {
  // Neon Auth does not verify emails unless the project enables it, so this
  // is the state every invited member lands in by default. Previously it was
  // indistinguishable from "not a staff member at all": a bare 403 Forbidden,
  // no log line, and the admin's role changes appeared to do nothing.
  const { resolver, queries } = fixture({ staffRow: invitedRow, emailVerified: false });

  const refused = await denial(resolver.requireStaffAccess(request, ["admin"]));

  assert.deepEqual(refused, { status: 403, body: "staff-email-unverified" });
  assert.equal(
    queries.some((query) => /UPDATE staff_users/.test(query.statement)),
    false,
    "an unverified email must never bind the row",
  );
});

test("a member already bound by auth_user_id never consults emailVerified", async () => {
  const { resolver, queries } = fixture({
    staffRow: { ...invitedRow, auth_user_id: "auth-kevin", roles: ["agent"] },
    emailVerified: false,
  });

  const access = await resolver.requireStaffAccess(request, ["admin", "manager", "agent"]);

  assert.deepEqual(access.roles, ["agent"]);
  assert.equal(
    queries.some((query) => query.statement.includes('"emailVerified"')),
    false,
    "auth_user_id is already proof of identity",
  );
});

test("no staff row at all stays a plain Forbidden, and no session is Unauthorized", async () => {
  const missing = fixture({ staffRow: null });
  assert.deepEqual(await denial(missing.resolver.requireStaffAccess(request, ["admin"])), {
    status: 403,
    body: "Forbidden",
  });

  const signedOut = fixture({ staffRow: invitedRow, getSession: async () => null });
  assert.deepEqual(await denial(signedOut.resolver.requireStaffAccess(request, ["admin"])), {
    status: 401,
    body: "Unauthorized",
  });
});

test("a bound member without one of the allowed roles is Forbidden", async () => {
  const { resolver } = fixture({
    staffRow: { ...invitedRow, auth_user_id: "auth-kevin", roles: ["agent"] },
  });

  assert.deepEqual(await denial(resolver.requireStaffAccess(request, ["admin", "manager"])), {
    status: 403,
    body: "Forbidden",
  });
});
