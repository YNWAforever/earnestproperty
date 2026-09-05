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
