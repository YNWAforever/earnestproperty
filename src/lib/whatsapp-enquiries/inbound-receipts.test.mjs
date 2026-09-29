import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleWoztellWebhook } from "./webhook.server.ts";

const config = { channelSecret: "synthetic-secret", channelId: "channel-a", appId: "app-a" };
const payload = {
  type: "TEXT",
  eventType: "INBOUND",
  messageId: "synthetic-1",
  member: "customer-a",
  channel: config.channelId,
  app: config.appId,
  data: { text: "請提供樓盤資料" },
};
function signedRequest() {
  const body = JSON.stringify(payload);
  return new Request("https://example.invalid/api/woztell/webhook", {
    method: "POST",
    body,
    headers: {
      "x-woztell-signature": createHmac("sha256", config.channelSecret)
        .update(body)
        .digest("base64"),
    },
  });
}

test("stores_receipt_when_optional_workflow_schema_missing", async () => {
  const sequence = [];
  const response = await handleWoztellWebhook(signedRequest(), {
    config,
    storeReceipt: async (input) => {
      sequence.push("receipt");
      assert.equal(input.event.text, payload.data.text);
      assert.equal(input.channelId, config.channelId);
      return { receiptId: "synthetic-receipt", disposition: "new", projectionState: "pending" };
    },
    markReceipt: async (_id, state) => sequence.push(state),
    ingest: async () => {
      sequence.push("projection");
      throw new Error("WA_ENQUIRY_SCHEMA_REQUIRED");
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(sequence, ["receipt", "projection", "blocked_schema"]);
});

test("minimum_store_failure_is_retryable", async () => {
  let projectionCalls = 0;
  const response = await handleWoztellWebhook(signedRequest(), {
    config,
    storeReceipt: async () => {
      throw new Error("SYNTHETIC_DATABASE_UNAVAILABLE");
    },
    ingest: async () => {
      projectionCalls += 1;
      return { skipped: null };
    },
  });
  assert.equal(response.status, 503);
  assert.equal(projectionCalls, 0);
});

test("unsigned_input_is_rejected_before_receipt", async () => {
  let writes = 0;
  const response = await handleWoztellWebhook(
    new Request("https://example.invalid/api/woztell/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "x-woztell-signature": "bad" },
    }),
    {
      config,
      storeReceipt: async () => {
        writes += 1;
        throw new Error("unexpected");
      },
    },
  );
  assert.equal(response.status, 401);
  assert.equal(writes, 0);
});
