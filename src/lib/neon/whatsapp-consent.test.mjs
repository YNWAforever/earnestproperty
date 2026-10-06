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
    assert.match(sql, /opted_out_source\s*=\s*CASE WHEN NOT \$2 THEN 'staff_recorded'/);
    assert.match(sql, /opted_out_at\s*=\s*CASE WHEN NOT \$2 THEN now\(\)/);
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

test("a near-miss: reference that is not near-miss:<uuid> is refused with 400 and no query", async () => {
  let writes = 0;
  const query = async () => {
    writes++;
    return [{ evidence_ok: true, id: "contact", opted_in: false }];
  };
  for (const evidenceRef of [
    "near-miss:",
    "near-miss:abc",
    "near-miss:11111111-1111-4111-8111-11111111111",
    "near-miss:11111111-1111-4111-8111-111111111111/x",
    "NEAR-MISS:11111111-1111-4111-8111-11111111111z",
  ])
    await assert.rejects(
      setWhatsappMarketingConsent(
        {
          contactId: "11111111-1111-4111-8111-111111111111",
          optedIn: false,
          evidenceSource: "customer_opt_out",
          evidenceRef,
        },
        { staffId: "33333333-3333-4333-8333-333333333333", roles: ["admin"] },
        query,
      ),
      (error) => error instanceof Response && error.status === 400,
      evidenceRef,
    );
  assert.equal(writes, 0);
});

// ---------------------------------------------------------------------------
// FX-08 Task 3: clearing an accidental opt-out, and the near-miss flag.
// Unit tests with a fake query port. Kept in this file (already in test:woztell)
// so no package.json script line changes and src/test-wiring stays green.
// Behaviour on real SQL is in src/lib/woztell/opt-out.owned.db.test.mjs.
// ---------------------------------------------------------------------------
const OO_CONTACT = "44444444-4444-4444-8444-444444444444";
const OO_CONV = "55555555-5555-4555-8555-555555555555";
const OO_MSG = "66666666-6666-4666-8666-666666666666";
const OO_MANAGER = { staffId: "77777777-7777-4777-8777-777777777777", roles: ["manager"] };
const OO_AT = "2026-08-01T10:00:00.000Z";
// The opt-out version: the exact microsecond UTC string the read emits (FX-05b pattern).
const OO_VERSION = "2026-08-01T10:00:00.000000Z";
// assert.rejects needs a synchronous validator, so the Response body is read here instead.
async function rejectsWith(promise, status, body) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Response, `expected a ${status} Response, got ${error}`);
  assert.equal(error.status, status);
  if (body) assert.equal(await error.text(), body);
}
function fakeQuery(responses) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const next = responses.shift();
    if (!next) throw Error("unexpected query: " + sql.slice(0, 80));
    return next;
  };
  return { calls, query };
}
const legacyRead = (patch = {}) => ({
  actor_ok: true,
  id: OO_CONTACT,
  opted_out_whatsapp: true,
  opted_out_at: new Date(OO_AT),
  opted_out_version: OO_VERSION,
  opted_out_message_id: null,
  opted_out_text: null,
  opted_out_source: "legacy",
  opted_out_cleared_at: null,
  inbound_texts: ["唔要"],
  ...patch,
});
const clearInput = (patch = {}) => ({
  contactId: OO_CONTACT,
  reason: "客戶只是回覆唔要睇呢個盤",
  expectedOptedOutAt: OO_VERSION,
  ...patch,
});

test("clearAccidentalOptOut: agents, viewers and unknown roles are refused before any query", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  for (const roles of [["agent"], ["viewer"], []]) {
    const { calls, query } = fakeQuery([]);
    await rejectsWith(
      clearAccidentalOptOut(clearInput(), { staffId: OO_MANAGER.staffId, roles }, { query }),
      403,
    );
    assert.equal(calls.length, 0);
  }
});

test("clearAccidentalOptOut: invalid input is a 400 with no query", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  for (const input of [
    clearInput({ reason: "  唔  " }),
    clearInput({ reason: "x".repeat(501) }),
    clearInput({ contactId: "not-a-uuid" }),
    clearInput({ expectedOptedOutAt: "yesterday" }),
    // A millisecond ISO time is not a version: only the exact microsecond string is.
    clearInput({ expectedOptedOutAt: OO_AT }),
    clearInput({ extra: true }),
    { contactId: OO_CONTACT, reason: "合理的原因說明" },
    null,
  ]) {
    const { calls, query } = fakeQuery([]);
    await rejectsWith(clearAccidentalOptOut(input, OO_MANAGER, { query }), 400);
    assert.equal(calls.length, 0);
  }
});

test("clearAccidentalOptOut: an inactive or demoted manager (SQL check) is 403 with no write", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  const { calls, query } = fakeQuery([[legacyRead({ actor_ok: false })]]);
  await rejectsWith(clearAccidentalOptOut(clearInput(), OO_MANAGER, { query }), 403);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /s\.active/);
  assert.match(calls[0].sql, /'admin',\s*'manager'/);
});

test("clearAccidentalOptOut: a contact that is not found or never opted out is 404", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  for (const row of [
    { actor_ok: true, id: null },
    legacyRead({ opted_out_whatsapp: false, opted_out_at: null, opted_out_source: null }),
  ]) {
    const { calls, query } = fakeQuery([[row]]);
    await rejectsWith(clearAccidentalOptOut(clearInput(), OO_MANAGER, { query }), 404);
    assert.equal(calls.length, 1);
  }
});

test("clearAccidentalOptOut refuses a genuine D4 opt-out (evidence, history or staff-recorded)", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  for (const row of [
    legacyRead({
      opted_out_source: "customer_message",
      opted_out_text: "退訂",
      opted_out_message_id: "x",
    }),
    legacyRead({ inbound_texts: ["你好", "STOP."] }),
    legacyRead({ inbound_texts: ["「退订」"] }),
    legacyRead({ opted_out_source: "staff_recorded", inbound_texts: [] }),
  ]) {
    const { calls, query } = fakeQuery([[row]]);
    await rejectsWith(
      clearAccidentalOptOut(clearInput(), OO_MANAGER, { query }),
      409,
      "OPT_OUT_GENUINE_USE_CONSENT",
    );
    assert.equal(calls.length, 1, "no write after a genuine refusal");
    // The history read is bounded and only looks at inbound text up to the opt-out.
    assert.match(calls[0].sql, /direction\s*=\s*'inbound'/);
    assert.match(calls[0].sql, /created_at\s*<=/);
    assert.match(calls[0].sql, /LIMIT 200/);
  }
});

test("clearAccidentalOptOut: a stale expectedOptedOutAt is 409 OPT_OUT_CHANGED with no write", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  for (const expectedOptedOutAt of [
    "2026-08-01T10:00:00.000001Z",
    "2026-08-01T09:59:59.999999Z",
    null,
  ]) {
    const { calls, query } = fakeQuery([[legacyRead()]]);
    await rejectsWith(
      clearAccidentalOptOut(clearInput({ expectedOptedOutAt }), OO_MANAGER, { query }),
      409,
      "OPT_OUT_CHANGED",
    );
    assert.equal(calls.length, 1);
  }
});

test("clearAccidentalOptOut clears with one guarded write that keeps evidence and audits a snapshot", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  const { calls, query } = fakeQuery([[legacyRead()], [{ id: OO_CONTACT }]]);
  const result = await clearAccidentalOptOut(
    clearInput({ reason: "  客戶只是回覆唔要睇呢個盤  " }),
    OO_MANAGER,
    { query },
  );
  assert.deepEqual(result, { ok: true, contactId: OO_CONTACT, cleared: true });
  assert.equal(calls.length, 2);
  const { sql, params } = calls[1];
  assert.match(sql, /UPDATE crm_contacts/);
  assert.match(sql, /opted_out_whatsapp\s*=\s*false/);
  assert.match(sql, /opted_out_cleared_at\s*=\s*now\(\)/);
  assert.match(sql, /opted_out_cleared_by\s*=\s*\$2/);
  assert.match(sql, /AND c\.opted_out_whatsapp\b/);
  assert.match(sql, /s\.active/);
  assert.match(sql, /'contact\.whatsapp_opt_out_cleared'/);
  for (const key of ["reason", "optedOutAt", "optedOutMessageId", "optedOutText", "optedOutSource"])
    assert.match(sql, new RegExp(`'${key}'`));
  assert.match(sql, /left\(\s*opted_out_text\s*,\s*200\s*\)/);
  // Evidence and marketing consent are never written.
  assert.doesNotMatch(sql, /opt_in_whatsapp/);
  const set = sql.slice(sql.indexOf(" SET "), sql.indexOf(" WHERE "));
  assert.doesNotMatch(set, /opted_out_(at|message_id|text|source)\s*=/);
  assert.equal(params[0], OO_CONTACT);
  assert.equal(params[1], OO_MANAGER.staffId);
  assert.equal(params[2], OO_VERSION);
  assert.match(
    sql,
    /to_char\(c\.opted_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) IS NOT DISTINCT FROM \$3::text/,
  );
  assert.equal(params[3], "客戶只是回覆唔要睇呢個盤");
});

test("clearAccidentalOptOut is idempotent and a lost race is OPT_OUT_CHANGED", async () => {
  const { clearAccidentalOptOut } = await import("./whatsapp-opt-out.server.ts");
  const replay = fakeQuery([
    [legacyRead({ opted_out_whatsapp: false, opted_out_cleared_at: new Date() })],
  ]);
  assert.deepEqual(await clearAccidentalOptOut(clearInput(), OO_MANAGER, { query: replay.query }), {
    ok: true,
    contactId: OO_CONTACT,
    cleared: false,
  });
  assert.equal(replay.calls.length, 1, "a replay never writes");
  const race = fakeQuery([[legacyRead()], []]);
  await rejectsWith(
    clearAccidentalOptOut(clearInput(), OO_MANAGER, { query: race.query }),
    409,
    "OPT_OUT_CHANGED",
  );
});

test("readOptOutNearMiss derives the newest flagged inbound after the three cut-offs and never writes", async () => {
  const { readOptOutNearMiss } = await import("./whatsapp-opt-out-near-miss.server.ts");
  const at = (s) => new Date(`2026-10-06T10:00:${s}.000Z`);
  const { calls, query } = fakeQuery([
    [
      { id: "m4", text: "Can I stop by?", created_at: at("04") },
      { id: "m3", text: "退訂", created_at: at("03") },
      { id: "m2", text: "STOP please", created_at: at("02") },
      { id: "m1", text: "我要退訂", created_at: at("01") },
    ],
    [{ id: "m5", text: "你好", created_at: at("05") }],
  ]);
  const input = { conversationId: OO_CONV, contactId: OO_CONTACT };
  assert.deepEqual(await readOptOutNearMiss(input, { query }), {
    messageId: "m2",
    text: "STOP please",
    at: at("02").toISOString(),
  });
  assert.equal(await readOptOutNearMiss(input, { query }), null);
  const { sql, params } = calls[0];
  assert.deepEqual(params, [OO_CONV, OO_CONTACT]);
  assert.match(sql, /^\s*WITH cut AS/);
  assert.match(sql, /crm_consent_events WHERE contact_id\s*=\s*\$2/);
  assert.match(sql, /contact\.whatsapp_opt_out_near_miss_dismissed/);
  assert.match(sql, /\(metadata->>'messageAt'\)::timestamptz/);
  assert.match(sql, /CASE WHEN opted_out_whatsapp THEN opted_out_at END/);
  assert.match(sql, /now\(\) - interval '30 days'/);
  assert.match(
    sql,
    /conversation_id\s*=\s*\$1::uuid AND contact_id\s*=\s*\$2::uuid AND direction\s*=\s*'inbound'/,
  );
  assert.match(sql, /created_at > cut\.t/);
  assert.match(sql, /LIMIT 50/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\b/);
  await assert.rejects(
    readOptOutNearMiss({ conversationId: "x", contactId: OO_CONTACT }, { query }),
  );
});

const dismissInput = (patch = {}) => ({
  conversationId: OO_CONV,
  contactId: OO_CONTACT,
  messageId: OO_MSG,
  ...patch,
});

test("dismissOptOutNearMiss: approval gate, validation and wrong-recipient guard", async () => {
  const { dismissOptOutNearMiss } = await import("./whatsapp-opt-out-near-miss.server.ts");
  for (const roles of [["agent"], ["viewer"], []]) {
    const { calls, query } = fakeQuery([]);
    await rejectsWith(
      dismissOptOutNearMiss(dismissInput(), { staffId: OO_MANAGER.staffId, roles }, { query }),
      403,
    );
    assert.equal(calls.length, 0);
  }
  for (const input of [
    dismissInput({ messageId: "nope" }),
    dismissInput({ reason: "x".repeat(201) }),
    dismissInput({ extra: 1 }),
  ]) {
    const { calls, query } = fakeQuery([]);
    await rejectsWith(dismissOptOutNearMiss(input, OO_MANAGER, { query }), 400);
    assert.equal(calls.length, 0);
  }
  const inactive = fakeQuery([[{ actor_ok: false, message_ok: false, text: null }]]);
  await rejectsWith(
    dismissOptOutNearMiss(dismissInput(), OO_MANAGER, { query: inactive.query }),
    403,
  );
  const foreign = fakeQuery([[{ actor_ok: true, message_ok: false, text: null }]]);
  await rejectsWith(
    dismissOptOutNearMiss(dismissInput(), OO_MANAGER, { query: foreign.query }),
    404,
  );
  // Only a real near-miss can be dismissed: an ordinary message or an exact opt-out is refused
  // before any write.
  for (const text of ["你好", "Can I stop by?", "退訂", null]) {
    const ordinary = fakeQuery([[{ actor_ok: true, message_ok: true, text }]]);
    await rejectsWith(
      dismissOptOutNearMiss(dismissInput(), OO_MANAGER, { query: ordinary.query }),
      404,
      "NEAR_MISS_MESSAGE_NOT_FOUND",
    );
    assert.equal(ordinary.calls.length, 1, "no write for a message that is not a near-miss");
  }
});

test("dismissOptOutNearMiss writes one idempotent audit row and never touches crm_contacts", async () => {
  const { dismissOptOutNearMiss } = await import("./whatsapp-opt-out-near-miss.server.ts");
  const { calls, query } = fakeQuery([
    [{ actor_ok: true, message_ok: true, text: "STOP please" }],
    [{ actor_ok: true, message_ok: true, dismissed: true }],
    [{ actor_ok: true, message_ok: true, text: "STOP please" }],
    [{ actor_ok: true, message_ok: true, dismissed: false }],
  ]);
  assert.deepEqual(
    await dismissOptOutNearMiss(
      dismissInput({ reason: " 客戶只是問可唔可以停一停先 " }),
      OO_MANAGER,
      { query },
    ),
    { ok: true, dismissed: true },
  );
  assert.deepEqual(await dismissOptOutNearMiss(dismissInput(), OO_MANAGER, { query }), {
    ok: true,
    dismissed: false,
  });
  assert.doesNotMatch(calls[0].sql, /(UPDATE|INSERT|DELETE)/i, "the first statement only reads");
  const { sql, params } = calls[1];
  assert.deepEqual(params, [
    OO_CONV,
    OO_CONTACT,
    OO_MSG,
    OO_MANAGER.staffId,
    "客戶只是問可唔可以停一停先",
  ]);
  assert.equal(calls[3].params[4], null);
  assert.doesNotMatch(sql, /\bUPDATE\b/i);
  assert.match(sql, /INSERT INTO audit_logs/);
  assert.match(sql, /'contact\.whatsapp_opt_out_near_miss_dismissed'/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /m\.conversation_id\s*=\s*\$1::uuid/);
  assert.match(sql, /m\.contact_id\s*=\s*\$2::uuid/);
  assert.match(sql, /m\.direction\s*=\s*'inbound'/);
  assert.match(sql, /wa_can_read_conversation/);
  assert.match(sql, /'messageAt',\s*m\.created_at/);
  assert.match(sql, /left\(\s*m\.text\s*,\s*200\s*\)/);
});
