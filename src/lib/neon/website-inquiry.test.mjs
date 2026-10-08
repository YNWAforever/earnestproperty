import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./website-inquiry.js", import.meta.url);

function assertInsertUsesRoutingIntent(sql, table) {
  const match = sql.match(
    new RegExp(
      `INSERT INTO ${table}\\s*\\(([^)]*)\\)\\s*SELECT\\s*([\\s\\S]*?)\\s+FROM\\s+contact\\b`,
      "i",
    ),
  );
  assert.ok(match, `${table} insert must select from the atomic contact CTE`);

  const columns = match[1].split(",").map((value) => value.trim());
  const values = match[2].split(",").map((value) => value.trim());
  const intentIndex = columns.indexOf("intent");

  assert.notEqual(intentIndex, -1, `${table}.intent must be part of the atomic insert`);
  assert.equal(
    values[intentIndex],
    "routing.intent",
    `${table}.intent must use the server-derived routing intent`,
  );
}

test("active rental listings assign only active staff and derive renter intent", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry routing helper must exist");
  const { deriveWebsiteInquiryRouting } = await import(moduleUrl);

  assert.deepEqual(
    deriveWebsiteInquiryRouting({
      id: "property-rent",
      dealType: "rent",
      agentId: "agent-active",
      agentActive: true,
    }),
    {
      propertyId: "property-rent",
      assignedAgentId: "agent-active",
      intent: "renter",
    },
  );
});

test("inactive or missing staff never receive an automatic assignment", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry routing helper must exist");
  const { deriveWebsiteInquiryRouting } = await import(moduleUrl);

  assert.deepEqual(
    deriveWebsiteInquiryRouting({
      id: "property-sale",
      dealType: "sale",
      agentId: "agent-inactive",
      agentActive: false,
    }),
    {
      propertyId: "property-sale",
      assignedAgentId: null,
      intent: "buyer",
    },
  );
  assert.deepEqual(
    deriveWebsiteInquiryRouting({
      id: "property-sale",
      dealType: "sale",
      agentId: null,
      agentActive: false,
    }),
    {
      propertyId: "property-sale",
      assignedAgentId: null,
      intent: "buyer",
    },
  );
});

test("unresolved listings remain unassigned and do not retain a caller property id", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry routing helper must exist");
  const { deriveWebsiteInquiryRouting } = await import(moduleUrl);

  assert.deepEqual(deriveWebsiteInquiryRouting(null), {
    propertyId: null,
    assignedAgentId: null,
    intent: "buyer",
  });
});

test("website inquiry persistence resolves assignment and writes through one atomic query", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry helper must exist");
  const { persistWebsiteInquiry } = await import(moduleUrl);
  assert.equal(
    typeof persistWebsiteInquiry,
    "function",
    "atomic website inquiry persistence helper must exist",
  );

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "inquiry-1" }];
  };

  const result = await persistWebsiteInquiry(query, {
    name: "陳先生",
    phone: "9123 4567",
    normalizedPhone: "85291234567",
    email: "buyer@example.com",
    message: "想睇樓",
    listingNo: "B059390",
    propertyId: "11111111-1111-4111-8111-111111111111",
    consentWhatsapp: true,
    agent_id: "caller-agent",
    assigned_agent_id: "caller-assigned-agent",
  });

  assert.deepEqual(result, { id: "inquiry-1", leadAlertQueued: false });
  assert.equal(calls.length, 1, "resolution and all writes must share one query call");
  assert.match(calls[0].sql, /WITH[\s\S]*resolved_listing/i);
  assert.match(calls[0].sql, /p\.status = 'active'/);
  assert.match(calls[0].sql, /s\.active = true/);
  assert.match(calls[0].sql, /INSERT INTO crm_contacts/);
  assertInsertUsesRoutingIntent(calls[0].sql, "crm_leads");
  assertInsertUsesRoutingIntent(calls[0].sql, "inquiries");
  assert.equal(calls[0].params.includes("caller-agent"), false);
  assert.equal(calls[0].params.includes("caller-assigned-agent"), false);
});

test("website inquiry enqueues its lead alert in the same statement", async () => {
  const { persistWebsiteInquiry } = await import(moduleUrl);
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "inquiry-1", lead_alert_queued: true }];
  };
  const result = await persistWebsiteInquiry(query, {
    name: "陳先生",
    phone: "9123 4567",
    normalizedPhone: "85291234567",
    email: null,
    message: null,
    listingNo: null,
    propertyId: null,
    consentWhatsapp: false,
  });
  assert.deepEqual(result, { id: "inquiry-1", leadAlertQueued: true });
  assert.equal(calls.length, 1, "the alert job must not need a second statement");
  const sql = calls[0].sql;
  assert.match(sql, /lead_alert AS \(\s*INSERT INTO ops_jobs/);
  assert.ok(
    sql.indexOf("'lead-alert:'||id") > sql.indexOf("new_lead AS"),
    "the alert key is derived from the inserted lead",
  );
  assert.match(sql, /FROM new_lead\s+ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(sql, /\(SELECT count\(\*\) FROM lead_alert\) > 0 AS lead_alert_queued/);
});

test("website inquiry persistence awaits and propagates an injected query failure", async () => {
  const { persistWebsiteInquiry } = await import(moduleUrl);
  const databaseFailure = Object.assign(new Error("database unavailable"), { code: "08006" });
  let calls = 0;

  await assert.rejects(
    persistWebsiteInquiry(
      async (sql, params) => {
        calls += 1;
        assert.match(sql, /^\s*WITH resolved_listing/i);
        assert.deepEqual(params, [
          "陳先生",
          "9123 4567",
          "85291234567",
          null,
          null,
          false,
          null,
          "B059390",
          "表格的隱藏欄位有內容，可能是自動程式提交。查詢已照常保存及通知，請照常跟進。",
          false,
        ]);
        throw databaseFailure;
      },
      {
        name: "陳先生",
        phone: "9123 4567",
        normalizedPhone: "85291234567",
        email: null,
        message: null,
        listingNo: "B059390",
        propertyId: null,
        consentWhatsapp: false,
      },
    ),
    (error) => error === databaseFailure,
  );
  assert.equal(calls, 1);
});

test("listing number validation accepts bounded property references but property ids stay UUIDs", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry helper must exist");
  const { isValidWebsiteListingNo } = await import(moduleUrl);
  assert.equal(typeof isValidWebsiteListingNo, "function", "listing number validator must exist");

  for (const listingNo of ["B059390", "6709182", "AB-12345"]) {
    assert.equal(isValidWebsiteListingNo(listingNo), true, `${listingNo} should be valid`);
  }
  for (const listingNo of ["", " B059390", "B059390 ", "AB/123", "AB 123", "A".repeat(41)]) {
    assert.equal(isValidWebsiteListingNo(listingNo), false, `${listingNo} should be invalid`);
  }
});

// This endpoint is unauthenticated. Before this was locked down, the upsert ran
// `opt_in_whatsapp = crm_contacts.opt_in_whatsapp OR EXCLUDED.opt_in_whatsapp`,
// so anyone who knew a phone number already in the CRM could forge WhatsApp
// marketing consent for it -- and a forged opt-in flows straight into real blast
// delivery. Name/email had the same shape via COALESCE(EXCLUDED, existing),
// letting a stranger rewrite a customer's record.
test("public inquiry upsert can never raise consent or overwrite an existing contact", async () => {
  const { persistWebsiteInquiry } = await import(moduleUrl);

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "inquiry-1" }];
  };

  await persistWebsiteInquiry(query, {
    name: "攻擊者",
    phone: "9123 4567",
    normalizedPhone: "85291234567",
    email: "attacker@example.com",
    message: "hi",
    listingNo: "B059390",
    propertyId: null,
    consentWhatsapp: true,
  });

  const { sql } = calls[0];
  const conflictClause = sql.slice(sql.indexOf("ON CONFLICT (normalized_phone)"));

  // Consent is carried over untouched -- never OR'd, never taken from EXCLUDED.
  assert.match(conflictClause, /opt_in_whatsapp\s*=\s*crm_contacts\.opt_in_whatsapp\s*,/);
  assert.doesNotMatch(conflictClause, /opt_in_whatsapp\s*=[^,]*EXCLUDED/);
  assert.doesNotMatch(conflictClause, /opt_in_whatsapp\s*=[^,]*\bOR\b/);

  // Existing identity fields win; EXCLUDED may only fill a NULL.
  assert.match(conflictClause, /name\s*=\s*COALESCE\(crm_contacts\.name,\s*EXCLUDED\.name\)/);
  assert.match(conflictClause, /email\s*=\s*COALESCE\(crm_contacts\.email,\s*EXCLUDED\.email\)/);
  assert.doesNotMatch(conflictClause, /COALESCE\(EXCLUDED\./);

  // The submitted consent flag still reaches the INSERT, so a brand-new contact
  // who ticks the box is opted in on first write.
  assert.equal(calls[0].params[5], true);
});

// Each CTE clause of live-agent.server.ts that starts with `<name> AS (` (the name must not be a
// suffix of a longer identifier), up to the start of its RETURNING. CRLF-tolerant: only \s is used.
function liveAgentCteClauses(source, name) {
  const pattern = new RegExp(`(?<![\\w])${name}\\s+AS\\s+\\(([\\s\\S]*?)\\bRETURNING\\b`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

const readLiveAgentSource = () =>
  readFileSync(new URL("../ai/live-agent.server.ts", import.meta.url), "utf8");

test("live-agent contact insert never rewrites an existing contact on conflict", () => {
  const clauses = liveAgentCteClauses(readLiveAgentSource(), "inserted_contact");

  // One in the handoff, one in the phone correction.
  assert.equal(clauses.length, 2);
  for (const clause of clauses) {
    assert.match(clause, /'live_agent'/);
    // The self-assignment only makes RETURNING yield the conflicting row; it changes no column.
    assert.match(
      clause,
      /ON\s+CONFLICT\s*\(\s*normalized_phone\s*\)\s+DO\s+UPDATE\s+SET\s+opt_in_whatsapp\s*=\s*crm_contacts\.opt_in_whatsapp\s*$/,
    );
    assert.doesNotMatch(clause, /EXCLUDED/);
    assert.doesNotMatch(clause, /\b(name|phone|email|updated_at)\s*=/);
  }
});

test("live-agent never writes a matched or pre-existing contact", () => {
  const source = readLiveAgentSource();

  assert.doesNotMatch(source, /updated_contact\s+AS\s+\(/);
  assert.match(source, /matched_contact\s+AS\s+\(\s*SELECT\s+id\s+FROM\s+candidate_contact\s*\)/);
  assert.equal((source.match(/UPDATE\s+crm_contacts\b/g) ?? []).length, 1);

  // The one contact UPDATE is the phone correction of a contact this handoff created.
  const updated = liveAgentCteClauses(source, "updated_owned");
  assert.equal(updated.length, 1);
  const [updateClause] = updated;
  const setList = updateClause.match(/\bSET\s+([\s\S]*?)\s+FROM\b/);
  assert.ok(setList, "updated_owned must be an UPDATE … SET … FROM");
  assert.deepEqual(
    setList[1]
      .split(",")
      .map((assignment) => assignment.split("=")[0].trim())
      .sort(),
    ["normalized_phone", "phone", "updated_at"],
  );
  assert.match(updateClause, /\bFROM\s+owned\b/);
  assert.match(updateClause, /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+existing_for_new\s*\)/);
  assert.doesNotMatch(updateClause, /\b(name|email|opt_in_whatsapp|whatsapp_member_id)\s*=/);

  const owned = source.match(/(?<![\w])owned\s+AS\s+\(([\s\S]*?)\),\s+existing_for_new\s+AS\b/);
  assert.ok(owned, "owned must be defined before existing_for_new");
  assert.match(owned[1], /metadata->>'contactCreated'\s*=\s*'true'/);
  assert.match(owned[1], /metadata->>'contactId'\s*=\s*c\.id::text/);
  assert.match(owned[1], /whatsapp_member_id\s+IS\s+NULL/);
});

// The behaviour needs two real connections (live-agent.handoff.local-db.test.mjs, opt-in); this
// keeps the predicates from silently disappearing in CI.
test("live-agent phone correction that changes nothing writes no contact update, note or audit", () => {
  const source = readLiveAgentSource();
  const changed =
    /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+updated_owned\s*\)\s+OR\s+r\.id\s+IS\s+DISTINCT\s+FROM\s+t\.contact_id/;

  const [updateClause] = liveAgentCteClauses(source, "updated_owned");
  assert.match(updateClause, /c\.normalized_phone\s+IS\s+DISTINCT\s+FROM\s+\$5::text/);
  const [noteClause] = liveAgentCteClauses(source, "possible_note");
  assert.match(noteClause, changed);
  const [auditClause] = liveAgentCteClauses(source, "correction_audit");
  assert.match(auditClause, changed);
});

test("website inquiry SQL resolves active listings and active staff before inserting", () => {
  const source = readFileSync(new URL("./admin-data.server.ts", import.meta.url), "utf8");
  const inquiryStart = source.indexOf("export async function createWebsiteInquiry");
  const inquiryEnd = source.indexOf("export async function updateInquiryStatus", inquiryStart);
  const inquirySource = source.slice(inquiryStart, inquiryEnd);

  assert.notEqual(inquiryStart, -1);
  assert.notEqual(inquiryEnd, -1);
  assert.match(inquirySource, /persistWebsiteInquiry/);
  assert.equal((inquirySource.match(/queryRows/g) ?? []).length, 1);
});

const flaggedIntake = (overrides = {}) => ({
  submissionId: "11111111-1111-4111-8111-111111111111",
  name: "陳先生",
  phone: "9123 4567",
  normalizedPhone: "85291234567",
  email: null,
  message: "想睇樓",
  listingNo: null,
  propertyId: null,
  consentWhatsapp: false,
  ...overrides,
});

test("a flagged website inquiry still writes contact, lead, inquiry and alert job in one statement", async () => {
  const { persistWebsiteInquiry } = await import(moduleUrl);
  for (const submissionId of ["11111111-1111-4111-8111-111111111111", undefined]) {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      return [{ id: "inquiry-1", lead_alert_queued: true }];
    };
    const result = await persistWebsiteInquiry(
      query,
      flaggedIntake({ submissionId, suspectedBot: true }),
    );
    assert.deepEqual(result, { id: "inquiry-1", leadAlertQueued: true });
    assert.equal(calls.length, 1, "the flag must not need a second statement");
    const { sql, params } = calls[0];
    for (const fragment of [
      "INSERT INTO crm_contacts",
      "INSERT INTO crm_leads",
      "lead_alert AS (",
      "INSERT INTO inquiries",
      "INSERT INTO crm_activities",
      "'suspected_bot'",
      "INSERT INTO audit_logs",
      "'public_form.suspected_bot'",
    ]) {
      assert.ok(sql.includes(fragment), `${fragment} (submissionId=${submissionId})`);
    }
    assert.equal(params.at(-1), true, "the flag is the last parameter");
    const flag = `$${params.length}::boolean`;
    assert.ok(sql.includes(`WHERE ${flag}`), `the flag gates the bot rows via ${flag}`);
    // The note body is a server constant, also parameterized; never caller text.
    const body = "表格的隱藏欄位有內容，可能是自動程式提交。查詢已照常保存及通知，請照常跟進。";
    assert.equal(params.at(-2), body);
    assert.equal(sql.includes(body), false, "the note body is a parameter, not SQL text");
    // The bot rows hang off the lead and never gate the lead, inquiry or alert job.
    assert.ok(sql.indexOf("bot_note AS (") > sql.indexOf("new_lead AS ("));
    assert.ok(sql.indexOf("bot_audit AS (") > sql.indexOf("new_lead AS ("));
    assert.doesNotMatch(sql, /FROM\s+bot_(note|audit)/);
    assert.match(sql, /\(SELECT count\(\*\) FROM lead_alert\) > 0 AS lead_alert_queued/);
  }
});

test("an unflagged inquiry passes false and the hash ignores the flag", async () => {
  const { persistWebsiteInquiry } = await import(moduleUrl);
  const run = async (input) => {
    const calls = [];
    await persistWebsiteInquiry(async (sql, params) => {
      calls.push({ sql, params });
      return [{ id: "inquiry-1" }];
    }, input);
    return calls[0];
  };
  const unflagged = await run(flaggedIntake());
  assert.equal(unflagged.params.at(-1), false);
  const explicitFalse = await run(flaggedIntake({ suspectedBot: false }));
  const flagged = await run(flaggedIntake({ suspectedBot: true }));
  // $10 is the payload hash: identical whatever the flag, so a replay during deploy never conflicts.
  assert.equal(unflagged.params[9], flagged.params[9]);
  assert.equal(explicitFalse.params[9], flagged.params[9]);
  assert.match(unflagged.params[9], /^[0-9a-f]{64}$/);
  // Only the flag differs; every other parameter is identical.
  assert.deepEqual(unflagged.params.slice(0, -1), flagged.params.slice(0, -1));
  assert.equal(unflagged.sql, flagged.sql, "the statement shape does not depend on the flag");
  // A truthy non-boolean is not a flag: only the server's own boolean counts.
  const truthy = await run(flaggedIntake({ suspectedBot: "yes" }));
  assert.equal(truthy.params.at(-1), false);
});

const adminDataSource = () =>
  readFileSync(new URL("./admin-data.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const PUBLIC_FORMS = [
  ["websiteInquirySchema", "const createWebsiteInquiryServer", "createWebsiteInquiry"],
  ["listingAlertSchema", "export const createListingAlert", "createListingAlert"],
  ["valuationLeadSchema", "export const createValuationLead", "createValuationLead"],
];

test("an oversized or non-string honeypot never fails validation", async () => {
  const source = adminDataSource();
  for (const [schema] of PUBLIC_FORMS) {
    const start = source.indexOf(`const ${schema} = z`);
    assert.notEqual(start, -1, schema);
    const body = source.slice(start, source.indexOf(".strip();", start));
    assert.match(body, /\n\s+website: z\.unknown\(\)\.optional\(\),\n\s+\}\)/, schema);
  }
  // The same shape, exercised: any type and any length parses.
  const { z } = await import("zod");
  const shape = z.object({ name: z.string(), website: z.unknown().optional() }).strip();
  for (const website of [undefined, null, "", 123, { a: 1 }, ["x"], "a".repeat(10_000)]) {
    assert.equal(shape.safeParse({ name: "陳先生", website }).success, true);
  }
});

test("each handler derives suspectedBot after the rate limits and never returns early", () => {
  const source = adminDataSource();
  for (const [, start, server] of PUBLIC_FORMS) {
    const begin = source.indexOf(start);
    assert.notEqual(begin, -1, start);
    const end = source.indexOf("\n  });\n", begin);
    const handler = source.slice(begin, end);
    const detect = handler.indexOf("isHoneypotFilled(");
    assert.ok(detect > handler.lastIndexOf("enforceRateLimit("), `${server}: after the limits`);
    assert.match(
      handler,
      /const \{ website, \.\.\.fields \} = data;\n\s+const suspectedBot = isHoneypotFilled\(website\);/,
    );
    const call = handler.indexOf(`return adminData.${server}({ ...fields, suspectedBot });`);
    assert.ok(call > detect, `${server}: the flag is passed to the persist call`);
    const between = handler.slice(detect, call);
    assert.doesNotMatch(between, /\breturn\b|\bthrow\b/, `${server}: no early exit`);
  }
});
