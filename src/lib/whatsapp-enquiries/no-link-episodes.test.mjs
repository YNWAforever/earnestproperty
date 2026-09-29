import assert from "node:assert/strict";
import test from "node:test";
import { parsePortalEnquiry } from "./portal-intake.ts";
import { referenceKey } from "./enquiry-association.server.ts";

function match(url) {
  const reference = parsePortalEnquiry(url).references[0];
  return {
    reference,
    snapshot: { scopeId: "agent:540" },
  };
}

test("association key distinguishes a second listing, leading zero and channel", () => {
  const first = match("https://www.28hse.com/buy/apartment/property-4033349");
  const second = match("https://www.28hse.com/buy/apartment/property-4999999");
  const leading = match("https://www.28hse.com/buy/apartment/property-04033349");
  assert.notEqual(referenceKey("company", first), referenceKey("company", second));
  assert.notEqual(referenceKey("company", first), referenceKey("company", leading));
  assert.notEqual(referenceKey("company", first), referenceKey("other", first));
});

test("known nonidentity t is ignored but unknown unit query remains in association key", () => {
  const base = match("https://www.28hse.com/buy/apartment/property-4033349");
  const timestamp = match("https://www.28hse.com/buy/apartment/property-4033349?t=999");
  const unit = match("https://www.28hse.com/buy/apartment/property-4033349?unit=2");
  assert.equal(referenceKey("company", base), referenceKey("company", timestamp));
  assert.notEqual(referenceKey("company", base), referenceKey("company", unit));
});

test("active worker suppresses service effects for a recognised portal message even before new SQL exists", async () => {
  const prior = process.env.EP_WA_ENQUIRY_MODE;
  process.env.EP_WA_ENQUIRY_MODE = "active";
  const { observeEnquiryEvent } = await import("./workflow.server.ts");
  const statements = [];
  const eventId = "11111111-1111-4111-8111-111111111111";
  const query = async (statement) => {
    statements.push(statement);
    if (statement.includes("SELECT e.id,e.app_id"))
      return [
        {
          id: eventId,
          app_id: "synthetic-app",
          channel_id: "synthetic-channel",
          member_id: "synthetic-member",
          external_message_id: "synthetic-message",
          received_at: new Date("2026-09-29T12:00:00Z"),
          text: "https://www.28hse.com/buy/apartment/property-4033349",
        },
      ];
    if (statement.includes("to_regprocedure('wa_associate_no_link")) return [{ available: false }];
    if (statement.includes("to_regprocedure('wa_observe_episode")) return [{ available: false }];
    if (statement.includes("to_regclass('whatsapp_inbox_evidence_capabilities"))
      return [{ available: false }];
    return [];
  };
  try {
    await observeEnquiryEvent(eventId, async () => {}, query);
    assert.equal(
      statements.some(
        (statement) => statement.includes("wa_service_") || statement.includes("ops_jobs"),
      ),
      false,
    );
    assert.ok(statements.some((statement) => statement.includes("processing_state='processed'")));
  } finally {
    if (prior === undefined) delete process.env.EP_WA_ENQUIRY_MODE;
    else process.env.EP_WA_ENQUIRY_MODE = prior;
  }
});
