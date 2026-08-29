import assert from "node:assert/strict";
import test from "node:test";

import {
  canPrepareAdminCampaignQueue,
  canQueueAdminCampaign,
  canReplyToConversation,
  classifyCampaignDeliveryStatus,
  conversationAttention,
  normalizeAdminPhone,
} from "./admin-workflow.ts";

test("normalizeAdminPhone keeps digits only", () => {
  assert.equal(normalizeAdminPhone("+852 6090 3521"), "85260903521");
  assert.equal(normalizeAdminPhone(" 6822-7287 "), "68227287");
  assert.equal(normalizeAdminPhone(null), null);
});

test("canReplyToConversation enforces Woztell safety gates", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  assert.deepEqual(
    canReplyToConversation({
      woztellEnabled: true,
      optedOut: false,
      lastInboundAt: "2026-06-23T11:00:00.000Z",
      now,
    }),
    { ok: true },
  );
  assert.equal(
    canReplyToConversation({
      woztellEnabled: false,
      optedOut: false,
      lastInboundAt: "2026-06-23T11:00:00.000Z",
      now,
    }).reason,
    "WOZTELL_DISABLED",
  );
  assert.equal(
    canReplyToConversation({
      woztellEnabled: true,
      optedOut: true,
      lastInboundAt: "2026-06-23T11:00:00.000Z",
      now,
    }).reason,
    "CONTACT_OPTED_OUT",
  );
  assert.equal(
    canReplyToConversation({
      woztellEnabled: true,
      optedOut: false,
      lastInboundAt: "2026-06-22T11:00:00.000Z",
      now,
    }).reason,
    "OUTSIDE_24_HOUR_WINDOW",
  );
});

test("canQueueAdminCampaign enforces campaign gates", () => {
  assert.deepEqual(
    canQueueAdminCampaign({
      campaignStatus: "review",
      templateStatus: "active",
      eligibleRecipients: 4,
    }),
    { ok: true },
  );
  assert.equal(
    canQueueAdminCampaign({
      campaignStatus: "sending",
      templateStatus: "active",
      eligibleRecipients: 4,
    }).reason,
    "INVALID_CAMPAIGN_STATUS",
  );
  assert.equal(
    canQueueAdminCampaign({
      campaignStatus: "review",
      templateStatus: "paused",
      eligibleRecipients: 4,
    }).reason,
    "TEMPLATE_NOT_ACTIVE",
  );
  assert.equal(
    canQueueAdminCampaign({
      campaignStatus: "review",
      templateStatus: "active",
      eligibleRecipients: 0,
    }).reason,
    "NO_ELIGIBLE_RECIPIENTS",
  );
});

test("canPrepareAdminCampaignQueue validates non-mutating queue preflight gates", () => {
  assert.deepEqual(
    canPrepareAdminCampaignQueue({
      campaignStatus: "scheduled",
      templateStatus: "active",
    }),
    { ok: true },
  );
  assert.equal(
    canPrepareAdminCampaignQueue({
      campaignStatus: "queued",
      templateStatus: "active",
    }).reason,
    "INVALID_CAMPAIGN_STATUS",
  );
  // A draft must go through review before it can reach a customer.
  assert.equal(
    canPrepareAdminCampaignQueue({
      campaignStatus: "draft",
      templateStatus: "active",
    }).reason,
    "INVALID_CAMPAIGN_STATUS",
  );
  assert.equal(
    canPrepareAdminCampaignQueue({
      campaignStatus: "review",
      templateStatus: "rejected",
    }).reason,
    "TEMPLATE_NOT_ACTIVE",
  );
});

test("classifyCampaignDeliveryStatus updates only materialized active campaigns", () => {
  assert.equal(
    classifyCampaignDeliveryStatus({
      queuedRecipients: 2,
      sendingRecipients: 0,
      totalRecipients: 5,
      failedRecipients: 1,
      blockedRecipients: 0,
    }),
    "sending",
  );
  assert.equal(
    classifyCampaignDeliveryStatus({
      queuedRecipients: 0,
      sendingRecipients: 1,
      totalRecipients: 5,
      failedRecipients: 1,
      blockedRecipients: 0,
    }),
    "sending",
  );
  assert.equal(
    classifyCampaignDeliveryStatus({
      queuedRecipients: 0,
      sendingRecipients: 0,
      totalRecipients: 5,
      failedRecipients: 1,
      blockedRecipients: 1,
    }),
    "completed",
  );
  assert.equal(
    classifyCampaignDeliveryStatus({
      queuedRecipients: 0,
      sendingRecipients: 0,
      totalRecipients: 3,
      failedRecipients: 2,
      blockedRecipients: 1,
    }),
    "failed",
  );
  assert.equal(
    classifyCampaignDeliveryStatus({
      queuedRecipients: 0,
      sendingRecipients: 0,
      totalRecipients: 0,
      failedRecipients: 0,
      blockedRecipients: 0,
    }),
    null,
  );
});

// The inbox marks a conversation as needing a reply from who spoke last, not
// from a read receipt: a message someone opened, meant to answer and never did
// still needs answering, and a read flag would quietly drop it out of the queue.
test("a conversation is awaiting a reply when the customer spoke last", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const inboundLast = conversationAttention({
    lastDirection: "inbound",
    lastInboundAt: "2026-08-19T11:00:00Z",
    now,
  });
  const weReplied = conversationAttention({
    lastDirection: "outbound",
    lastInboundAt: "2026-08-19T11:00:00Z",
    now,
  });

  assert.equal(inboundLast.awaitingReply, true);
  assert.equal(weReplied.awaitingReply, false);
  assert.equal(inboundLast.waitedMs, 60 * 60 * 1000);
});

// The 24-hour window is a deadline, not a detail: once it lapses
// canReplyToConversation refuses the send outright.
test("the reply window is reported as open, closing, then expired", () => {
  const inboundAt = "2026-08-19T00:00:00Z";
  const at = (iso) =>
    conversationAttention({
      lastDirection: "inbound",
      lastInboundAt: inboundAt,
      now: new Date(iso),
    }).windowState;

  assert.equal(at("2026-08-19T01:00:00Z"), "open");
  assert.equal(at("2026-08-19T22:30:00Z"), "closing");
  assert.equal(at("2026-08-20T00:00:01Z"), "expired");
});

test("a conversation with no inbound message has no window to report", () => {
  const attention = conversationAttention({ lastDirection: "outbound", lastInboundAt: null });

  assert.equal(attention.windowState, "none");
  assert.equal(attention.waitedMs, null);
  assert.equal(attention.windowRemainingMs, null);
});

// Clock skew between Postgres and the browser must not produce a negative wait
// or a window longer than the 24 hours WhatsApp actually allows.
test("an inbound timestamp in the future does not invert the wait", () => {
  const attention = conversationAttention({
    lastDirection: "inbound",
    lastInboundAt: "2026-08-19T12:05:00Z",
    now: new Date("2026-08-19T12:00:00Z"),
  });

  assert.equal(attention.waitedMs, 0);
  assert.equal(attention.windowRemainingMs, 24 * 60 * 60 * 1000);
  assert.equal(attention.windowState, "open");
});

test("an unparseable inbound timestamp degrades instead of throwing", () => {
  const attention = conversationAttention({
    lastDirection: "inbound",
    lastInboundAt: "not a date",
  });

  assert.equal(attention.awaitingReply, true);
  assert.equal(attention.windowState, "none");
});
