import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { handleWoztellWebhook } from "./webhook.server.ts";
import test from "node:test";
import {
  markInboundReceipt,
  recoverPendingInboundReceipts,
  storeInboundReceipt,
} from "./inbound-receipts.server.ts";

const migration = readFileSync(
  new URL("../../../neon/migrations/20260929100000_whatsapp_inbound_receipts.sql", import.meta.url),
  "utf8",
);
function input(mode = "active") {
  return {
    tenantKey: "woztell:synthetic-app",
    appId: "synthetic-app",
    channelId: "synthetic-channel",
    origin: "live_webhook",
    eventKind: "customer_message",
    bodyDigest: "a".repeat(64),
    providerOccurredAt: "2026-09-29T09:59:59Z",
    receivedAt: new Date("2026-09-29T10:00:00Z"),
    capture: {
      mode,
      activationId: "11111111-1111-4111-8111-111111111111",
      effectsEligible: false,
    },
    event: {
      direction: "inbound",
      externalMessageId: "provider-message-1",
      legacyExternalMessageId: null,
      fromPhone: "85255550101",
      toPhone: "85255550202",
      timestamp: "2026-09-29T09:59:59Z",
      messageType: "TEXT",
      text: "請提供更多資料",
      woztellMemberId: "customer-1",
      channelId: "synthetic-channel",
      appId: "synthetic-app",
      memberName: "Synthetic Customer",
      payload: { type: "TEXT", eventType: "INBOUND", data: { text: "請提供更多資料" } },
    },
  };
}
async function withDb(fn) {
  const db = new PGlite();
  const query = async (statement, params = []) => (await db.query(statement, params)).rows;
  try {
    await db.exec(migration);
    await fn({ db, query });
  } finally {
    await db.close();
  }
}

test("minimum receipt remains readable without workflow tables", async () => {
  await withDb(async ({ query }) => {
    const result = await storeInboundReceipt(input(), { query });
    assert.equal(result.disposition, "new");
    await markInboundReceipt(result.receiptId, "blocked_schema", "WA_ENQUIRY_SCHEMA_REQUIRED", {
      query,
    });
    const [row] = await query(
      "SELECT projection_state,block_reason,normalized_event,capture_mode,effects_eligible FROM whatsapp_inbound_receipts WHERE id=$1",
      [result.receiptId],
    );
    assert.equal(row.projection_state, "blocked_schema");
    assert.equal(row.block_reason, "WA_ENQUIRY_SCHEMA_REQUIRED");
    assert.equal(row.normalized_event.text, "請提供更多資料");
    assert.equal(row.capture_mode, "active");
    assert.equal(row.effects_eligible, false);
  });
});

test("recovery_never_upgrades_old_effects", async () => {
  await withDb(async ({ query }) => {
    const active = await storeInboundReceipt(input("active"), { query });
    const off = await storeInboundReceipt(
      { ...input("off"), event: { ...input().event, externalMessageId: "provider-message-2" } },
      { query },
    );
    const modes = [];
    const result = await recoverPendingInboundReceipts({
      query,
      project: async (_event, mode) => {
        modes.push(mode);
      },
    });
    assert.deepEqual(modes.sort(), ["observe", "off"].sort());
    assert.equal(result.projected, 2);
    const rows = await query(
      "SELECT id,projection_state,capture_mode,activation_id,effects_eligible FROM whatsapp_inbound_receipts ORDER BY received_at,id",
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.projection_state === "projected"));
    assert.ok(rows.every((row) => row.effects_eligible === false));
    assert.ok(rows.some((row) => row.id === active.receiptId));
    assert.ok(rows.some((row) => row.id === off.receiptId));
  });
});

test("receipt DB failure cannot appear committed", async () => {
  await withDb(async ({ db, query }) => {
    await db.exec("DROP TABLE whatsapp_inbound_receipts");
    await assert.rejects(storeInboundReceipt(input(), { query }));
  });
});
test("signed webhook commits receipt before blocked workflow projection", async () => {
  await withDb(async ({ query }) => {
    const config = {
      channelSecret: "synthetic-secret",
      channelId: "synthetic-channel",
      appId: "synthetic-app",
    };
    const payload = {
      type: "TEXT",
      eventType: "INBOUND",
      messageId: "synthetic-db-message",
      member: "synthetic-customer",
      channel: config.channelId,
      app: config.appId,
      timestamp: 1790675999,
      data: { text: "樓盤資料查詢" },
    };
    const body = JSON.stringify(payload);
    const request = new Request("https://example.invalid/api/woztell/webhook", {
      method: "POST",
      body,
      headers: {
        "x-woztell-signature": createHmac("sha256", config.channelSecret)
          .update(body)
          .digest("base64"),
      },
    });
    const response = await handleWoztellWebhook(request, {
      config,
      storeReceipt: (receipt) => storeInboundReceipt(receipt, { query }),
      markReceipt: (id, state, reason) => markInboundReceipt(id, state, reason, { query }),
      ingest: async () => {
        throw new Error("WA_ENQUIRY_SCHEMA_REQUIRED");
      },
    });
    assert.equal(response.status, 200);
    const [row] = await query(
      "SELECT projection_state,block_reason,normalized_event,provider_occurred_at FROM whatsapp_inbound_receipts",
    );
    assert.equal(row.projection_state, "blocked_schema");
    assert.equal(row.block_reason, "WA_ENQUIRY_SCHEMA_REQUIRED");
    assert.equal(row.normalized_event.text, "樓盤資料查詢");
    assert.ok(row.provider_occurred_at);
  });
});
