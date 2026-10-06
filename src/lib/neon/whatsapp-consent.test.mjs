import assert from "node:assert/strict";
import test from "node:test";
import { setWhatsappMarketingConsent } from "./whatsapp-consent.server.ts";

test("agents cannot change marketing consent or write audit evidence", async () => {
  let writes = 0;
  await assert.rejects(
    setWhatsappMarketingConsent(
      {
        contactId: "11111111-1111-4111-8111-111111111111",
        optedIn: true,
        evidenceSource: "written_confirmation",
        evidenceRef: "case-1",
      },
      { staffId: "staff", roles: ["agent"] },
      async () => {
        writes++;
        return [];
      },
    ),
    (error) => error instanceof Response && error.status === 403,
  );
  assert.equal(writes, 0);
});

test("consent update records server copy version and evidence atomically", async () => {
  const result = await setWhatsappMarketingConsent(
    {
      contactId: "11111111-1111-4111-8111-111111111111",
      optedIn: true,
      evidenceSource: "written_confirmation",
      evidenceRef: "case-1",
    },
    { staffId: "staff", roles: ["admin"] },
    async (sql, params) => {
      assert.match(sql, /INSERT INTO crm_consent_events/);
      assert.match(sql, /UPDATE crm_contacts/);
      assert.equal(params.includes("whatsapp-marketing-v1"), true);
      return [{ id: "contact", opted_in: true }];
    },
  );
  assert.equal(result.optedIn, true);
});

test("legacy reason-only reset denies every role without changing consent", async () => {
  const { rejectLegacyWhatsappOptOutReset } = await import("./whatsapp-consent.server.ts");
  for (const [roles, status] of [
    [["admin"], 409],
    [["manager"], 409],
    [["agent"], 403],
    [["viewer"], 403],
    [[], 403],
  ]) {
    await assert.rejects(
      async () => rejectLegacyWhatsappOptOutReset({ staffId: "staff", roles }),
      (error) => error instanceof Response && error.status === status,
    );
  }
});
test("reason-only or missing-reference input cannot enter the evidence workflow", async () => {
  let writes = 0;
  const query = async () => {
    writes++;
    return [];
  };
  const actor = { staffId: "staff", roles: ["admin"] };
  for (const input of [
    { contactId: "11111111-1111-4111-8111-111111111111", reason: "Please clear" },
    {
      contactId: "11111111-1111-4111-8111-111111111111",
      optedIn: true,
      evidenceSource: "written_confirmation",
    },
    {
      contactId: "11111111-1111-4111-8111-111111111111",
      optedIn: true,
      evidenceSource: "customer_opt_out",
      evidenceRef: "case-1",
    },
  ])
    await assert.rejects(setWhatsappMarketingConsent(input, actor, query));
  assert.equal(writes, 0);
});

test("a near-miss confirm copies that message as evidence and audits trigger near_miss; a foreign message id is refused", async () => {
  const contactId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  const actor = { staffId: "33333333-3333-4333-8333-333333333333", roles: ["manager"] };
  const input = {
    contactId,
    optedIn: false,
    evidenceSource: "customer_opt_out",
    evidenceRef: `near-miss:${messageId}`,
  };
  let captured;
  const result = await setWhatsappMarketingConsent(input, actor, async (sql, params) => {
    captured = { sql, params };
    return [{ evidence_ok: true, id: contactId, opted_in: false }];
  });
  assert.equal(result.optedIn, false);
  const { sql, params } = captured;
  // The message lookup is bound to the same contact ($1), inbound only, and by the uuid.
  const lookup = sql.match(/FROM whatsapp_messages[^)]*/)?.[0] ?? "";
  assert.match(lookup, /contact_id\s*=\s*\$1::uuid/);
  assert.match(lookup, /direction\s*=\s*'inbound'/);
  const uuidParam = params.indexOf(messageId) + 1;
  assert.ok(uuidParam > 0, "the near-miss message uuid is a bound parameter");
  assert.match(lookup, new RegExp(`m\\.id\\s*=\\s*\\$${uuidParam}::uuid`));
  assert.match(sql, /left\(m\.text,\s*500\)/);
  assert.match(sql, /'trigger'/);
  assert.match(sql, /'evidenceRef'/);
  assert.match(sql, /'near_miss'/);
  assert.match(sql, /'manual'/);
  assert.equal(params.includes(input.evidenceRef), true);

  await assert.rejects(
    setWhatsappMarketingConsent(input, actor, async () => [
      { evidence_ok: false, id: null, opted_in: null },
    ]),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("recording 拒收推廣 stamps staff_recorded evidence; recording consent keeps the evidence columns", async () => {
  const statements = [];
  const query = async (sql, params) => {
    statements.push({ sql, params });
    return [{ evidence_ok: true, id: "contact", opted_in: params[1] }];
  };
  const actor = { staffId: "33333333-3333-4333-8333-333333333333", roles: ["admin"] };
  await setWhatsappMarketingConsent(
    {
      contactId: "11111111-1111-4111-8111-111111111111",
      optedIn: false,
      evidenceSource: "customer_opt_out",
      evidenceRef: "call-2026-10-06",
    },
    actor,
    query,
  );
  await setWhatsappMarketingConsent(
    {
      contactId: "11111111-1111-4111-8111-111111111111",
      optedIn: true,
      evidenceSource: "written_confirmation",
      evidenceRef: "case-2",
    },
    actor,
    query,
  );
  for (const { sql } of statements) {
    assert.match(
      sql,
      /opted_out_source\s*=\s*CASE WHEN NOT \$2 AND NOT c\.opted_out_whatsapp THEN 'staff_recorded'/,
    );
    assert.match(
      sql,
      /opted_out_at\s*=\s*CASE WHEN NOT \$2 AND NOT c\.opted_out_whatsapp THEN now\(\)/,
    );
    assert.doesNotMatch(sql, /opted_out_(at|text|message_id|source)\s*=\s*NULL/i);
    // Every evidence column falls back to its own existing value, so $2=true leaves it untouched.
    for (const column of [
      "opted_out_at",
      "opted_out_message_id",
      "opted_out_text",
      "opted_out_source",
    ])
      assert.match(sql, new RegExp(`${column}\\s*=\\s*CASE[^,]*ELSE c\\.${column} END`));
  }
  // A non-near-miss reference carries no message uuid.
  assert.equal(statements[0].params[6], null);
});
