import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reply intent authorizes current conversation and selected no-link owner in SQL", () => {
  const source = readFileSync(
    new URL("../woztell/outbound-intent.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /wa_can_read_conversation\(/);
  assert.match(source, /wa_can_reply_enquiry\(/);
});

test("provider accepted alone does not credit a human customer reply", () => {
  const migration = readFileSync(
    new URL(
      "../../../neon/migrations/20260929105000_whatsapp_no_link_effects.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /wa_credit_delivered_intent/);
  assert.match(migration, /status NOT IN \('delivered','read'\)/);
});
