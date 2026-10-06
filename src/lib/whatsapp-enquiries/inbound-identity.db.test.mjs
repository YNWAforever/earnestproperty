import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import test from "node:test";
import { storeInboundReceipt } from "./inbound-receipts.server.ts";

const migration = readFileSync(
  new URL("../../../neon/migrations/20260929100000_whatsapp_inbound_receipts.sql", import.meta.url),
  "utf8",
);
function receiptInput({
  id = "provider-1",
  channel = "channel-a",
  kind = "customer_message",
  type = "TEXT",
} = {}) {
  return {
    tenantKey: "woztell:app-a",
    appId: "app-a",
    channelId: channel,
    origin: "live_webhook",
    eventKind: kind,
    providerOccurredAt: "2026-09-29T10:00:00Z",
    bodyDigest: "b".repeat(64),
    receivedAt: new Date("2026-09-29T10:00:01Z"),
    capture: { mode: "observe", activationId: null, effectsEligible: false },
    event: {
      direction: "inbound",
      externalMessageId: id ?? "synthetic-same-second-content",
      legacyExternalMessageId: id ? null : "synthetic-same-second",
      fromPhone: "85255550101",
      toPhone: "85255550202",
      timestamp: "2026-09-29T10:00:00Z",
      messageType: type,
      text: "同一段文字",
      woztellMemberId: "member-a",
      channelId: channel,
      appId: "app-a",
      memberName: "Synthetic Customer",
      payload: { type, eventType: "INBOUND", data: { text: "同一段文字" } },
    },
  };
}
async function withDb(fn) {
  const db = new PGlite();
  const query = async (statement, params = []) => (await db.query(statement, params)).rows;
  try {
    await db.exec(migration);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929101000_whatsapp_receipt_identity.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await fn(query);
  } finally {
    await db.close();
  }
}

test("same scoped provider event twenty times retains one projected identity", async () => {
  await withDb(async (query) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => storeInboundReceipt(receiptInput(), { query })),
    );
    assert.equal(new Set(results.map((result) => result.receiptId)).size, 1);
    assert.equal(results.filter((result) => result.disposition === "new").length, 1);
    assert.equal((await query("SELECT count(*)::int AS n FROM whatsapp_inbound_receipts"))[0].n, 1);
    const [row] = await query("SELECT delivery_count,attempt_count FROM whatsapp_inbound_receipts");
    assert.equal(row.delivery_count, 20);
    assert.equal(row.attempt_count, 1);
  });
});

test("different provider IDs and same ID across channels are separate", async () => {
  await withDb(async (query) => {
    const a = await storeInboundReceipt(receiptInput({ id: "provider-1" }), { query });
    const b = await storeInboundReceipt(receiptInput({ id: "provider-2" }), { query });
    const c = await storeInboundReceipt(receiptInput({ id: "provider-1", channel: "channel-b" }), {
      query,
    });
    assert.equal(new Set([a.receiptId, b.receiptId, c.receiptId]).size, 3);
    const rows = await query(
      "SELECT identity_key,channel_id FROM whatsapp_inbound_receipts ORDER BY channel_id,provider_message_id",
    );
    assert.notEqual(rows[0].identity_key, rows[2].identity_key);
  });
});

test("missing provider ID preserves both same-second attempts as ambiguous", async () => {
  await withDb(async (query) => {
    const a = await storeInboundReceipt(receiptInput({ id: null }), { query });
    const b = await storeInboundReceipt(receiptInput({ id: null }), { query });
    assert.notEqual(a.receiptId, b.receiptId);
    assert.equal(a.disposition, "identity_ambiguous");
    assert.equal(b.disposition, "identity_ambiguous");
    const rows = await query(
      "SELECT identity_key,similarity_key FROM whatsapp_inbound_receipts ORDER BY id",
    );
    assert.deepEqual(
      rows.map((row) => row.identity_key),
      [null, null],
    );
    assert.equal(rows[0].similarity_key, rows[1].similarity_key);
  });
});

test("SENT and READ for one message are distinct scoped delivery evidence", async () => {
  await withDb(async (query) => {
    const sent = await storeInboundReceipt(
      receiptInput({ id: "provider-1", kind: "delivery_receipt", type: "SENT" }),
      { query },
    );
    const read = await storeInboundReceipt(
      receiptInput({ id: "provider-1", kind: "delivery_receipt", type: "READ" }),
      { query },
    );
    assert.notEqual(sent.receiptId, read.receiptId);
    const rows = await query("SELECT identity_key FROM whatsapp_inbound_receipts ORDER BY id");
    assert.notEqual(rows[0].identity_key, rows[1].identity_key);
  });
});
import { deriveInboundIdentity, eventForReceiptProjection } from "./inbound-identity.ts";
import { ingestWoztellEvent } from "../woztell/woztell-ingest.server.ts";

test("scoped transcript IDs keep identical raw provider IDs from two channels", async () => {
  const db = new PGlite();
  const query = async (statement, params = []) => (await db.query(statement, params)).rows;
  const transaction = async (statements) => {
    await db.exec("BEGIN");
    try {
      const result = [];
      for (const item of statements) result.push(await query(item.statement, item.params ?? []));
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    await db.exec(`
      CREATE TYPE whatsapp_message_direction AS ENUM ('inbound','outbound');
      CREATE TABLE crm_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,phone text,
        normalized_phone text UNIQUE,whatsapp_member_id text UNIQUE,source text,
        opt_in_whatsapp boolean DEFAULT false,opted_out_whatsapp boolean DEFAULT false,
        last_inbound_at timestamptz,updated_at timestamptz DEFAULT now(),
        opted_out_at timestamptz,opted_out_message_id text,opted_out_text text,
        opted_out_source text,opted_out_cleared_at timestamptz,opted_out_cleared_by uuid
      );
      CREATE TABLE whatsapp_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid REFERENCES crm_contacts(id),
        woztell_member_id text,channel_id text,last_message_at timestamptz,
        last_inbound_at timestamptz,updated_at timestamptz DEFAULT now(),
        UNIQUE(channel_id,woztell_member_id)
      );
      CREATE TABLE whatsapp_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid REFERENCES whatsapp_conversations(id),
        contact_id uuid REFERENCES crm_contacts(id),
        direction whatsapp_message_direction,message_type text,text text,
        external_message_id text UNIQUE,woztell_member_id text,channel_id text,
        payload jsonb DEFAULT '{}'::jsonb,status text,error text,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE whatsapp_outbound_intents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid,
        conversation_id uuid,external_message_id text,state text,kind text,
        payload jsonb,error text,updated_at timestamptz
      );
    `);
    const receiptId = "11111111-1111-4111-8111-111111111111";
    for (const channel of ["channel-a", "channel-b"]) {
      const identity = deriveInboundIdentity({
        tenantKey: "woztell:app-a",
        provider: "woztell",
        appId: "app-a",
        channelId: channel,
        eventKind: "customer_message",
        providerMessageId: "same-raw-provider-id",
        payloadDigest: "c".repeat(64),
      });
      const raw = receiptInput({ id: "same-raw-provider-id", channel }).event;
      const event = eventForReceiptProjection(
        raw,
        receiptId,
        "customer_message",
        identity.scopedProviderKey,
      );
      const result = await ingestWoztellEvent(event, "live_webhook", transaction, { mode: "off" });
      assert.equal(result.messageInserted, true);
    }
    for (const id of ["receipt-missing-a", "receipt-missing-b"]) {
      const raw = receiptInput({ id: null, channel: "channel-a" }).event;
      const event = eventForReceiptProjection(raw, id, "customer_message", null);
      const result = await ingestWoztellEvent(event, "live_webhook", transaction, { mode: "off" });
      assert.equal(result.messageInserted, true);
    }
    const rows = await query(
      "SELECT channel_id,external_message_id FROM whatsapp_messages ORDER BY channel_id",
    );
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((row) => row.external_message_id)).size, 4);
    assert.equal(
      rows.filter((row) => row.external_message_id.startsWith("wa-ambiguous:")).length,
      2,
    );
  } finally {
    await db.close();
  }
});
import { createHmac } from "node:crypto";
import { handleWoztellWebhook } from "./webhook.server.ts";
import { markInboundReceipt } from "./inbound-receipts.server.ts";

test("signed webhook skips projected duplicates and preserves ambiguous deliveries", async () => {
  await withDb(async (query) => {
    const config = { channelSecret: "synthetic-secret", channelId: "channel-a", appId: "app-a" };
    const seen = [];
    const send = async (messageId) => {
      const payload = {
        type: "TEXT",
        eventType: "INBOUND",
        ...(messageId ? { messageId } : {}),
        member: "member-a",
        channel: config.channelId,
        app: config.appId,
        timestamp: 1790676000,
        from: "85255550101",
        to: "85255550202",
        data: { text: "同一段文字" },
      };
      const body = JSON.stringify(payload);
      return handleWoztellWebhook(
        new Request("https://example.invalid/api/woztell/webhook", {
          method: "POST",
          body,
          headers: {
            "x-woztell-signature": createHmac("sha256", config.channelSecret)
              .update(body)
              .digest("base64"),
          },
        }),
        {
          config,
          storeReceipt: (receipt) => storeInboundReceipt(receipt, { query }),
          markReceipt: (id, state, reason) => markInboundReceipt(id, state, reason, { query }),
          ingest: async (event) => {
            seen.push(event);
            return { skipped: null };
          },
        },
      );
    };
    assert.equal((await send("provider-1")).status, 200);
    const duplicate = await send("provider-1");
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).skipped, "duplicate");
    assert.equal(seen.length, 1);
    await send(null);
    await send(null);
    assert.equal(seen.length, 3);
    assert.notEqual(seen[1].externalMessageId, seen[2].externalMessageId);
    assert.equal(seen[1].identityCertainty, "ambiguous");
    const [summary] = await query(
      "SELECT count(*)::int AS receipts,sum(delivery_count)::int AS deliveries FROM whatsapp_inbound_receipts",
    );
    assert.equal(summary.receipts, 3);
    assert.equal(summary.deliveries, 4);
  });
});
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";

test("READ before SENT does not regress the outbound message", async () => {
  const db = new PGlite();
  const query = async (statement, params = []) => (await db.query(statement, params)).rows;
  const transaction = async (statements) => {
    await db.exec("BEGIN");
    try {
      const rows = [];
      for (const item of statements) rows.push(await query(item.statement, item.params ?? []));
      await db.exec("COMMIT");
      return rows;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    await db.exec(`
      CREATE TYPE whatsapp_message_direction AS ENUM ('inbound','outbound');
      CREATE TABLE whatsapp_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),channel_id text,
        woztell_member_id text,last_message_at timestamptz,last_inbound_at timestamptz
      );
      CREATE TABLE whatsapp_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid,
        direction whatsapp_message_direction,message_type text,text text,
        external_message_id text UNIQUE,woztell_member_id text,channel_id text,
        payload jsonb DEFAULT '{}'::jsonb,status text,created_at timestamptz DEFAULT now()
      );
      CREATE TABLE whatsapp_outbound_intents (message_id uuid);
    `);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260906020000_whatsapp_delivery_events.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await query(
      "INSERT INTO whatsapp_messages(direction,message_type,external_message_id,woztell_member_id,channel_id,status) VALUES('outbound','TEXT','provider-1','member-a','channel-a','accepted')",
    );
    const status = (type) =>
      normalizeWoztellEvent({
        type,
        messageId: "provider-1",
        member: "member-a",
        channel: "channel-a",
        app: "app-a",
        timestamp: 1790676000,
        data: {},
      });
    for (const type of ["READ", "SENT", "READ"]) {
      const outcome = await ingestWoztellEvent(status(type), "live_webhook", transaction, {
        mode: "off",
      });
      assert.equal(outcome.skipped, "status-event");
    }
    assert.equal((await query("SELECT status FROM whatsapp_messages"))[0].status, "read");
    assert.equal((await query("SELECT count(*)::int AS n FROM whatsapp_delivery_events"))[0].n, 2);
  } finally {
    await db.close();
  }
});
