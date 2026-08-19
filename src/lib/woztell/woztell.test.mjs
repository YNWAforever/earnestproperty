import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  canSendFreeFormMessage,
  isBlastRecipientAllowed,
  isOptOutText,
  normalizeWoztellEvent,
  sendWoztellResponse,
  verifyWoztellSignature,
} from "./woztell.server.ts";
import { deliverWoztellCampaign } from "./campaign-delivery.server.ts";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const campaignRecipient = {
  id: "11111111-1111-4111-8111-111111111111",
  normalized_phone: "85260000000",
  whatsapp_member_id: "woztell-member-1",
  opt_in_whatsapp: true,
  opted_out_whatsapp: false,
  element_name: "campaign-template",
  language_code: "zh_HK",
  components: [],
};

async function runSingleRecipientCampaign(sendResponse) {
  let claimCount = 0;
  const updates = [];
  const summary = await deliverWoztellCampaign("22222222-2222-4222-8222-222222222222", {
    isEnabled: () => true,
    checkpoint: async () => {},
    claimRecipients: async () => {
      claimCount += 1;
      return claimCount === 1 ? [campaignRecipient] : [];
    },
    updateRecipient: async (...args) => updates.push(args),
    refreshStatus: async () => {},
    sendResponse,
  });
  return { claimCount, summary, updates };
}

test("verifyWoztellSignature validates HMAC-SHA256 base64 signatures", () => {
  const secret = "channel-secret";
  const body = Buffer.from(JSON.stringify({ type: "TEXT", data: { text: "Hello" } }));
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64");

  assert.equal(verifyWoztellSignature(body, signature, secret), true);
  assert.equal(verifyWoztellSignature(body, "invalid", secret), false);
});

test("normalizeWoztellEvent extracts inbound message identity and text", () => {
  const event = normalizeWoztellEvent({
    from: "85260903521",
    to: "85268227287",
    timestamp: "1599536864",
    type: "TEXT",
    data: { text: "想睇碧堤半島" },
    member: "memberId",
    channel: "channelId",
    app: "appId",
    memberExtra: { name: "Chan Tai Man" },
  });

  assert.equal(event.direction, "inbound");
  // The synthesized id keeps the readable direction:channel:member:timestamp:type
  // prefix and appends a digest of the message body -- without that digest two
  // messages in the same second collapse onto one UNIQUE key and one is lost.
  assert.match(
    event.externalMessageId,
    /^inbound:channelId:memberId:1599536864:TEXT:[0-9a-f]{12}$/,
  );
  // The pre-digest key is carried alongside so ingest can recognise rows that
  // were imported before the digest existed.
  assert.equal(event.legacyExternalMessageId, "inbound:channelId:memberId:1599536864:TEXT");
  assert.equal(event.fromPhone, "85260903521");
  assert.equal(event.toPhone, "85268227287");
  assert.equal(event.text, "想睇碧堤半島");
  assert.equal(event.woztellMemberId, "memberId");
});

test("normalizeWoztellEvent handles outbound manual events", () => {
  const event = normalizeWoztellEvent({
    type: "MANUAL",
    member: "memberId",
    channel: "channelId",
    messageEvent: {
      from: "85268227287",
      to: "85260903521",
      timestamp: 1599536864,
      type: "TEXT",
      data: { text: "收到，我哋幫你配盤" },
      messageId: "wamid.123",
    },
  });

  assert.equal(event.direction, "outbound");
  assert.equal(event.externalMessageId, "wamid.123");
  assert.equal(event.text, "收到，我哋幫你配盤");
});

test("normalizeWoztellEvent supports official memberId and channelId fields", () => {
  const event = normalizeWoztellEvent({
    memberId: "woztell-member-1",
    channelId: "woztell-channel-1",
    messageEvent: {
      from: "85260000000",
      to: "85268888888",
      timestamp: 1712807869354,
      type: "TEXT",
      data: { text: "official payload text" },
      messageId: "wamid.official-1",
    },
  });

  assert.equal(event.woztellMemberId, "woztell-member-1");
  assert.equal(event.channelId, "woztell-channel-1");
  assert.equal(event.externalMessageId, "wamid.official-1");
  assert.equal(event.text, "official payload text");
});

test("sendWoztellResponse uses memberId rather than a browser recipient id", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  };
  const previous = {
    enabled: process.env.WOZTELL_ENABLED,
    token: process.env.WOZTELL_BOT_ACCESS_TOKEN,
    channel: process.env.WOZTELL_CHANNEL_ID,
  };
  process.env.WOZTELL_ENABLED = "true";
  process.env.WOZTELL_BOT_ACCESS_TOKEN = "test-token";
  process.env.WOZTELL_CHANNEL_ID = "test-channel";

  try {
    const result = await sendWoztellResponse({
      memberId: "woztell-member-1",
      response: [{ type: "TEXT", text: "reply text" }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(request.init.body), {
      channelId: "test-channel",
      memberId: "woztell-member-1",
      response: [{ type: "TEXT", text: "reply text" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WOZTELL_ENABLED = previous.enabled;
    process.env.WOZTELL_BOT_ACCESS_TOKEN = previous.token;
    process.env.WOZTELL_CHANNEL_ID = previous.channel;
  }
});

test("campaign delivery makes accepted-then-timeout recipients terminal unknown", async () => {
  const result = await runSingleRecipientCampaign(async () => {
    throw Object.assign(new Error("response lost after provider acceptance"), {
      name: "AbortError",
    });
  });

  assert.deepEqual(result.summary, { sent: 0, blocked: 0, failed: 1, checked: 1 });
  assert.deepEqual(result.updates, [[campaignRecipient.id, "failed", "WOZTELL_DELIVERY_UNKNOWN"]]);
  assert.equal(result.claimCount, 2);
});

// WOZTELL_DELIVERY_UNKNOWN is now TERMINAL: materializeCampaignRecipients
// refuses to re-queue a recipient carrying it, because the provider may already
// have delivered the message. That makes the classification below load-bearing
// -- anything filed as UNKNOWN can never be retried, so only genuinely
// ambiguous outcomes belong there.
test("campaign delivery makes genuinely ambiguous HTTP responses terminal unknown", async () => {
  // The request may have been processed before the connection broke.
  for (const status of [200, 408, 503]) {
    const result = await runSingleRecipientCampaign(async () => ({
      ok: false,
      status,
      error: "ambiguous response",
    }));
    assert.deepEqual(result.updates, [
      [campaignRecipient.id, "failed", "WOZTELL_DELIVERY_UNKNOWN"],
    ]);
    assert.equal(result.summary.failed, 1);
  }
});

test("a rate-limited send is rejected, not ambiguous, so it stays retryable", async () => {
  // 429 means the provider refused to accept the request at all: nothing was
  // sent. Filing it as UNKNOWN would strand the recipient permanently now that
  // UNKNOWN blocks re-queueing, so a whole campaign throttled by the provider
  // could never be completed.
  const result = await runSingleRecipientCampaign(async () => ({
    ok: false,
    status: 429,
    error: "rate limited",
  }));

  assert.deepEqual(result.updates, [[campaignRecipient.id, "failed", "WOZTELL_PROVIDER_REJECTED"]]);
  assert.equal(result.summary.failed, 1);
});

test("campaign delivery checkpoints before claims and every recipient send", async () => {
  let checkpoints = 0;
  let sends = 0;
  let claims = 0;
  await assert.rejects(
    () =>
      deliverWoztellCampaign("22222222-2222-4222-8222-222222222222", {
        isEnabled: () => true,
        checkpoint: async () => {
          checkpoints += 1;
          if (checkpoints === 3) {
            throw Object.assign(new Error("job cancelled"), { code: "JOB_OWNERSHIP_LOST" });
          }
        },
        claimRecipients: async () => {
          claims += 1;
          return [
            campaignRecipient,
            { ...campaignRecipient, id: "33333333-3333-4333-8333-333333333333" },
          ];
        },
        updateRecipient: async () => {},
        refreshStatus: async () => {},
        sendResponse: async () => {
          sends += 1;
          return { ok: true, status: 200, body: {} };
        },
      }),
    (error) => error?.code === "JOB_OWNERSHIP_LOST",
  );
  assert.equal(claims, 1);
  assert.equal(sends, 1);
  assert.equal(checkpoints, 3);
});

test("campaign reconciliation makes stale sending recipients terminal without resending", () => {
  const source = read("src/lib/woztell/campaign-delivery.server.ts");
  assert.match(source, /status = 'failed', error = 'WOZTELL_DELIVERY_UNKNOWN'/);
  assert.match(source, /status = 'sending'/);
  assert.match(source, /now\(\) - interval '15 minutes'/);
  assert.doesNotMatch(source, /OR\s*\(\s*recipient\.status = 'sending'/);
});
test("blast and service-window guards enforce WhatsApp safety defaults", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");

  assert.equal(isOptOutText("停止"), true);
  assert.equal(isOptOutText("unsubscribe please"), true);
  assert.equal(isOptOutText("想睇樓"), false);

  assert.equal(
    canSendFreeFormMessage({
      lastInboundAt: new Date("2026-06-22T13:00:00.000Z"),
      now,
    }),
    true,
  );
  assert.equal(
    canSendFreeFormMessage({
      lastInboundAt: new Date("2026-06-22T11:59:00.000Z"),
      now,
    }),
    false,
  );

  assert.equal(isBlastRecipientAllowed({ optedIn: true, optedOut: false }), true);
  assert.equal(isBlastRecipientAllowed({ optedIn: false, optedOut: false }), false);
  assert.equal(isBlastRecipientAllowed({ optedIn: true, optedOut: true }), false);
});

test("admin send route gates replies through a fetched conversation", () => {
  const sendRoute = read("src/routes/api.admin.woztell.send.ts");

  for (const text of [
    "canReplyToConversation",
    "woztellEnabled",
    "conversationId",
    "last_inbound_at",
    "opted_out_whatsapp",
    "woztell_member_id",
    "memberId",
    "let result",
    "try",
    "catch",
    "sendError",
  ]) {
    assert.match(sendRoute, new RegExp(text));
  }

  assert.match(sendRoute, /SELECT[\s\S]+FROM whatsapp_conversations/);
  assert.match(sendRoute, /try\s*\{[\s\S]*sendWoztellResponse[\s\S]*\}\s*catch/);
  assert.match(sendRoute, /catch\s*\([^)]*\)\s*\{[\s\S]*ok:\s*false[\s\S]*error:/);
  assert.match(sendRoute, /status,\s*payload/);
  assert.match(sendRoute, /result\.ok \? "sent" : "failed"/);
  assert.doesNotMatch(sendRoute, /recipientId/);
  assert.match(sendRoute, /status,\s*payload/);
  assert.match(sendRoute, /'sending'/);
  assert.match(sendRoute, /RETURNING id/);
  assert.match(sendRoute, /UPDATE whatsapp_messages[\s\S]*SET status/);
  assert.match(sendRoute, /status = \$2/);
  assert.match(sendRoute, /payload = \$3::jsonb/);
  assert.match(sendRoute, /WHERE id = \$1/);
});

test("webhook validates the raw body before parsing", () => {
  const webhookRoute = read("src/routes/api.woztell.webhook.ts");

  // The signature is checked against the RAW bytes, before JSON.parse -- parsing
  // first and re-serializing would change the bytes and break verification.
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /x-woztell-signature/);
  assert.match(webhookRoute, /try\s*\{[\s\S]*JSON\.parse\(raw/);
  assert.match(webhookRoute, /INVALID_JSON/);
  const signatureCheck = webhookRoute.indexOf("verifyWoztellSignature");
  const parseCall = webhookRoute.indexOf("JSON.parse(raw");
  assert.ok(
    signatureCheck > -1 && parseCall > signatureCheck,
    "signature verification must happen before the body is parsed",
  );
});

// The upsert moved out of the route when the history backfill needed to write
// the same rows. These assertions moved with it -- they guard the dedupe key and
// the contact-matching order, which are what stop the two ingest paths from
// producing duplicate contacts and duplicate messages for one conversation.
test("event ingestion deduplicates messages and matches contacts member-id first", () => {
  const ingest = read("src/lib/woztell/woztell-ingest.server.ts");

  assert.match(ingest, /external_message_id/);
  assert.match(ingest, /ON CONFLICT \(external_message_id\) DO NOTHING/);
  assert.match(ingest, /ORDER BY \(whatsapp_member_id = \$2\)/);
});

// A backfill replays OLD messages. Plain assignment (or COALESCE, which takes
// any non-null new value) would drag last_message_at backwards and reshuffle the
// admin inbox, which sorts on it. GREATEST ignores NULLs in Postgres, so this is
// also correct for the webhook when events arrive out of order.
test("recency columns never move backwards when old history is replayed", () => {
  const ingest = read("src/lib/woztell/woztell-ingest.server.ts");

  assert.match(ingest, /last_message_at = GREATEST\(last_message_at, \$4\)/);
  assert.match(ingest, /last_inbound_at = GREATEST\(last_inbound_at, \$5\)/);
  assert.match(ingest, /last_inbound_at = GREATEST\(last_inbound_at, \$8\)/);
  assert.doesNotMatch(
    ingest,
    /last_message_at = \$\d/,
    "last_message_at must not be assigned unconditionally -- it would regress on backfill",
  );
});

// Both paths must go through the shared module. A future edit that re-inlines
// SQL into the route is exactly the drift this extraction exists to prevent.
test("the webhook route delegates persistence rather than re-inlining SQL", () => {
  const webhookRoute = read("src/routes/api.woztell.webhook.ts");

  assert.match(webhookRoute, /ingestWoztellEvent/);
  assert.doesNotMatch(webhookRoute, /INSERT INTO/);
  assert.doesNotMatch(webhookRoute, /UPDATE crm_contacts/);
});

test("admin reply server action never accepts a browser recipient id", () => {
  const adminData = read("src/lib/neon/admin-data.ts");

  assert.match(adminData, /conversationId: string; text: string/);
  assert.doesNotMatch(adminData, /conversationId: string; recipientId: string; text: string/);
});

// The substring matcher behind isOptOutText fired on any message merely
// CONTAINING an opt-out keyword. Written Chinese has no word delimiter, so
// 「我想取消今日睇樓約會」 -- a customer rescheduling a viewing -- silently opted
// them out of WhatsApp. Because the webhook writes the flag monotonically
// (opted_out_whatsapp OR $7), that was irreversible until the admin/manager
// reset landed: staff replies 400'd forever and the contact was dropped from
// every campaign.
test("real opt-out messages are detected across script, width and politeness", async () => {
  const { isOptOutText } = await import("./woztell.server.ts");

  // Unambiguous phrases anywhere in the message.
  for (const value of [
    "取消訂閱",
    "取消订阅",
    "我要退訂",
    "退订",
    "請停止發送",
    "停止發送",
    "拒收",
    "不再接收",
    "唔想再收",
    "unsubscribe please",
    "opt out",
    "remove me",
  ]) {
    assert.equal(isOptOutText(value), true, `${value} must be treated as an opt-out`);
  }

  // Bare stems, with and without politeness prefixes and punctuation.
  for (const value of [
    "取消",
    "停止",
    "唔要",
    "不要",
    "取消！",
    "  停止  ",
    "唔該停止",
    "我要取消",
  ]) {
    assert.equal(isOptOutText(value), true, `${value} must be treated as an opt-out`);
  }

  // Latin, including next to CJK -- \\P{L} never matched there because CJK
  // characters ARE letters, so 「請stop」 and 「STOP啦」 used to slip past.
  for (const value of [
    "stop",
    "STOP.",
    "Please STOP",
    "請stop",
    "STOP啦",
    "唔該stop",
    "ＳＴＯＰ",
  ]) {
    assert.equal(isOptOutText(value), true, `${value} must be treated as an opt-out`);
  }
});

// The original matcher used `text.includes(term)`, so any sentence merely
// CONTAINING a stem opted the customer out. Written Chinese has no word
// delimiter, so 「我想取消今日睇樓約會」 -- rescheduling a viewing -- silently opted
// them out, irreversibly (the webhook writes opted_out_whatsapp OR $7).
test("ordinary sentences containing an opt-out stem are not opt-outs", async () => {
  const { isOptOutText } = await import("./woztell.server.ts");

  for (const value of [
    "我想取消今日睇樓約會",
    "唔要呢個單位，想睇第二個",
    "不要太貴嘅盤",
    "請停止安排星期六睇樓",
    "我不要三房嘅",
    "想睇樓",
    "stopover in Tsuen Wan",
    "",
    "   ",
  ]) {
    assert.equal(isOptOutText(value), false, `${value} must NOT be treated as an opt-out`);
  }

  assert.equal(isOptOutText(null), false);
  assert.equal(isOptOutText(undefined), false);
});

test("an opt-out can be cleared by admin/manager, with a reason and an audit row", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const client = read("src/lib/neon/admin-data.ts");

  // The only write that sets the flag back to false.
  assert.match(server, /export async function clearContactWhatsappOptOut/);
  assert.match(server, /SET opted_out_whatsapp = false/);
  assert.match(server, /AND opted_out_whatsapp = true/);
  assert.match(server, /writeAudit\(actor\.staffId, "contact\.optout\.clear"/);

  // Narrower than the rest of the conversation surface: agents cannot clear.
  assert.match(
    client,
    /clearContactWhatsappOptOutServer[\s\S]{0,400}requireStaff\(\["admin", "manager"\]\)/,
  );
});

// WOZTELL does not put a messageId on every event -- inbound webhook payloads
// routinely arrive without one -- so normalizeWoztellEvent synthesizes a
// fallback. That fallback is written into whatsapp_messages.external_message_id,
// which is UNIQUE and ingested with ON CONFLICT DO NOTHING. So any two DISTINCT
// messages that synthesize the SAME id do not raise an error: the second one is
// silently discarded and counted as an already-seen duplicate.
//
// Before this was fixed the key was direction:channel:member:timestamp:type, and
// WOZTELL timestamps are unix SECONDS. Two messages in one second -- a customer
// sending two lines in a row, or a bot answering in two bubbles -- collapsed
// into a single row, and the inbox quietly showed one fewer message than the
// WOZTELL console.
test("two different messages in the same second get different fallback ids", () => {
  const base = { member: "memberId", channel: "channelId", timestamp: "1599536864", type: "TEXT" };

  const first = normalizeWoztellEvent({ ...base, data: { text: "你好" } });
  const second = normalizeWoztellEvent({ ...base, data: { text: "想睇碧堤半島" } });

  assert.notEqual(
    first.externalMessageId,
    second.externalMessageId,
    "distinct messages must not share an external_message_id, or one is dropped",
  );
});

// The degenerate case: an event carrying no timestamp at all fell back to the
// literal string "time", so EVERY such message from one member collapsed onto
// a single id.
test("messages with no timestamp are still told apart", () => {
  const first = normalizeWoztellEvent({ member: "m1", channel: "c1", data: { text: "第一則" } });
  const second = normalizeWoztellEvent({ member: "m1", channel: "c1", data: { text: "第二則" } });

  assert.notEqual(first.externalMessageId, second.externalMessageId);
});

// Non-text messages carry their payload in `data` rather than `data.text`, so
// discriminating on text alone would still collapse two images sent together.
test("two media messages in the same second get different fallback ids", () => {
  const base = { member: "m1", channel: "c1", timestamp: "1599536864", type: "IMAGE" };

  const first = normalizeWoztellEvent({ ...base, data: { url: "https://cdn/a.jpg" } });
  const second = normalizeWoztellEvent({ ...base, data: { url: "https://cdn/b.jpg" } });

  assert.notEqual(first.externalMessageId, second.externalMessageId);
});

// The other half of the property, and the reason the fix cannot just append a
// random or positional value: the SAME message must still synthesize the SAME
// id every time it is seen, or re-running the history import duplicates rows
// the webhook already stored.
test("the same message synthesizes a stable id on every pass", () => {
  const event = {
    member: "m1",
    channel: "c1",
    timestamp: "1599536864",
    type: "TEXT",
    data: { text: "睇樓" },
  };

  assert.equal(
    normalizeWoztellEvent({ ...event }).externalMessageId,
    normalizeWoztellEvent({ ...event }).externalMessageId,
  );
  // Key order must not matter either -- the two ingest surfaces build the
  // record independently.
  assert.equal(
    normalizeWoztellEvent({ ...event, data: { text: "睇樓" } }).externalMessageId,
    normalizeWoztellEvent({ data: { text: "睇樓" }, ...event }).externalMessageId,
  );
});

// Adding the digest changed the shape of every synthesized id, so the rows
// already sitting in the database no longer match what ingest now computes.
// Two things have to stay true at once, and they pull in opposite directions:
// a message the old import already stored must NOT come back a second time,
// and a message the old import DROPPED on a collision must now get in.
// Matching the legacy key together with the body is what separates the two --
// on the key alone, the dropped twin looks exactly like the row that displaced
// it and would be skipped forever.
test("ingest reconciles pre-digest rows without re-dropping their lost twins", () => {
  const ingest = read("src/lib/woztell/woztell-ingest.server.ts");

  assert.match(ingest, /legacyExternalMessageId/);
  assert.match(ingest, /NOT EXISTS/);
  // The body comparison, and specifically the NULL-safe form -- `=` would never
  // match the NULL text a media message carries, disabling the guard for them.
  assert.match(ingest, /text IS NOT DISTINCT FROM \$5::text/);
  // The new-id dedupe has to survive alongside it.
  assert.match(ingest, /ON CONFLICT \(external_message_id\) DO NOTHING/);
});
