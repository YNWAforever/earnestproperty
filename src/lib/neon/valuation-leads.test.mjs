import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./valuation-leads.js", import.meta.url);

test("valuation_leads consent copy and version are non-empty, exported constants", async () => {
  assert.equal(existsSync(moduleUrl), true, "valuation-leads helper must exist");
  const { VALUATION_CONSENT_TEXT, VALUATION_CONSENT_VERSION } = await import(moduleUrl);

  assert.equal(typeof VALUATION_CONSENT_TEXT, "string");
  assert.ok(VALUATION_CONSENT_TEXT.length > 10, "consent copy must be real, specific text");
  // Says WHAT the user is consenting to (being contacted about the
  // valuation request) and HOW (phone/WhatsApp) -- not a generic "I agree
  // to be contacted" placeholder.
  assert.match(VALUATION_CONSENT_TEXT, /聯絡|通知/);
  assert.match(VALUATION_CONSENT_TEXT, /WhatsApp|電話/);

  assert.equal(typeof VALUATION_CONSENT_VERSION, "string");
  assert.ok(VALUATION_CONSENT_VERSION.length > 0);
});

test("persistValuationLead writes through one atomic, parameterized INSERT", async () => {
  const { persistValuationLead, VALUATION_CONSENT_TEXT, VALUATION_CONSENT_VERSION } = await import(
    moduleUrl
  );
  assert.equal(typeof persistValuationLead, "function");

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "valuation-1" }];
  };

  const consentedAt = new Date().toISOString();
  const result = await persistValuationLead(query, {
    name: "陳先生",
    phone: "9123 4567",
    email: "owner@example.com",
    propertyAddress: "深井卓爾居 1座 5樓A室",
    estateId: "11111111-1111-1111-1111-111111111111",
    notes: "實用面積約 500 呎，中層",
    consentText: VALUATION_CONSENT_TEXT,
    consentVersion: VALUATION_CONSENT_VERSION,
    consentedAt,
    utm: { utm_source: "google" },
  });

  assert.deepEqual(result, { id: "valuation-1" });
  assert.equal(calls.length, 1, "persistence must happen in a single query call");

  const { sql, params } = calls[0];
  assert.match(sql, /INSERT INTO valuation_leads/);
  assert.match(sql, /RETURNING id/);

  // Every value in the VALUES list must be a positional placeholder -- no
  // string interpolation of caller-supplied input anywhere in the SQL text.
  const valuesClause = sql.slice(sql.indexOf("VALUES"), sql.indexOf("RETURNING"));
  assert.doesNotMatch(valuesClause, /\$\{/, "SQL must not string-interpolate any value");
  assert.match(valuesClause, /\(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10::jsonb\)/);

  // Consent fields are required and actually persisted, not silently
  // dropped -- confirm both the text and version came from what was passed
  // in (the caller's constants), and consented_at is present.
  assert.deepEqual(params, [
    "陳先生",
    "9123 4567",
    "owner@example.com",
    "深井卓爾居 1座 5樓A室",
    "11111111-1111-1111-1111-111111111111",
    "實用面積約 500 呎，中層",
    VALUATION_CONSENT_TEXT,
    VALUATION_CONSENT_VERSION,
    consentedAt,
    JSON.stringify({ utm_source: "google" }),
  ]);
});

test("persistValuationLead defaults optional fields to null/empty rather than throwing on undefined", async () => {
  const { persistValuationLead } = await import(moduleUrl);

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "valuation-2" }];
  };

  await persistValuationLead(query, {
    name: "陳小姐",
    phone: "6822 7287",
    email: null,
    propertyAddress: "深井某屋苑",
    estateId: undefined,
    notes: undefined,
    consentText: "text",
    consentVersion: "1",
    consentedAt: "2026-08-30T00:00:00.000Z",
    utm: undefined,
  });

  const { params } = calls[0];
  assert.equal(params[2], null, "email should default to null, not throw");
  assert.equal(params[4], null, "estateId should default to null when unset");
  assert.equal(params[5], null, "notes should default to null when unset");
  assert.equal(params[9], "{}", "utm should default to an empty object, not throw on undefined");
});

test("persistValuationLead awaits and propagates an injected query failure", async () => {
  const { persistValuationLead } = await import(moduleUrl);
  const databaseFailure = Object.assign(new Error("database unavailable"), { code: "08006" });
  let calls = 0;

  await assert.rejects(
    persistValuationLead(
      async () => {
        calls += 1;
        throw databaseFailure;
      },
      {
        name: "陳先生",
        phone: "9123 4567",
        email: null,
        propertyAddress: "深井某屋苑",
        estateId: null,
        notes: null,
        consentText: "text",
        consentVersion: "1",
        consentedAt: "2026-08-30T00:00:00.000Z",
        utm: {},
      },
    ),
    (error) => error === databaseFailure,
  );
  assert.equal(calls, 1);
});

test("createValuationLead delegates to persistValuationLead with the server's own consent constants, through one queryRows call", () => {
  const source = readFileSync(new URL("./admin-data.server.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function createValuationLead");
  assert.notEqual(start, -1, "createValuationLead must exist in admin-data.server.ts");
  const end = source.indexOf("\n}\n", start);
  const fnSource = source.slice(start, end);

  assert.match(fnSource, /persistValuationLead/);
  assert.equal((fnSource.match(/queryRows/g) ?? []).length, 1);
  // Consent text/version must come from the module's own constants, never
  // from `input` (which is caller-controlled, unauthenticated data). Also
  // guard against the exact hostile-input shape this plan calls out: a
  // client payload that also tries to forge consentText/consentedAt.
  assert.match(fnSource, /consentText:\s*VALUATION_CONSENT_TEXT/);
  assert.match(fnSource, /consentVersion:\s*VALUATION_CONSENT_VERSION/);
  assert.match(fnSource, /consentedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(fnSource, /consentText:\s*input\./);
  assert.doesNotMatch(fnSource, /consentVersion:\s*input\./);
  assert.doesNotMatch(fnSource, /consentedAt:\s*input\./);
});

test("createValuationLead's public server fn requires consent === true, strips forged consent fields, and is rate-limited like createListingAlert", () => {
  const source = readFileSync(new URL("./admin-data.ts", import.meta.url), "utf8");

  const schemaStart = source.indexOf("const valuationLeadSchema");
  assert.notEqual(schemaStart, -1, "valuationLeadSchema must exist in admin-data.ts");
  const schemaEnd = source.indexOf(".strip();", schemaStart);
  const schemaSource = source.slice(schemaStart, schemaEnd);
  assert.match(schemaSource, /consent:\s*z\.literal\(true\)/);
  // The schema must not itself declare consentText/consentVersion/consentedAt
  // fields -- if it did, .strip() wouldn't remove them and a hostile client
  // payload forging those fields could flow straight through to the server
  // fn's `data` and on into createValuationLead's input.
  assert.doesNotMatch(schemaSource, /consentText:/);
  assert.doesNotMatch(schemaSource, /consentVersion:/);
  assert.doesNotMatch(schemaSource, /consentedAt:/);

  const fnStart = source.indexOf("export const createValuationLead");
  assert.notEqual(fnStart, -1, "createValuationLead server fn must exist in admin-data.ts");
  const fnEnd = source.indexOf("const updateAdminInquiryStatusServer", fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  assert.match(fnSource, /enforceRateLimit/);
  assert.match(fnSource, /clientIpFromRequest/);
  assert.match(fnSource, /adminData\.createValuationLead\(data\)/);
});

// This is the exact hostile-input scenario the plan calls out: a client
// submits consent: true (so it clears the z.literal(true) gate) alongside
// forged consentText/consentedAt values, attempting to make the persisted
// row claim a different consent wording or timestamp than what the server
// actually recorded. Proven two ways: (1) the real schema in admin-data.ts
// does not declare consentText/consentVersion/consentedAt as fields at all
// (asserted above), so Zod's `.strip()` drops them from any parsed payload
// regardless of what a hostile client attaches; (2) this test re-derives a
// schema with the exact same field set/constraints the source shows and
// proves `.strip()` actually behaves that way against the literal hostile
// payload the plan describes, rather than just asserting Zod's documented
// behaviour by reputation.
test("hostile client payload forging consentText/consentedAt is stripped before it could ever reach createValuationLead", async () => {
  const { z } = await import("zod");
  const valuationLeadSchemaShape = z
    .object({
      name: z.string().trim().min(1).max(120),
      phone: z
        .string()
        .trim()
        .min(8)
        .max(30)
        .regex(/^[\d+\-\s()]+$/),
      propertyAddress: z.string().trim().min(1).max(300),
      consent: z.literal(true),
    })
    .strip();

  const hostilePayload = {
    name: "陳先生",
    phone: "9123 4567",
    propertyAddress: "深井卓爾居",
    consent: true,
    // Forged fields a hostile client might attach, hoping they pass straight
    // through to the persisted row.
    consentText: "fake",
    consentedAt: "2020-01-01T00:00:00.000Z",
  };

  const parsed = valuationLeadSchemaShape.parse(hostilePayload);
  assert.equal(
    Object.prototype.hasOwnProperty.call(parsed, "consentText"),
    false,
    "forged consentText must be stripped, not passed through",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(parsed, "consentedAt"),
    false,
    "forged consentedAt must be stripped, not passed through",
  );
});

test("OwnerValuationPanel's structured form starts with consent unchecked and is offered alongside the WhatsApp link", () => {
  const source = readFileSync(
    new URL("../../components/site/OwnerValuationPanel.tsx", import.meta.url),
    "utf8",
  );

  // The consent checkbox: unchecked by default, never preselected.
  assert.match(source, /const \[consent, setConsent\] = useState\(false\)/);
  assert.match(source, /id="valuation-consent"/);
  assert.match(source, /checked=\{consent\}/);
  assert.match(source, /VALUATION_CONSENT_TEXT/);

  // The structured form must sit alongside the existing WhatsApp deep-link
  // (whatsappIntentUrl("valuation", ...)), not replace it.
  assert.match(source, /whatsappIntentUrl\("valuation"/);
  assert.match(source, /createValuationLead/);

  // Submitting without consent must not call the server fn at all.
  const handlerStart = source.indexOf("async function handleSubmit");
  assert.notEqual(handlerStart, -1);
  const handlerBody = source.slice(handlerStart, source.indexOf("\n  }\n", handlerStart));
  const consentGuardIndex = handlerBody.indexOf("if (!consent)");
  const createCallIndex = handlerBody.indexOf("createValuationLead(");
  assert.ok(consentGuardIndex > -1 && createCallIndex > -1);
  assert.ok(
    consentGuardIndex < createCallIndex,
    "the consent check must happen before the server fn is called",
  );
});
