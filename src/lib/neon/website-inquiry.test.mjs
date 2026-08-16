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

  assert.deepEqual(result, { id: "inquiry-1" });
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

test("live-agent contact upsert also refuses to overwrite an existing contact", () => {
  const source = readFileSync(new URL("../ai/live-agent.server.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function upsertLiveAgentContact");
  const clause = source.slice(start, source.indexOf("RETURNING id", start));

  assert.notEqual(start, -1);
  assert.match(clause, /name\s*=\s*COALESCE\(crm_contacts\.name,\s*EXCLUDED\.name\)/);
  assert.match(clause, /phone\s*=\s*COALESCE\(crm_contacts\.phone,\s*EXCLUDED\.phone\)/);
  assert.match(clause, /email\s*=\s*COALESCE\(crm_contacts\.email,\s*EXCLUDED\.email\)/);
  assert.doesNotMatch(clause, /opt_in_whatsapp\s*=[^,]*EXCLUDED/);
});

// updateLiveAgentContact is the path an attacker actually reaches. The first
// unauthenticated handoff carrying a victim's phone hits the upsert's ON
// CONFLICT -- which preserves the victim's fields -- but returns the victim's
// contact id, and that id is bound to the session. A SECOND handoff on the same
// session lands here with contact_id set, so caller-wins COALESCE would rewrite
// the victim's name/phone/email in place while normalized_phone still points
// the row at them. Asserting only on upsertLiveAgentContact missed this
// entirely: the two functions must agree.
test("live-agent contact UPDATE path is existing-wins too, not just the upsert", () => {
  const source = readFileSync(new URL("../ai/live-agent.server.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function updateLiveAgentContact");
  const clause = source.slice(start, source.indexOf("RETURNING id", start));

  assert.notEqual(start, -1, "updateLiveAgentContact must exist");
  assert.match(clause, /name\s*=\s*COALESCE\(name,\s*\$1\)/);
  assert.match(clause, /phone\s*=\s*COALESCE\(phone,\s*\$2\)/);
  assert.match(clause, /email\s*=\s*COALESCE\(email,\s*\$3\)/);

  // The caller-wins form that made the hijack possible.
  assert.doesNotMatch(clause, /name\s*=\s*COALESCE\(\$1,\s*name\)/);
  assert.doesNotMatch(clause, /phone\s*=\s*COALESCE\(\$2,\s*phone\)/);
  assert.doesNotMatch(clause, /email\s*=\s*COALESCE\(\$3,\s*email\)/);
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
