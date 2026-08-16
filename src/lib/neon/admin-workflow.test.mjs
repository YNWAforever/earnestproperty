import assert from "node:assert/strict";
import test from "node:test";

import {
  canPrepareAdminCampaignQueue,
  canQueueAdminCampaign,
  canReplyToConversation,
  classifyCampaignDeliveryStatus,
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
