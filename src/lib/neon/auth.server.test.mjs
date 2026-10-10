import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createNeonSessionReader, createStaffAccessResolver } from "./auth.server.ts";

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
  bindRows = [{ id: staffId, auth_user_id: session.user.id }],
  bindError = false,
  getSession = async () => session,
} = {}) {
  const queries = [];
  const resolver = createStaffAccessResolver({
    queryRows: async (statement, params = []) => {
      queries.push({ statement, params });
      if (statement.includes("FROM staff_users s") && statement.includes("s.active = true")) {
        return staffRow ? [staffRow] : [];
      }
      if (statement.includes('"emailVerified"'))
        return [{ id: session.user.id, email: session.user.email, email_verified: emailVerified }];
      if (statement.includes("UPDATE staff_users")) {
        if (bindError) throw new Error("synthetic bind failure");
        return bindRows;
      }
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
  assert.deepEqual(bind.params, ["auth-kevin", staffId, "kevin@example.test"]);
});

test("a verified invited member is refused when another account wins the bind", async () => {
  const { resolver } = fixture({ staffRow: invitedRow, emailVerified: true, bindRows: [] });
  assert.equal((await denial(resolver.requireStaffAccess(request, ["admin"]))).status, 403);
});

test("a verified invited member is refused when binding fails", async () => {
  const { resolver } = fixture({ staffRow: invitedRow, emailVerified: true, bindError: true });
  await assert.rejects(resolver.requireStaffAccess(request, ["admin"]), /synthetic bind failure/);
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

test("an unverified allowlisted identity cannot bootstrap or write staff rows", async () => {
  process.env.ADMIN_BOOTSTRAP_EMAILS = session.user.email;
  const writes = [];
  const resolver = createStaffAccessResolver({
    getSession: async () => session,
    queryRows: async (statement, params = []) => {
      if (/INSERT|UPDATE/.test(statement)) {
        writes.push({ statement, params });
        return [{ id: staffId, auth_user_id: session.user.id, email: session.user.email }];
      }
      if (statement.includes('"emailVerified"')) return [{ email_verified: false }];
      return [];
    },
  });
  try {
    const result = await resolver.requireStaffAccess(request).then(
      (access) => access,
      (error) => error,
    );
    assert.equal(result instanceof Response ? result.status : result.roles.join(","), 403);
    assert.deepEqual(writes, []);
  } finally {
    process.env.ADMIN_BOOTSTRAP_EMAILS = "";
  }
});

function bootstrapFixture({
  verified = true,
  providerId = session.user.id,
  providerEmail = session.user.email,
  providerMissing = false,
  providerError = false,
  staffRow = null,
  staffRows = [],
  allowlisted = true,
  raceLost = false,
} = {}) {
  process.env.ADMIN_BOOTSTRAP_EMAILS = allowlisted ? session.user.email : "other@example.test";
  const writes = [];
  const queryRows = async (statement, params = []) => {
    if (/INSERT|UPDATE/.test(statement)) {
      writes.push({ statement, params });
      return [{ id: staffId, auth_user_id: session.user.id, email: session.user.email }];
    }
    if (statement.includes('"emailVerified"')) {
      if (providerError) throw new Error("synthetic provider lookup failure");
      return providerMissing
        ? []
        : [{ id: providerId, email: providerEmail, email_verified: verified }];
    }
    if (statement.includes("s.active = true")) return staffRow ? [staffRow] : [];
    if (statement.includes("FROM staff_users s")) return staffRows;
    return [];
  };
  return {
    writes,
    resolver: createStaffAccessResolver({
      getSession: async () => session,
      queryRows,
      transactionRows: async (statements) => {
        writes.push(...statements);
        return [
          [],
          raceLost
            ? []
            : [{ id: staffId, auth_user_id: session.user.id, email: session.user.email }],
        ];
      },
    }),
  };
}

for (const [label, options] of [
  ["unverified", { verified: false }],
  ["missing verification", { verified: undefined, providerMissing: true }],
  ["provider unavailable", { providerError: true }],
  ["mismatched provider identity", { providerId: "another-account" }],
  ["mismatched provider email", { providerEmail: "another@example.test" }],
  ["not allowlisted", { allowlisted: false }],
  [
    "existing admin elsewhere",
    { staffRows: [{ auth_user_id: "existing-admin", roles: ["admin"] }] },
  ],
  ["disabled bound staff", { staffRows: [{ auth_user_id: session.user.id, roles: ["agent"] }] }],
]) {
  test(`bootstrap rejects ${label} with no staff or role writes`, async () => {
    const { resolver, writes } = bootstrapFixture(options);
    try {
      assert.equal((await denial(resolver.requireStaffAccess(request))).status, 403);
      assert.deepEqual(writes, []);
    } finally {
      process.env.ADMIN_BOOTSTRAP_EMAILS = "";
    }
  });
}

test("verified allowlisted owner bootstraps through one locked transaction", async () => {
  const { resolver, writes } = bootstrapFixture();
  try {
    const access = await resolver.requireStaffAccess(request);
    assert.equal(access.bootstrap, true);
    assert.deepEqual(access.roles, ["admin"]);
    assert.equal(writes.length, 2);
    assert.match(
      writes[0].statement,
      /LOCK TABLE staff_users, staff_roles IN SHARE ROW EXCLUSIVE MODE/,
    );
    assert.match(writes[1].statement, /INSERT INTO staff_roles/);
  } finally {
    process.env.ADMIN_BOOTSTRAP_EMAILS = "";
  }
});

test("profile-only owner binding is deferred into the bootstrap transaction", async () => {
  const { resolver, writes } = bootstrapFixture({
    staffRow: { ...invitedRow, roles: [] },
    staffRows: [{ auth_user_id: null, roles: [] }],
  });
  try {
    assert.equal((await resolver.requireStaffAccess(request)).bootstrap, true);
    assert.equal(writes.length, 2, "no pre-transaction staff bind");
  } finally {
    process.env.ADMIN_BOOTSTRAP_EMAILS = "";
  }
});

test("a bootstrap race loser receives no fabricated admin access", async () => {
  const { resolver } = bootstrapFixture({ raceLost: true });
  try {
    assert.equal((await denial(resolver.requireStaffAccess(request))).status, 403);
  } finally {
    process.env.ADMIN_BOOTSTRAP_EMAILS = "";
  }
});

test("an existing bound admin keeps access without provider verification or writes", async () => {
  const { resolver, writes } = bootstrapFixture({
    verified: false,
    staffRow: { ...invitedRow, auth_user_id: session.user.id },
    staffRows: [{ auth_user_id: session.user.id, roles: ["admin"] }],
  });
  try {
    assert.deepEqual((await resolver.requireStaffAccess(request)).roles, ["admin"]);
    assert.deepEqual(writes, []);
  } finally {
    process.env.ADMIN_BOOTSTRAP_EMAILS = "";
  }
});

test("unverified allowlisted profile never binds before bootstrap denial", async () => {
  const { resolver, writes } = bootstrapFixture({
    verified: false,
    staffRow: { ...invitedRow, roles: [] },
    staffRows: [{ auth_user_id: null, roles: [] }],
  });
  try {
    assert.equal((await denial(resolver.requireStaffAccess(request))).status, 403);
    assert.deepEqual(writes, []);
  } finally {
    process.env.ADMIN_BOOTSTRAP_EMAILS = "";
  }
});

for (const verified of [null, "true", 1]) {
  test(`non-boolean provider verification ${JSON.stringify(verified)} cannot bootstrap`, async () => {
    const { resolver, writes } = bootstrapFixture({ verified });
    try {
      assert.equal((await denial(resolver.requireStaffAccess(request))).status, 403);
      assert.deepEqual(writes, []);
    } finally {
      process.env.ADMIN_BOOTSTRAP_EMAILS = "";
    }
  });
}

test("a live bearer session is accepted and a revoked token is denied", async () => {
  const queries = [];
  const queryRows = async (statement, params = []) => {
    queries.push({ statement, params });
    if (!statement.includes("FROM neon_auth.session s") || params[0] !== "live-token") return [];
    return [{ id: "auth-kevin", email: "kevin@example.test", name: "Kevin" }];
  };
  const previousAuthUrl = process.env.NEON_AUTH_BASE_URL;
  process.env.NEON_AUTH_BASE_URL = "https://auth.invalid";
  try {
    const read = createNeonSessionReader(queryRows);
    const live = await read(
      new Request("https://earnest.test/admin", {
        headers: { authorization: "Bearer live-token" },
      }),
    );
    assert.equal(live?.user.id, "auth-kevin");
    const revoked = await read(
      new Request("https://earnest.test/admin", {
        headers: { authorization: "Bearer revoked-token" },
      }),
    );
    assert.equal(revoked, null);
    assert.equal(queries.length, 2);
    assert.ok(
      queries.every(
        ({ statement }) =>
          statement.includes("FROM neon_auth.session s") &&
          statement.includes('s."expiresAt" > now()'),
      ),
    );
  } finally {
    if (previousAuthUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousAuthUrl;
  }
});

async function withCountedFetch(run) {
  const previousFetch = globalThis.fetch;
  const previousAuthUrl = process.env.NEON_AUTH_BASE_URL;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ user: { id: "auth-cookie" } }), { status: 200 });
  };
  process.env.NEON_AUTH_BASE_URL = "https://auth.invalid";
  try {
    await run(() => fetchCalls);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAuthUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousAuthUrl;
  }
}

const visitorCookie = "_ga=GA1.1.x; neon-auth.session_token=abc";

test("cookie-only request is unauthenticated", async () => {
  let queryCalls = 0;
  const queryRows = async () => {
    queryCalls += 1;
    return [];
  };
  await withCountedFetch(async (fetchCalls) => {
    const read = createNeonSessionReader(queryRows);
    const result = await read(
      new Request("https://earnest.test/admin", { headers: { cookie: visitorCookie } }),
    );
    assert.equal(result, null);
    assert.equal(fetchCalls(), 0);
    assert.equal(queryCalls, 0);
  });
});

test("a bearer request with cookies still authenticates and forwards no cookie", async () => {
  const queryRows = async (statement, params = []) =>
    statement.includes("FROM neon_auth.session s") && params[0] === "live-token"
      ? [{ id: "auth-kevin", email: "kevin@example.test", name: "Kevin" }]
      : [];
  await withCountedFetch(async (fetchCalls) => {
    const read = createNeonSessionReader(queryRows);
    const result = await read(
      new Request("https://earnest.test/admin", {
        headers: { cookie: visitorCookie, authorization: "Bearer live-token" },
      }),
    );
    assert.equal(result?.user.id, "auth-kevin");
    assert.equal(fetchCalls(), 0);
  });
});

test("the session reader never calls Neon Auth over HTTP", () => {
  const source = readFileSync(new URL("./auth.server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("get-session"), false);
  assert.equal(source.includes('headers.get("cookie")'), false);
});

test("a signed JWT cannot bypass a revoked Neon Auth session", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "auth-kevin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const data = header + "." + payload;
  const token = data + "." + sign(null, Buffer.from(data), privateKey).toString("base64url");
  const queries = [];
  const queryRows = async (statement) => {
    queries.push(statement);
    if (statement.includes("FROM neon_auth.jwks"))
      return [{ publicKey: JSON.stringify(publicKey.export({ format: "jwk" })) }];
    if (statement.includes('FROM neon_auth."user"'))
      return [{ id: "auth-kevin", email: "kevin@example.test", name: "Kevin" }];
    return [];
  };
  const previousAuthUrl = process.env.NEON_AUTH_BASE_URL;
  process.env.NEON_AUTH_BASE_URL = "https://auth.invalid";
  try {
    const read = createNeonSessionReader(queryRows);
    const result = await read(
      new Request("https://earnest.test/admin", {
        headers: { authorization: "Bearer " + token },
      }),
    );
    assert.equal(result, null);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /FROM neon_auth.session s/);
  } finally {
    if (previousAuthUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = previousAuthUrl;
  }
});

test("a bound staff identity excludes email-only fallback, including after deactivation", async () => {
  let lookup = "";
  const resolver = createStaffAccessResolver({
    getSession: async () => session,
    queryRows: async (statement) => {
      if (statement.includes("FROM staff_users s") && statement.includes("s.active = true")) {
        lookup = statement;
      }
      return [];
    },
  });
  assert.equal((await denial(resolver.requireStaffAccess(request, ["admin"]))).status, 403);
  assert.match(
    lookup,
    /s\.auth_user_id IS NULL\s+AND NOT EXISTS\s*\(\s*SELECT 1 FROM staff_users bound\s+WHERE bound.auth_user_id = \$1\s*\)/,
    "a disabled or active row already bound to this identity must block email fallback",
  );
});
