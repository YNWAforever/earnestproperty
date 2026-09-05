import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { enqueueOutboundIntent, finishOutboundIntent } from "./outbound-intent.server.ts";
import { ingestWoztellEvent } from "./woztell-ingest.server.ts";
import { normalizeWoztellEvent } from "./woztell.server.ts";
const url = process.env.TEST_DATABASE_URL;
// Owner prepares the reviewed migrations separately. This suite never migrates or reads DATABASE_URL.
test(
  "disposable database: concurrent intent creation, payload conflicts, early callback reconciliation",
  { skip: !url },
  async () => {
    assert.equal(
      process.env.WOZTELL_TEST_DATABASE_CONFIRMED,
      "true",
      "Explicit disposable target confirmation is required",
    );
    const sql = neon(url);
    const query = (statement, params = []) => sql.query(statement, params);
    const tx = (statements) =>
      sql.transaction((t) =>
        statements.map(({ statement, params = [] }) => t.query(statement, params)),
      );
    const staff = randomUUID(),
      contact = randomUUID(),
      conversation = randomUUID(),
      requestId = randomUUID();
    const external = "synthetic-" + randomUUID();
    try {
      await query("INSERT INTO staff_users(id,email,active) VALUES($1,$2,true)", [
        staff,
        `fixture-${staff}@example.invalid`,
      ]);
      await query("INSERT INTO crm_contacts(id,source) VALUES($1,'test')", [contact]);
      await query(
        "INSERT INTO whatsapp_conversations(id,contact_id,woztell_member_id,last_inbound_at) VALUES($1,$2,$3,now())",
        [conversation, contact, "synthetic-" + conversation],
      );
      const input = {
        requestId,
        conversationId: conversation,
        kind: "text",
        payload: { text: "Synthetic test only" },
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => enqueueOutboundIntent(input, staff, null, query)),
      );
      assert.ok(results.every((r) => r.id === requestId));
      assert.equal(
        Number(
          (
            await query("SELECT count(*) n FROM whatsapp_messages WHERE conversation_id=$1", [
              conversation,
            ])
          )[0].n,
        ),
        1,
      );
      assert.equal(
        Number(
          (
            await query("SELECT count(*) n FROM ops_jobs WHERE idempotency_key=$1", [
              "woztell.reply:" + requestId,
            ])
          )[0].n,
        ),
        1,
      );
      await assert.rejects(
        enqueueOutboundIntent({ ...input, payload: { text: "Different" } }, staff, null, query),
        /CONFLICT/,
      );
      await query("UPDATE whatsapp_outbound_intents SET state='dispatching' WHERE id=$1", [
        requestId,
      ]);
      const early = (
        await query(
          "INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,external_message_id,status) VALUES($1,$2,'outbound','TEXT','Synthetic test only',$3,'accepted') RETURNING id",
          [conversation, contact, external],
        )
      )[0].id;
      await finishOutboundIntent(
        requestId,
        { state: "accepted", externalMessageId: external, error: null },
        tx,
      );
      assert.equal(
        Number(
          (
            await query("SELECT count(*) n FROM whatsapp_messages WHERE conversation_id=$1", [
              conversation,
            ])
          )[0].n,
        ),
        1,
      );
      assert.equal(
        (
          await query("SELECT message_id FROM whatsapp_outbound_intents WHERE id=$1", [requestId])
        )[0].message_id,
        early,
      );
    } finally {
      await query("DELETE FROM ops_jobs WHERE idempotency_key=$1", ["woztell.reply:" + requestId]);
      await query("DELETE FROM whatsapp_outbound_intents WHERE id=$1", [requestId]);
      await query("DELETE FROM whatsapp_messages WHERE conversation_id=$1", [conversation]);
      await query("DELETE FROM whatsapp_conversations WHERE id=$1", [conversation]);
      await query("DELETE FROM crm_contacts WHERE id=$1", [contact]);
      await query("DELETE FROM staff_users WHERE id=$1", [staff]);
    }
  },
);

test(
  "disposable database: simultaneous webhook and history preserve one identity and monotonic recency",
  { skip: !url },
  async () => {
    assert.equal(process.env.WOZTELL_TEST_DATABASE_CONFIRMED, "true");
    const sql = neon(url),
      member = "fixture-" + randomUUID();
    const tx = (statements) =>
      sql.transaction((t) =>
        statements.map(({ statement, params = [] }) => t.query(statement, params)),
      );
    const event = normalizeWoztellEvent({
      memberId: member,
      channelId: "synthetic-channel",
      messageEvent: {
        messageId: "fixture-" + randomUUID(),
        type: "TEXT",
        timestamp: 1700000100,
        data: { text: "Synthetic inquiry" },
      },
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => ingestWoztellEvent(event, tx)),
      );
      assert.equal(new Set(results.map((r) => r.contactId)).size, 1);
      assert.equal(new Set(results.map((r) => r.conversationId)).size, 1);
      assert.equal(results.filter((r) => r.messageInserted).length, 1);
      const older = normalizeWoztellEvent({
        memberId: member,
        channelId: "synthetic-channel",
        messageEvent: {
          messageId: "fixture-" + randomUUID(),
          type: "TEXT",
          timestamp: 1700000000,
          data: { text: "STOP" },
        },
      });
      await ingestWoztellEvent(older, tx);
      const contact = (
        await sql.query(
          "SELECT opt_in_whatsapp,opted_out_whatsapp,last_inbound_at FROM crm_contacts WHERE whatsapp_member_id=$1",
          [member],
        )
      )[0];
      assert.equal(contact.opt_in_whatsapp, false);
      assert.equal(contact.opted_out_whatsapp, true);
      assert.equal(new Date(contact.last_inbound_at).getTime(), 1700000100000);
    } finally {
      await sql.query("DELETE FROM whatsapp_messages WHERE woztell_member_id=$1", [member]);
      await sql.query("DELETE FROM whatsapp_conversations WHERE woztell_member_id=$1", [member]);
      await sql.query("DELETE FROM crm_contacts WHERE whatsapp_member_id=$1", [member]);
    }
  },
);

test(
  "disposable database: acceptance write failure then later evidence resolves unknown monotonically",
  { skip: !url },
  async () => {
    assert.equal(process.env.WOZTELL_TEST_DATABASE_CONFIRMED, "true");
    const { deliverOutboundIntent } = await import("./outbound-intent.server.ts");
    const { chatNodeToEvent } = await import("./woztell-history.server.ts");
    const sql = neon(url),
      query = (statement, params = []) => sql.query(statement, params);
    const tx = (statements) =>
      sql.transaction((t) =>
        statements.map(({ statement, params = [] }) => t.query(statement, params)),
      );
    const staff = randomUUID(),
      contact = randomUUID(),
      conversation = randomUUID(),
      requestId = randomUUID();
    const member = "fixture-" + randomUUID(),
      otherMember = "fixture-" + randomUUID(),
      external = "fixture-" + randomUUID();
    const input = {
      requestId,
      conversationId: conversation,
      kind: "text",
      payload: { text: "Synthetic text" },
    };
    try {
      await query("INSERT INTO staff_users(id,email,active) VALUES($1,$2,true)", [
        staff,
        `fixture-${staff}@example.invalid`,
      ]);
      await query("INSERT INTO crm_contacts(id,whatsapp_member_id,source) VALUES($1,$2,'test')", [
        contact,
        member,
      ]);
      await query(
        "INSERT INTO whatsapp_conversations(id,contact_id,woztell_member_id,channel_id,last_inbound_at) VALUES($1,$2,$3,$4,now())",
        [conversation, contact, member, "fixture-channel"],
      );
      await enqueueOutboundIntent(input, staff, null, query);
      let failedOnce = false,
        sends = 0;
      await deliverOutboundIntent(requestId, {
        checkpoint: async () => {},
        begin: async () => {
          await query("UPDATE whatsapp_outbound_intents SET state='dispatching' WHERE id=$1", [
            requestId,
          ]);
          return { memberId: member, response: [{ type: "TEXT", text: "Synthetic text" }] };
        },
        send: async () => {
          sends++;
          return { ok: true, body: { ok: 1, messageId: external } };
        },
        finish: async (id, outcome) => {
          if (!failedOnce && outcome.state === "accepted") {
            failedOnce = true;
            throw Error("injected completion failure");
          }
          await finishOutboundIntent(id, outcome, tx);
        },
      });
      const state = async () =>
        (await query("SELECT state FROM whatsapp_outbound_intents WHERE id=$1", [requestId]))[0]
          .state;
      assert.equal(await state(), "unknown");
      const payload = {
        type: "BOT",
        memberId: member,
        channelId: "fixture-channel",
        messageEvent: {
          messageId: external,
          type: "TEXT",
          timestamp: 1700000100,
          data: { text: "Synthetic text" },
        },
      };
      for (const changed of [
        { ...payload, type: "MEMBER" },
        { ...payload, memberId: otherMember },
        { ...payload, channelId: "different-channel" },
        { ...payload, messageEvent: { ...payload.messageEvent, data: { text: "Different text" } } },
      ]) {
        await ingestWoztellEvent(normalizeWoztellEvent(changed), tx);
        assert.equal(await state(), "unknown");
      }
      const valid = normalizeWoztellEvent(payload);
      const history = chatNodeToEvent({
        from: "BOT",
        memberId: member,
        channelId: "fixture-channel",
        messageEvent: payload.messageEvent,
      });
      await Promise.all([ingestWoztellEvent(valid, tx), ingestWoztellEvent(history, tx)]);
      assert.equal(await state(), "accepted");
      assert.equal(sends, 1);
      const rows = await query(
        "SELECT status,error FROM whatsapp_messages WHERE external_message_id=$1",
        [external],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "accepted");
      assert.equal(rows[0].error, null);
      await finishOutboundIntent(
        requestId,
        { state: "unknown", externalMessageId: external, error: "STALE_FAILURE" },
        tx,
      );
      assert.equal(await state(), "accepted");
    } finally {
      await query("DELETE FROM ops_jobs WHERE idempotency_key=$1", ["woztell.reply:" + requestId]);
      await query("DELETE FROM whatsapp_outbound_intents WHERE id=$1", [requestId]);
      await query("DELETE FROM whatsapp_messages WHERE woztell_member_id=ANY($1::text[])", [
        [member, otherMember],
      ]);
      await query("DELETE FROM whatsapp_conversations WHERE woztell_member_id=ANY($1::text[])", [
        [member, otherMember],
      ]);
      await query("DELETE FROM crm_contacts WHERE whatsapp_member_id=ANY($1::text[])", [
        [member, otherMember],
      ]);
      await query("DELETE FROM staff_users WHERE id=$1", [staff]);
    }
  },
);
test(
  "disposable receipts reconcile out of order without transcript bubbles or identity leakage",
  { skip: !url },
  async () => {
    assert.equal(process.env.WOZTELL_TEST_DATABASE_CONFIRMED, "true");
    const sql = neon(url),
      id = randomUUID(),
      member = "receipt-" + id,
      channel = "receipt-channel-" + id,
      external = "receipt-message-" + id;
    const tx = (statements) =>
      sql.transaction((t) =>
        statements.map(({ statement, params = [] }) => t.query(statement, params)),
      );
    const status = (type, chan = channel) =>
      normalizeWoztellEvent({
        type,
        messageId: external,
        member,
        channel: chan,
        timestamp: 1700000000,
        data: { messageId: external },
      });
    try {
      await ingestWoztellEvent(status("DELIVERED"), tx);
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM whatsapp_messages WHERE external_message_id=$1",
            [external],
          )
        )[0].n,
        0,
      );
      await ingestWoztellEvent(
        normalizeWoztellEvent({
          type: "BOT",
          memberId: member,
          channelId: channel,
          messageEvent: {
            type: "TEXT",
            messageId: external,
            timestamp: 1700000000,
            data: { text: "synthetic receipt test" },
          },
        }),
        tx,
      );
      await ingestWoztellEvent(status("READ", "different-channel"), tx);
      assert.equal(
        (
          await sql.query("SELECT status FROM whatsapp_messages WHERE external_message_id=$1", [
            external,
          ])
        )[0].status,
        "delivered",
      );
      await ingestWoztellEvent(status("READ"), tx);
      await ingestWoztellEvent(status("DELIVERED"), tx);
      await ingestWoztellEvent(status("FAILED"), tx);
      const rows = await sql.query(
        "SELECT text,status FROM whatsapp_messages WHERE external_message_id=$1",
        [external],
      );
      assert.deepEqual(rows, [{ text: "synthetic receipt test", status: "read" }]);
      await ingestWoztellEvent(status("READ", "different-channel"), tx);
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM whatsapp_messages WHERE external_message_id=$1",
            [external],
          )
        )[0].n,
        1,
      );
      assert.equal(
        (
          await sql.query(
            "SELECT last_inbound_at FROM whatsapp_conversations WHERE woztell_member_id=$1",
            [member],
          )
        )[0].last_inbound_at,
        null,
      );
    } finally {
      await sql.query("DELETE FROM whatsapp_delivery_events WHERE woztell_member_id=$1", [member]);
      await sql.query("DELETE FROM whatsapp_messages WHERE woztell_member_id=$1", [member]);
      await sql.query("DELETE FROM whatsapp_conversations WHERE woztell_member_id=$1", [member]);
      await sql.query("DELETE FROM crm_contacts WHERE whatsapp_member_id=$1", [member]);
    }
  },
);
