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
  verifyWoztellSignature,
} from "./woztell.server.ts";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
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
  assert.equal(event.externalMessageId, "inbound:channelId:memberId:1599536864:TEXT");
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
    "recipientId !== conversation.woztell_member_id",
  ]) {
    assert.match(sendRoute, new RegExp(text));
  }

  assert.match(sendRoute, /SELECT[\s\S]+FROM whatsapp_conversations/);
  assert.match(sendRoute, /status,\s*payload/);
  assert.match(sendRoute, /result\.ok \? "sent" : "failed"/);
});
