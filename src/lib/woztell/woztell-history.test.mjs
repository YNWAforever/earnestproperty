import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  backfillWoztellHistory,
  chatNodeToEvent,
  chatNodeToWebhookPayload,
  chatSenderToWebhookType,
  fetchWoztellHistoryPage,
  MAX_PAGE_SIZE,
  WoztellHistoryError,
} from "./woztell-history.server.ts";
import { normalizeWoztellEvent } from "./woztell.server.ts";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function historyPayload(nodes, pageInfo = {}) {
  return {
    data: {
      apiViewer: {
        conversationHistory: {
          edges: nodes.map((node, index) => ({ cursor: `c${index}`, node })),
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
            hasPreviousPage: false,
            startCursor: null,
            totalCount: null,
            ...pageInfo,
          },
        },
      },
    },
  };
}

test("ChatSender maps onto the webhook's own direction discriminator", () => {
  assert.equal(chatSenderToWebhookType("BOT"), "BOT");
  assert.equal(chatSenderToWebhookType("ADMIN"), "MANUAL");
  assert.equal(chatSenderToWebhookType("INCOMING_WEBHOOK"), "RELAY");
  assert.equal(chatSenderToWebhookType("MEMBER"), null);
  assert.equal(chatSenderToWebhookType("member"), null, "casing must not matter");

  // An unrecognised sender must still produce an ingestible event. Storing a
  // rare row with the wrong direction is recoverable; dropping it is not.
  assert.equal(chatSenderToWebhookType("SOMETHING_NEW"), null);
  assert.equal(chatSenderToWebhookType(null), null);
});

test("a customer message from history is inbound, a staff reply is outbound", () => {
  const inbound = chatNodeToEvent({
    from: "MEMBER",
    memberId: "m1",
    channelId: "6a740a3869244a10a91325c1",
    messageEvent: { type: "TEXT", data: { text: "你好" }, timestamp: "1599536864" },
  });
  assert.equal(inbound.direction, "inbound");
  assert.equal(inbound.text, "你好");

  const outbound = chatNodeToEvent({
    from: "ADMIN",
    memberId: "m1",
    channelId: "6a740a3869244a10a91325c1",
    messageEvent: { type: "TEXT", data: { text: "多謝查詢" }, timestamp: "1599536999" },
  });
  assert.equal(outbound.direction, "outbound");
  assert.equal(outbound.text, "多謝查詢");
});

// This is the property the whole backfill rests on. whatsapp_messages dedupes on
// a UNIQUE external_message_id, so a message the webhook already stored must
// produce the SAME id when the backfill sees it again -- otherwise re-importing
// history duplicates every message the inbox already had.
test("backfill and webhook derive the same external_message_id for one message", () => {
  const messageEvent = {
    messageId: "wamid.ABC123",
    type: "TEXT",
    data: { text: "有冇三房盤？" },
    timestamp: "1599536864",
    from: "85297987774",
  };

  const fromWebhook = normalizeWoztellEvent({
    messageEvent,
    memberId: "m1",
    channelId: "6a740a3869244a10a91325c1",
  });
  const fromHistory = chatNodeToEvent({
    from: "MEMBER",
    memberId: "m1",
    channelId: "6a740a3869244a10a91325c1",
    messageEvent,
  });

  assert.equal(fromHistory.externalMessageId, fromWebhook.externalMessageId);
  assert.equal(fromHistory.externalMessageId, "wamid.ABC123");
});

// The harder half of the same property: when WOZTELL gives us no messageId,
// normalizeWoztellEvent synthesizes one that ENCODES THE DIRECTION. So the two
// paths must agree on direction too, or the fallback ids diverge and the dedupe
// silently stops working for exactly the messages that need it most.
test("the synthesized fallback id also matches across both ingest paths", () => {
  const messageEvent = { type: "TEXT", data: { text: "睇樓" }, timestamp: "1599536864" };

  const fromWebhook = normalizeWoztellEvent({
    type: "MANUAL",
    messageEvent,
    memberId: "m1",
    channelId: "chan",
  });
  const fromHistory = chatNodeToEvent({
    from: "ADMIN",
    memberId: "m1",
    channelId: "chan",
    messageEvent,
  });

  assert.equal(fromWebhook.direction, "outbound");
  assert.equal(fromHistory.direction, "outbound");
  assert.equal(fromHistory.externalMessageId, fromWebhook.externalMessageId);
  assert.match(fromHistory.externalMessageId, /^outbound:chan:m1:/);
});

test("an inbound history row carries no misleading type in its stored payload", () => {
  const payload = chatNodeToWebhookPayload({ from: "MEMBER", memberId: "m", channelId: "c" });
  assert.equal("type" in payload, false, "MEMBER must not be written as a message type");

  const outboundPayload = chatNodeToWebhookPayload({ from: "BOT", memberId: "m", channelId: "c" });
  assert.equal(outboundPayload.type, "BOT");
});

// WOZTELL answers a bad or wrongly-scoped token with HTTP 200 and a GraphQL
// errors array. Reading only res.ok would report that as an empty inbox -- the
// precise false "you have no history" this module exists to prevent.
test("an authentication failure disguised as HTTP 200 is raised, not read as empty", async () => {
  const fetchImpl = async () =>
    jsonResponse({ errors: [{ message: "User is not authenticated." }] }, 200);

  await assert.rejects(
    () => fetchWoztellHistoryPage({ token: "bad", fetchImpl }),
    (error) => {
      assert.ok(error instanceof WoztellHistoryError);
      assert.match(error.message, /not authenticated/i);
      return true;
    },
  );
});

test("a page request is capped at the schema's IntMax100 limit", async () => {
  let sentVariables = null;
  const fetchImpl = async (_url, init) => {
    sentVariables = JSON.parse(init.body).variables;
    return jsonResponse(historyPayload([]));
  };

  await fetchWoztellHistoryPage({ token: "t", pageSize: 5_000, channelId: "chan", fetchImpl });

  assert.equal(sentVariables.first, MAX_PAGE_SIZE);
  assert.equal(sentVariables.channelId, "chan");
});

// Only one direction's pair may be sent. Passing first and last together is not
// documented as valid, and the two cursor args mean different ends.
test("forward and backward modes send one direction's arguments only", async () => {
  const captured = [];
  const fetchImpl = async (_url, init) => {
    captured.push(JSON.parse(init.body).variables);
    return jsonResponse(historyPayload([]));
  };

  await fetchWoztellHistoryPage({ token: "t", cursor: "cur", mode: "forward", fetchImpl });
  await fetchWoztellHistoryPage({ token: "t", cursor: "cur", mode: "backward", fetchImpl });

  const [forward, backward] = captured;
  assert.equal(forward.first, MAX_PAGE_SIZE);
  assert.equal(forward.after, "cur");
  assert.equal(forward.last, null);
  assert.equal(forward.before, null);

  assert.equal(backward.last, MAX_PAGE_SIZE);
  assert.equal(backward.before, "cur");
  assert.equal(backward.first, null);
  assert.equal(backward.after, null);
});

// Forward pagination is what WOZTELL documents; backward is what their own n8n
// node actually ships. Since neither the sort order nor the unused direction is
// documented, both must read the matching half of pageInfo -- a backward run
// that read hasNextPage/endCursor would stop after one page every time.
test("each mode reads its own half of pageInfo", async () => {
  const fetchImpl = async () =>
    jsonResponse(
      historyPayload([], {
        hasNextPage: false,
        endCursor: "end",
        hasPreviousPage: true,
        startCursor: "start",
      }),
    );

  const forward = await fetchWoztellHistoryPage({ token: "t", mode: "forward", fetchImpl });
  assert.equal(forward.hasMore, false);
  assert.equal(forward.cursor, "end");

  const backward = await fetchWoztellHistoryPage({ token: "t", mode: "backward", fetchImpl });
  assert.equal(backward.hasMore, true);
  assert.equal(backward.cursor, "start");
});

test("a backward run walks startCursor across pages", async () => {
  const seen = [];
  let call = 0;
  const pages = [
    historyPayload([{ from: "MEMBER", memberId: "m1", messageEvent: {} }], {
      hasPreviousPage: true,
      startCursor: "s1",
    }),
    historyPayload([{ from: "MEMBER", memberId: "m2", messageEvent: {} }], {
      hasPreviousPage: false,
      startCursor: null,
    }),
  ];
  const fetchImpl = async (_url, init) => {
    seen.push(JSON.parse(init.body).variables.before);
    return jsonResponse(pages[call++]);
  };

  const summary = await backfillWoztellHistory({
    token: "t",
    mode: "backward",
    pageDelayMs: 0,
    fetchImpl,
    ingest: async () => ({ messageInserted: true, skipped: null }),
  });

  assert.deepEqual(seen, [null, "s1"]);
  assert.equal(summary.rows, 2);
  assert.equal(summary.reachedEnd, true);
});

test("the request carries a Bearer token, not a query-string token", async () => {
  let seenUrl = null;
  let seenHeaders = null;
  const fetchImpl = async (url, init) => {
    seenUrl = url;
    seenHeaders = init.headers;
    return jsonResponse(historyPayload([]));
  };

  await fetchWoztellHistoryPage({ token: "secret-token", fetchImpl });

  // The Bot API takes ?accessToken=; the Open API takes a header. Leaking the
  // token into the URL would put it in every proxy and access log in between.
  assert.doesNotMatch(seenUrl, /secret-token/);
  assert.equal(seenHeaders.Authorization, "Bearer secret-token");
});

test("pagination walks the cursor and reports where it stopped", async () => {
  const pages = [
    historyPayload([{ from: "MEMBER", memberId: "m1", messageEvent: { data: { text: "1" } } }], {
      hasNextPage: true,
      endCursor: "cur1",
    }),
    historyPayload([{ from: "MEMBER", memberId: "m2", messageEvent: { data: { text: "2" } } }], {
      hasNextPage: false,
      endCursor: null,
    }),
  ];
  const cursors = [];
  let call = 0;
  const fetchImpl = async (_url, init) => {
    cursors.push(JSON.parse(init.body).variables.after);
    return jsonResponse(pages[call++]);
  };

  const summary = await backfillWoztellHistory({
    token: "t",
    fetchImpl,
    pageDelayMs: 0,
    ingest: async () => ({ messageInserted: true, skipped: null }),
  });

  assert.deepEqual(cursors, [null, "cur1"]);
  assert.equal(summary.pages, 2);
  assert.equal(summary.rows, 2);
  assert.equal(summary.ingested, 2);
  assert.equal(summary.reachedEnd, true);
  assert.equal(summary.nextCursor, null);
});

test("a run bounded by maxPages hands back a resumable cursor", async () => {
  const fetchImpl = async () =>
    jsonResponse(
      historyPayload([{ from: "MEMBER", memberId: "m", messageEvent: {} }], {
        hasNextPage: true,
        endCursor: `cur-${Math.random()}`,
      }),
    );

  const summary = await backfillWoztellHistory({
    token: "t",
    maxPages: 3,
    pageDelayMs: 0,
    fetchImpl,
    ingest: async () => ({ messageInserted: true, skipped: null }),
  });

  assert.equal(summary.pages, 3);
  assert.equal(summary.reachedEnd, false);
  assert.ok(summary.nextCursor, "a bounded run must say where to resume");
});

test("a resumed run starts from the cursor it was given", async () => {
  const seen = [];
  const fetchImpl = async (_url, init) => {
    seen.push(JSON.parse(init.body).variables.after);
    return jsonResponse(historyPayload([]));
  };

  await backfillWoztellHistory({
    token: "t",
    startCursor: "resume-here",
    pageDelayMs: 0,
    fetchImpl,
    ingest: async () => ({ messageInserted: true, skipped: null }),
  });

  assert.deepEqual(seen, ["resume-here"]);
});

// A server that keeps returning hasNextPage:true with an unchanging cursor
// would otherwise spin to maxPages, re-ingesting the same rows each time.
test("a cursor that stops advancing terminates the loop", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(
      historyPayload([{ from: "MEMBER", memberId: "m", messageEvent: {} }], {
        hasNextPage: true,
        endCursor: "stuck",
      }),
    );
  };

  const summary = await backfillWoztellHistory({
    token: "t",
    startCursor: "stuck",
    maxPages: 20,
    pageDelayMs: 0,
    fetchImpl,
    ingest: async () => ({ messageInserted: true, skipped: null }),
  });

  assert.equal(calls, 1);
  assert.equal(summary.reachedEnd, true);
});

test("re-running over already-imported history counts duplicates, not inserts", async () => {
  const fetchImpl = async () =>
    jsonResponse(
      historyPayload([
        { from: "MEMBER", memberId: "m1", messageEvent: {} },
        { from: "MEMBER", memberId: "m2", messageEvent: {} },
      ]),
    );

  const summary = await backfillWoztellHistory({
    token: "t",
    pageDelayMs: 0,
    fetchImpl,
    // What ingestWoztellEvent returns when ON CONFLICT DO NOTHING swallows the row.
    ingest: async () => ({ messageInserted: false, skipped: null }),
  });

  assert.equal(summary.rows, 2);
  assert.equal(summary.ingested, 0);
  assert.equal(summary.duplicates, 2);
});

test("rows with no threadable identity are counted as skipped", async () => {
  const fetchImpl = async () =>
    jsonResponse(historyPayload([{ from: "MEMBER", messageEvent: {} }]));

  const summary = await backfillWoztellHistory({
    token: "t",
    pageDelayMs: 0,
    fetchImpl,
    ingest: async () => ({ messageInserted: false, skipped: "no-identity" }),
  });

  assert.equal(summary.skipped, 1);
  assert.equal(summary.duplicates, 0);
});

test("the backfill route is admin-only and scoped to the configured channel", () => {
  const route = read("src/routes/api.admin.woztell.backfill.ts");

  assert.match(route, /server-only/);
  assert.match(route, /requireStaffAccess\(request, \["admin"\]\)/);
  assert.match(route, /WOZTELL_OPEN_API_TOKEN/);
  assert.match(route, /WOZTELL_CHANNEL_ID/);

  // It must not fall back to the send token: bot:* scopes cannot read history,
  // so that would fail confusingly instead of telling the admin what to create.
  // Naming it in the "how to fix this" hint is fine and wanted -- what must
  // never appear is a READ of it.
  assert.doesNotMatch(route, /process\.env\.WOZTELL_BOT_ACCESS_TOKEN/);
  assert.match(
    route,
    /separate from WOZTELL_BOT_ACCESS_TOKEN/,
    "the 503 should explain that this is a second, differently-scoped token",
  );

  // Persistence goes through the shared ingest path, never its own SQL.
  assert.match(route, /ingestWoztellEvent/);
  assert.doesNotMatch(route, /INSERT INTO/);
});
