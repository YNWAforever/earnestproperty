import assert from "node:assert/strict";
import test from "node:test";
import { deriveInboundIdentity, eventForReceiptProjection } from "./inbound-identity.ts";
import { buildLiveEventStatements } from "./workflow.server.ts";

const base = {
  tenantKey: "woztell:app-a",
  provider: "woztell",
  appId: "app-a",
  channelId: "channel-a",
  eventKind: "customer_message",
  providerMessageId: "message-1",
  payloadDigest: "a".repeat(64),
};
test("provider IDs are scoped by app, channel and kind", () => {
  const one = deriveInboundIdentity(base);
  assert.equal(one.certainty, "provider");
  assert.equal(one.scopedProviderKey, deriveInboundIdentity(base).scopedProviderKey);
  assert.notEqual(
    one.scopedProviderKey,
    deriveInboundIdentity({ ...base, channelId: "channel-b" }).scopedProviderKey,
  );
  assert.notEqual(
    one.scopedProviderKey,
    deriveInboundIdentity({ ...base, providerMessageId: "message-2" }).scopedProviderKey,
  );
  assert.notEqual(
    one.scopedProviderKey,
    deriveInboundIdentity({ ...base, eventKind: "staff_outbound" }).scopedProviderKey,
  );
});

test("missing IDs never become authoritative dedupe keys", () => {
  const missing = deriveInboundIdentity({ ...base, providerMessageId: null });
  assert.equal(missing.scopedProviderKey, null);
  assert.equal(missing.certainty, "ambiguous");
  assert.equal(
    missing.similarityKey,
    deriveInboundIdentity({ ...base, providerMessageId: null }).similarityKey,
  );
});

test("delivery status and provider time discriminate receipts without independent event ID", () => {
  const delivery = { ...base, eventKind: "delivery_receipt" };
  const sent = deriveInboundIdentity({
    ...delivery,
    providerStatus: "SENT",
    providerOccurredAt: "2026-09-29T10:00:00Z",
  });
  const read = deriveInboundIdentity({
    ...delivery,
    providerStatus: "READ",
    providerOccurredAt: "2026-09-29T10:00:00Z",
  });
  assert.notEqual(sent.scopedProviderKey, read.scopedProviderKey);
  assert.equal(
    sent.scopedProviderKey,
    deriveInboundIdentity({
      ...delivery,
      providerStatus: "SENT",
      providerOccurredAt: "2026-09-29T10:00:00Z",
    }).scopedProviderKey,
  );
  assert.equal(
    deriveInboundIdentity({ ...delivery, providerStatus: null }).scopedProviderKey,
    null,
  );
});

const event = {
  direction: "inbound",
  externalMessageId: "legacy-synthetic-key",
  legacyExternalMessageId: "legacy-key",
  fromPhone: "85255550101",
  toPhone: "85255550202",
  timestamp: "2026-09-29T10:00:00Z",
  messageType: "TEXT",
  text: "同一段文字",
  woztellMemberId: "member-a",
  channelId: "channel-a",
  appId: "app-a",
  memberName: "Synthetic Customer",
  payload: {
    type: "TEXT",
    eventType: "INBOUND",
    member: "member-a",
    channel: "channel-a",
    app: "app-a",
    timestamp: 1790676000,
    data: { text: "同一段文字" },
  },
};
test("missing-ID attempts project as distinct messages without active workflow authority", () => {
  const first = eventForReceiptProjection(event, "receipt-a", "customer_message", null);
  const second = eventForReceiptProjection(event, "receipt-b", "customer_message", null);
  assert.notEqual(first.externalMessageId, second.externalMessageId);
  assert.equal(first.identityCertainty, "ambiguous");
  const statements = buildLiveEventStatements(first, new Date("2026-09-29T10:00:01Z"), "active");
  assert.equal(statements[0].params[10], "synthetic_ambiguous");
});

test("known provider ID retains same-channel legacy compatibility only", () => {
  const scoped = eventForReceiptProjection(
    { ...event, externalMessageId: "provider-message", legacyExternalMessageId: null },
    "receipt-a",
    "customer_message",
    "wa:scoped",
  );
  assert.equal(scoped.externalMessageId, "wa:scoped");
  assert.equal(scoped.legacyExternalMessageId, "provider-message");
  assert.equal(scoped.identityCertainty, "provider");
});
