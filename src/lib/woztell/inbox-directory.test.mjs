import assert from "node:assert/strict";
import test from "node:test";
import { createInboxApi } from "./inbox-api.server.ts";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  listInboxCandidates,
  listInboxFolders,
  saveInboxFolder,
  verifyInboxSelection,
} from "../neon/inbox-directory.server.ts";
import { saveReviewedStaffChannel } from "../neon/staff-mapping-review.server.ts";

const config = {
  verificationRef: "fixture",
  appId: "app",
  appIntegrationId: "integration",
  signature: "fixture-signature",
  channelId: "company",
  listThreadsUrl: "https://api.inbox.woztell.sanuker.com/v1.0/api/list-threads",
  listUsersUrl: "https://api.inbox.woztell.sanuker.com/v1.0/api/list-users",
  assignUrl: "https://api.inbox.woztell.sanuker.com/v1.0/update-thread-agent",
  internalMessageUrl: "https://api.inbox.woztell.sanuker.com/v1.0/internal-message",
};
const page = (data, hasNext = false, after = null) => ({
  ok: 1,
  data,
  paging: { hasNext, hasPrevious: false, cursors: { after, before: null } },
});
const user = (userId, name = "Same Name", channel = "company") => ({
  userId,
  name,
  email: userId + "@example.test",
  channel,
  role: "USER",
  agentRole: "AGENT",
});
test("list-users uses documented filters and preserves duplicate display names across pages", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const after = new URL(url).searchParams.get("after");
    return Response.json(after ? page([user("user-2")]) : page([user("user-1")], true, "next"));
  };
  const api = createInboxApi(config, fetchImpl);
  const first = await api.listUsers({ channelId: "company", folderId: "main", limit: 20 });
  const second = await api.listUsers({
    channelId: "company",
    folderId: "main",
    limit: 20,
    after: first.nextCursor,
  });
  assert.deepEqual(
    first.items.map((item) => item.userId),
    ["user-1"],
  );
  assert.deepEqual(
    second.items.map((item) => item.userId),
    ["user-2"],
  );
  assert.equal(first.items[0].name, second.items[0].name);
  assert.equal(first.nextCursor, "next");
  assert.equal(second.nextCursor, null);
  assert.equal(calls[0].url.searchParams.get("channelId"), "company");
  assert.equal(calls[0].url.searchParams.get("folderId"), "main");
  assert.equal(calls[0].url.searchParams.get("limit"), "20");
  assert.equal(calls[1].url.searchParams.get("after"), "next");
  assert.equal(calls[0].url.searchParams.has("email"), false);
  assert.equal(
    calls[0].init.headers["X-Woztell-Payload"],
    JSON.stringify({ appIntegration: "integration", app: "app" }),
  );
});
test("list-users refuses wrong Channel, malformed cursors and provider failures", async () => {
  for (const response of [
    Response.json(page([user("other", "Name", "wrong")])),
    Response.json(page([user("u")], true, "same")),
    Response.json({ ok: 1, data: {}, paging: {} }),
    new Response("", { status: 401 }),
    new Response("", { status: 403 }),
    new Response("", { status: 429 }),
    new Response("", { status: 503 }),
  ]) {
    const api = createInboxApi(config, async () => response.clone());
    await assert.rejects(
      api.listUsers({ channelId: "company", after: response.status === 200 ? "same" : undefined }),
      /WOZTELL_INBOX_/,
    );
  }
  for (const [status, code] of [
    [401, "WOZTELL_INBOX_AUTH_DENIED"],
    [403, "WOZTELL_INBOX_AUTH_DENIED"],
    [429, "WOZTELL_INBOX_RATE_LIMITED"],
    [503, "WOZTELL_INBOX_UNAVAILABLE"],
  ]) {
    const api = createInboxApi(config, async () => new Response("", { status }));
    await assert.rejects(api.listUsers({ channelId: "company" }), new RegExp(code));
  }
  const wrongUser = createInboxApi(config, async () => Response.json(page([user("other")])));
  await assert.rejects(
    wrongUser.listUsers({ channelId: "company", userId: "expected" }),
    /WOZTELL_INBOX_RESULT_INVALID/,
  );
  const api = createInboxApi(config, async () => Response.json(page([])));
  await assert.rejects(api.listUsers({ channelId: "wrong" }), /WOZTELL_INBOX_SCOPE_MISMATCH/);
});

const actorId = "20000000-0000-4000-8000-000000000001";
const staffId = "20000000-0000-4000-8000-000000000002";
const actor = { staffId: actorId, roles: ["admin"] };

async function directoryDb() {
  const db = new PGlite();
  await db.exec(
    [
      "CREATE TABLE staff_users(id uuid PRIMARY KEY, active boolean NOT NULL);",
      "CREATE TABLE staff_roles(staff_user_id uuid NOT NULL, role text NOT NULL);",
      "CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text, subject_type text, subject_id uuid, metadata jsonb);",
      "CREATE TABLE whatsapp_staff_channels(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES staff_users(id), channel_id text NOT NULL, inbox_user_id text NOT NULL, folder_id text NOT NULL, routing_node_id text NOT NULL, branch_id text, eligible boolean NOT NULL DEFAULT false, verification_ref text, verified_at timestamptz, verified_by uuid, retired_at timestamptz, UNIQUE(channel_id,inbox_user_id), UNIQUE(channel_id,staff_id));",
    ].join(" "),
  );
  await db.query("INSERT INTO staff_users(id,active) VALUES ($1,true),($2,true)", [
    actorId,
    staffId,
  ]);
  await db.query("INSERT INTO staff_roles(staff_user_id,role) VALUES ($1,'admin')", [actorId]);
  await db.exec(
    readFileSync("neon/migrations/20260927110000_staff_mapping_review_versions.sql", "utf8"),
  );
  await db.exec(readFileSync("neon/migrations/20260927120000_named_inbox_folders.sql", "utf8"));
  return db;
}
test("catalog and candidate cache keep tenant, Channel, and provider identity separate", async () => {
  const db = await directoryDb();
  const previous = {
    channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
    integration: process.env.EP_WA_INBOX_INTEGRATION_ID,
  };
  process.env.EP_WA_COMPANY_CHANNEL_ID = "company";
  process.env.EP_WA_INBOX_INTEGRATION_ID = "integration";
  let calls = 0;
  const ports = {
    query: async (sql, params = []) => (await db.query(sql, params)).rows,
    rateLimit: async () => {},
    provider: {
      listUsers: async ({ channelId, folderId, after, userId }) => {
        calls++;
        assert.equal(channelId, process.env.EP_WA_COMPANY_CHANNEL_ID);
        if (userId) return { items: [], nextCursor: null };
        if (folderId) assert.equal(folderId, "main");
        return after
          ? {
              items: [
                {
                  userId: "u3",
                  name: "Alex Other",
                  email: "other@example.test",
                  channelId,
                  role: "AGENT",
                },
              ],
              nextCursor: null,
            }
          : {
              items: [
                {
                  userId: "u1",
                  name: "Alex Same",
                  email: "one@example.test",
                  channelId,
                  role: "AGENT",
                },
                {
                  userId: "u2",
                  name: "Alex Same",
                  email: "two@example.test",
                  channelId,
                  role: "AGENT",
                },
              ],
              nextCursor: "page-2",
            };
      },
    },
  };
  try {
    await assert.rejects(
      listInboxFolders({ staffId, roles: ["agent"] }, ports),
      (error) => error.status === 403,
    );
    assert.deepEqual(await listInboxFolders(actor, ports), []);
    await assert.rejects(
      listInboxCandidates({ query: "" }, { staffId, roles: ["agent"] }, ports),
      (error) => error.status === 403,
    );
    const folder = await saveInboxFolder(
      {
        folderKey: "main",
        displayName: "Main Inbox",
        providerFolderId: "main",
        expectedVersion: null,
      },
      actor,
      ports,
    );
    assert.equal(folder.version, 1);
    const listed = await listInboxFolders(actor, ports);
    assert.equal(listed[0].displayName, "Main Inbox");
    assert.equal(listed[0].source, "admin_catalog");
    const first = await listInboxCandidates({ query: "alex", folderKey: "main" }, actor, ports);
    assert.deepEqual(
      first.items.map((item) => item.userId),
      ["u1", "u2"],
    );
    assert.equal(first.nextCursor, "page-2");
    const cached = await listInboxCandidates({ query: "two@", folderKey: "main" }, actor, ports);
    assert.deepEqual(
      cached.items.map((item) => item.userId),
      ["u2"],
    );
    assert.equal(calls, 1);
    const second = await listInboxCandidates(
      { query: "alex", folderKey: "main", cursor: first.nextCursor },
      actor,
      ports,
    );
    assert.deepEqual(
      second.items.map((item) => item.userId),
      ["u3"],
    );
    assert.equal(calls, 2);
    process.env.EP_WA_INBOX_INTEGRATION_ID = "another-integration";
    assert.deepEqual(await listInboxFolders(actor, ports), []);
    await assert.rejects(
      listInboxCandidates({ query: "" }, { staffId, roles: ["agent"] }, ports),
      (error) => error.status === 403,
    );
    await listInboxCandidates({ query: "alex" }, actor, ports);
    assert.equal(calls, 3, "a different tenant scope must not read the cached first page");
    process.env.EP_WA_COMPANY_CHANNEL_ID = "other-channel";
    await listInboxCandidates({ query: "alex" }, actor, ports);
    assert.equal(calls, 4, "a different Channel must not read the cached page");
  } finally {
    if (previous.channel === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    else process.env.EP_WA_COMPANY_CHANNEL_ID = previous.channel;
    if (previous.integration === undefined) delete process.env.EP_WA_INBOX_INTEGRATION_ID;
    else process.env.EP_WA_INBOX_INTEGRATION_ID = previous.integration;
    await db.close();
  }
});
test("fresh Folder access creates scoped evidence; denial and timeout never authorize a mapping", async () => {
  const db = await directoryDb();
  const previous = {
    channel: process.env.EP_WA_COMPANY_CHANNEL_ID,
    integration: process.env.EP_WA_INBOX_INTEGRATION_ID,
  };
  process.env.EP_WA_COMPANY_CHANNEL_ID = "company";
  process.env.EP_WA_INBOX_INTEGRATION_ID = "integration";
  let fail = false;
  const ports = {
    query: async (sql, params = []) => (await db.query(sql, params)).rows,
    rateLimit: async () => {},
    provider: {
      listUsers: async ({ channelId, folderId, userId }) => {
        assert.equal(channelId, "company");
        assert.equal(folderId, "main");
        assert.ok(userId);
        if (fail) throw new Error("WOZTELL_PROVIDER_TIMEOUT");
        return {
          items:
            userId === "u1"
              ? [{ userId, name: "Alex", email: "alex@example.test", channelId, role: "AGENT" }]
              : [],
          nextCursor: null,
        };
      },
    },
  };
  try {
    await saveInboxFolder(
      {
        folderKey: "main",
        displayName: "Main Inbox",
        providerFolderId: "main",
        expectedVersion: null,
      },
      actor,
      ports,
    );
    const denied = await verifyInboxSelection(
      {
        staffId,
        userId: "u2",
        folderKey: "main",
        expectedVersion: null,
      },
      actor,
      ports,
    );
    assert.equal(denied.result, "denied");
    await assert.rejects(
      saveReviewedStaffChannel(
        {
          staffId,
          expectedVersion: null,
          evidenceId: denied.evidenceId,
          eligible: true,
        },
        actor,
        ports,
      ),
      (error) => error.status === 409,
    );
    const approved = await verifyInboxSelection(
      {
        staffId,
        userId: "u1",
        folderKey: "main",
        expectedVersion: null,
      },
      actor,
      ports,
    );
    assert.equal(approved.result, "verified");
    const { rows: events } = await db.query(
      "SELECT provider_scope,channel_id,folder_id,inbox_user_id,basis,result,mapping_version FROM whatsapp_staff_mapping_reviews ORDER BY checked_at",
    );
    assert.equal(events.length, 2);
    assert.equal(events[1].provider_scope, "integration");
    assert.equal(events[1].folder_id, "main");
    assert.equal(events[1].inbox_user_id, "u1");
    assert.equal(events[1].basis, "provider_verified");
    const saved = await saveReviewedStaffChannel(
      {
        staffId,
        expectedVersion: null,
        evidenceId: approved.evidenceId,
        eligible: true,
      },
      actor,
      ports,
    );
    assert.equal(saved.version, 1);
    fail = true;
    await assert.rejects(
      verifyInboxSelection(
        { staffId, userId: "u1", folderKey: "main", expectedVersion: 1 },
        actor,
        ports,
      ),
      (error) => error.status === 503,
    );
    const { rows: count } = await db.query(
      "SELECT count(*)::int AS n FROM whatsapp_staff_mapping_reviews",
    );
    assert.equal(count[0].n, 2);
  } finally {
    if (previous.channel === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    else process.env.EP_WA_COMPANY_CHANNEL_ID = previous.channel;
    if (previous.integration === undefined) delete process.env.EP_WA_INBOX_INTEGRATION_ID;
    else process.env.EP_WA_INBOX_INTEGRATION_ID = previous.integration;
    await db.close();
  }
});
