import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./listing-alerts.js", import.meta.url);

test("listing_alerts consent copy and version are non-empty, exported constants", async () => {
  assert.equal(existsSync(moduleUrl), true, "listing-alerts helper must exist");
  const { LISTING_ALERT_CONSENT_TEXT, LISTING_ALERT_CONSENT_VERSION } = await import(moduleUrl);

  assert.equal(typeof LISTING_ALERT_CONSENT_TEXT, "string");
  assert.ok(LISTING_ALERT_CONSENT_TEXT.length > 10, "consent copy must be real, specific text");
  // Says WHAT the user is consenting to (being notified about matching
  // listings) and HOW (phone/WhatsApp) -- not a generic "I agree to be
  // contacted" placeholder.
  assert.match(LISTING_ALERT_CONSENT_TEXT, /通知/);
  assert.match(LISTING_ALERT_CONSENT_TEXT, /WhatsApp|電話/);

  assert.equal(typeof LISTING_ALERT_CONSENT_VERSION, "string");
  assert.ok(LISTING_ALERT_CONSENT_VERSION.length > 0);
});

test("persistListingAlert writes through one atomic, parameterized INSERT", async () => {
  const { persistListingAlert, LISTING_ALERT_CONSENT_TEXT, LISTING_ALERT_CONSENT_VERSION } =
    await import(moduleUrl);
  assert.equal(typeof persistListingAlert, "function");

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "alert-1" }];
  };

  const consentedAt = new Date().toISOString();
  const result = await persistListingAlert(query, {
    name: "陳先生",
    phone: "9123 4567",
    email: "buyer@example.com",
    filters: { deal: "sale", district: "sham-tseng", page: 1 },
    consentText: LISTING_ALERT_CONSENT_TEXT,
    consentVersion: LISTING_ALERT_CONSENT_VERSION,
    consentedAt,
    utm: { utm_source: "google" },
  });

  assert.deepEqual(result, { id: "alert-1" });
  assert.equal(calls.length, 1, "persistence must happen in a single query call");

  const { sql, params } = calls[0];
  assert.match(sql, /INSERT INTO listing_alerts/);
  assert.match(sql, /RETURNING id/);

  // Every value in the VALUES list must be a positional placeholder -- no
  // string interpolation of caller-supplied input anywhere in the SQL text.
  const valuesClause = sql.slice(sql.indexOf("VALUES"), sql.indexOf("RETURNING"));
  assert.doesNotMatch(valuesClause, /\$\{/, "SQL must not string-interpolate any value");
  assert.match(valuesClause, /\(\$1::jsonb, \$2, \$3, \$4, \$5, \$6, \$7, \$8::jsonb\)/);

  // Consent fields are required and actually persisted, not silently
  // dropped -- confirm both the text and version came from what was passed
  // in (the caller's constants), and consented_at is present.
  assert.deepEqual(params, [
    JSON.stringify({ deal: "sale", district: "sham-tseng", page: 1 }),
    "陳先生",
    "9123 4567",
    "buyer@example.com",
    LISTING_ALERT_CONSENT_TEXT,
    LISTING_ALERT_CONSENT_VERSION,
    consentedAt,
    JSON.stringify({ utm_source: "google" }),
  ]);
});

test("persistListingAlert defaults filters/utm to an empty object rather than throwing on undefined", async () => {
  const { persistListingAlert } = await import(moduleUrl);

  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: "alert-2" }];
  };

  await persistListingAlert(query, {
    name: "陳小姐",
    phone: "6822 7287",
    email: null,
    filters: undefined,
    consentText: "text",
    consentVersion: "1",
    consentedAt: "2026-08-30T00:00:00.000Z",
    utm: undefined,
  });

  assert.equal(calls[0].params[0], "{}");
  assert.equal(calls[0].params[7], "{}");
});

test("persistListingAlert awaits and propagates an injected query failure", async () => {
  const { persistListingAlert } = await import(moduleUrl);
  const databaseFailure = Object.assign(new Error("database unavailable"), { code: "08006" });
  let calls = 0;

  await assert.rejects(
    persistListingAlert(
      async () => {
        calls += 1;
        throw databaseFailure;
      },
      {
        name: "陳先生",
        phone: "9123 4567",
        email: null,
        filters: {},
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

test("createListingAlert delegates to persistListingAlert with the server's own consent constants, through one queryRows call", () => {
  const source = readFileSync(new URL("./admin-data.server.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const start = source.indexOf("export async function createListingAlert");
  assert.notEqual(start, -1, "createListingAlert must exist in admin-data.server.ts");
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, "expected a bounded createListingAlert body");
  const fnSource = source.slice(start, end);

  assert.match(fnSource, /persistListingAlert/);
  assert.equal((fnSource.match(/queryRows/g) ?? []).length, 1);
  // Consent text/version must come from the module's own constants, never
  // from `input` (which is caller-controlled, unauthenticated data).
  assert.match(fnSource, /consentText:\s*LISTING_ALERT_CONSENT_TEXT/);
  assert.match(fnSource, /consentVersion:\s*LISTING_ALERT_CONSENT_VERSION/);
  assert.doesNotMatch(fnSource, /consentText:\s*input\./);
  assert.doesNotMatch(fnSource, /consentVersion:\s*input\./);
});

test("createListingAlert's public server fn requires consent === true and is rate-limited like createWebsiteInquiry", () => {
  const source = readFileSync(new URL("./admin-data.ts", import.meta.url), "utf8");

  const schemaStart = source.indexOf("const listingAlertSchema");
  assert.notEqual(schemaStart, -1, "listingAlertSchema must exist in admin-data.ts");
  const schemaEnd = source.indexOf(".strip();", schemaStart);
  const schemaSource = source.slice(schemaStart, schemaEnd);
  assert.match(schemaSource, /consent:\s*z\.literal\(true\)/);

  const fnStart = source.indexOf("export const createListingAlert");
  assert.notEqual(fnStart, -1, "createListingAlert server fn must exist in admin-data.ts");
  const fnEnd = source.indexOf("const updateAdminInquiryStatusServer", fnStart);
  const fnSource = source.slice(fnStart, fnEnd);

  assert.match(fnSource, /enforceRateLimit/);
  assert.match(fnSource, /clientIpFromRequest/);
  assert.match(fnSource, /adminData\.createListingAlert\(data\)/);
});
