import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAdminPageInput,
  encodeAdminCursor,
  decodeAdminCursor,
  finishAdminPage,
  mergeMessagePages,
} from "./admin-pagination.ts";
test("page input rejects invalid filters and clamps response size to 50", () => {
  assert.equal(parseAdminPageInput({ resource: "leads", limit: 500 }).limit, 50);
  assert.throws(() => parseAdminPageInput({ resource: "secrets" }));
  assert.throws(() => parseAdminPageInput({ resource: "messages" }));
});
test("cursor is bound to resource/filter/actor and preserves microsecond ties", () => {
  const cursor = encodeAdminCursor(
    { at: "2026-09-05T00:00:00.123456Z", id: "00000000-0000-4000-8000-000000000001" },
    "leads:actor",
  );
  assert.equal(decodeAdminCursor(cursor, "leads:actor").at, "2026-09-05T00:00:00.123456Z");
  assert.throws(() => decodeAdminCursor(cursor, "leads:other"));
});
for (const [resource, count] of [
  ["leads", 10000],
  ["contacts", 10000],
  ["estates", 1000],
  ["messages", 100000],
])
  test(`${count} ${resource} equal-time records remain reachable without duplicate/skip`, () => {
    const fixture = Array.from({ length: count }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(count - i).padStart(12, "0")}`,
      _cursor_at: "2026-09-05T00:00:00.123456Z",
      title: i === count - 1 ? "last record" : "row",
    }));
    const seen = new Set();
    let cursor = null;
    let offset = 0;
    do {
      const boundary = cursor ? decodeAdminCursor(cursor, resource) : null;
      if (boundary) {
        let low = 0,
          high = fixture.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (fixture[mid].id >= boundary.id) low = mid + 1;
          else high = mid;
        }
        offset = low;
      }
      const page = finishAdminPage(fixture.slice(offset, offset + 51), 50, resource, count);
      assert.ok(page.rows.length <= 50);
      for (const row of page.rows) {
        assert.ok(!seen.has(row.id));
        seen.add(row.id);
      }
      offset += page.rows.length;
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, count);
    assert.ok(seen.has(fixture.at(-1).id));
  });
test("incremental message merges preserve history and deduplicate equal timestamps", () => {
  const old = [{ id: "a", created_at: "2026-01-01", text: "old" }];
  const merged = mergeMessagePages(old, [
    { id: "b", created_at: "2026-01-01", text: "new" },
    { id: "a", created_at: "2026-01-01", text: "updated" },
  ]);
  assert.deepEqual(
    merged.map((r) => r.id),
    ["a", "b"],
  );
  assert.equal(merged[0].text, "updated");
});

import { buildAdminPageQuery } from "./admin-pagination-query.ts";
const actor = { staffId: "00000000-0000-4000-8000-000000000001", roles: ["agent"] };
test("query scopes rows before count and binds SQL metacharacters", () => {
  const q = buildAdminPageQuery({ resource: "leads", q: "%';DROP TABLE crm_leads;--" }, actor);
  assert.match(q.statement, /l.assigned_agent_id=\$1::uuid/);
  assert.ok(!q.statement.includes("DROP TABLE"));
  assert.ok(q.params.some((p) => String(p).includes("DROP TABLE")));
  assert.equal(q.params.at(-1), 51);
  assert.match(q.statement, /count\(\*\).*FROM filtered/);
});
test("messages require parent ownership and cursors cannot cross staff", () => {
  const input = { resource: "messages", conversationId: actor.staffId };
  const query = buildAdminPageQuery(input, actor);
  assert.match(query.statement, /JOIN whatsapp_conversations/);
  assert.match(query.statement, /w.assigned_agent_id=\$1::uuid/);
  const token = encodeAdminCursor(
    { at: "2026-09-05T00:00:00.000000Z", id: actor.staffId },
    query.binding,
  );
  assert.throws(() =>
    buildAdminPageQuery(
      { ...input, cursor: token },
      { ...actor, staffId: "00000000-0000-4000-8000-000000000002" },
    ),
  );
  assert.throws(() => buildAdminPageQuery(input, { ...actor, roles: ["viewer"] }));
});
test("all resources use deterministic timestamp and id ties with lookahead", () => {
  for (const resource of [
    "leads",
    "contacts",
    "conversations",
    "messages",
    "estates",
    "articles",
    "videos",
    "faqs",
    "media",
  ]) {
    const q = buildAdminPageQuery(
      { resource, ...(resource === "messages" ? { conversationId: actor.staffId } : {}) },
      actor,
    );
    assert.match(q.statement, /ORDER BY page_at DESC,id DESC LIMIT/);
    assert.equal(q.params.at(-1), 51);
  }
});

import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function inboxLoader(ports) {
  const path = "src/routes/admin.whatsapp.tsx",
    source = readFileSync(path, "utf8"),
    ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "loadConversationDetail")
      node = n.initializer.arguments[0];
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(node);
  const context = {
    visibleMessagesRef: { current: [] },
    messageRefreshOffset: { current: 0 },
    ...ports,
    mergeMessagePages,
  };
  vm.runInNewContext(
    ts.transpileModule("globalThis.load=" + node.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  return context.load;
}
test("actual delayed background inbox loader merges only new page and preserves reply typed while pending", async () => {
  let resolvePage;
  const wait = new Promise((resolve) => (resolvePage = resolve));
  let detail = {
    id: actor.staffId,
    messages: [{ id: "old", created_at: "2026-01-01", text: "old" }],
  };
  let reply = "typed before";
  const requests = [];
  const ports = {
    olderPending: { current: false },
    detailRequestRef: { current: 0 },
    messageCursors: { current: { id: actor.staffId, older: "older", newest: "newest" } },
    fetchAdminConversation: async (input) => {
      assert.equal(input.data.includeMessages, false);
      return { id: actor.staffId };
    },
    fetchAdminPage: (input) => {
      requests.push(input.data);
      return wait;
    },
    canApplyConversationDetail: () => true,
    setDetail: (fn) => (detail = fn(detail)),
    setOlderCursor: () => {},
    setDetailError: () => {},
    loadConversationAiAssist: () => {},
    setReplyDrafts: () => {
      reply = "ERASED";
    },
  };
  const load = inboxLoader(ports),
    pending = load(actor.staffId, { background: true });
  reply = "typed during request";
  resolvePage({
    rows: [{ id: "new", created_at: "2026-01-02", text: "new" }],
    nextCursor: null,
    newestCursor: "advanced",
  });
  await pending;
  assert.equal(reply, "typed during request");
  assert.deepEqual(
    detail.messages.map((row) => row.id),
    ["old", "new"],
  );
  assert.equal(requests[0].cursor, "newest");
  assert.equal(requests[0].direction, "newer");
  assert.equal(ports.messageCursors.current.older, "older");
});
test("actual background inbox loader does no request while older-page scroll anchor is pending", async () => {
  let calls = 0;
  const load = inboxLoader({
    olderPending: { current: true },
    fetchAdminConversation: () => calls++,
  });
  await load(actor.staffId, { background: true });
  assert.equal(calls, 0);
});

test("bounded message reconciliation rejects unbounded IDs and binds ownership", () => {
  assert.throws(() =>
    parseAdminPageInput({
      resource: "messages",
      conversationId: actor.staffId,
      messageIds: Array(51).fill(actor.staffId),
    }),
  );
  const query = buildAdminPageQuery(
    { resource: "messages", conversationId: actor.staffId, messageIds: [actor.staffId] },
    actor,
  );
  assert.match(query.statement, /m.id=ANY/);
  assert.match(query.statement, /w.assigned_agent_id/);
  assert.ok(query.params.some((p) => Array.isArray(p) && p[0] === actor.staffId));
});
test("actual incremental loader reconciles an older outbound unknown to accepted without advancing new-message cursor", async () => {
  const old = {
    id: actor.staffId,
    direction: "outbound",
    created_at: "2026-01-01",
    status: "unknown",
    error: "UNKNOWN",
  };
  let detail = { id: actor.staffId, messages: [old] };
  let statusRequests = 0;
  const ports = {
    olderPending: { current: false },
    visibleMessagesRef: { current: [old] },
    messageRefreshOffset: { current: 0 },
    detailRequestRef: { current: 0 },
    messageCursors: { current: { id: actor.staffId, older: "older", newest: "newest" } },
    fetchAdminConversation: async () => ({ id: actor.staffId }),
    fetchAdminPage: async ({ data }) => {
      if (data.messageIds) {
        statusRequests++;
        assert.deepEqual(Array.from(data.messageIds), [actor.staffId]);
        return { rows: [{ ...old, status: "accepted", error: null }] };
      }
      return { rows: [], newestCursor: null };
    },
    canApplyConversationDetail: () => true,
    setDetail: (fn) => (detail = fn(detail)),
    setOlderCursor: () => {},
    setDetailError: () => {},
    loadConversationAiAssist: () => {},
  };
  await inboxLoader(ports)(actor.staffId, { background: true });
  assert.equal(statusRequests, 1);
  assert.equal(detail.messages[0].status, "accepted");
  assert.equal(detail.messages[0].error, null);
  assert.equal(ports.messageCursors.current.newest, "newest");
});
