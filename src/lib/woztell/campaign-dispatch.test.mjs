import assert from "node:assert/strict";
import test from "node:test";
import { deliverWoztellCampaign } from "./campaign-delivery.server.ts";

const recipient = (id) => ({
  id,
  normalized_phone: "85260000000",
  whatsapp_member_id: id,
  opt_in_whatsapp: true,
  opted_out_whatsapp: false,
  element_name: "approved",
  language_code: "zh_HK",
  components: [],
});

for (const reason of ["cancelled", "opted-out", "template-expired"]) {
  test(`${reason} after claim prevents every later undispatched send`, async () => {
    const rows = Array.from({ length: 20 }, (_, i) => recipient(String(i)));
    let eligible = true;
    let claimed = false;
    const sends = [];
    await deliverWoztellCampaign("campaign", {
      isEnabled: () => true,
      claimRecipients: async () => {
        if (claimed) return [];
        claimed = true;
        return rows;
      },
      beginDispatch: async (_campaign, id) => (eligible ? rows.find((r) => r.id === id) : null),
      updateRecipient: async () => {},
      hasPendingRecipients: async () => false,
      refreshStatus: async () => {},
      sendResponse: async ({ memberId }) => {
        sends.push(memberId);
        eligible = false;
        return { ok: true, status: 200, body: {} };
      },
    });
    assert.deepEqual(sends, ["0"]);
  });
}

test("dispatch uses refreshed eligibility and template payload instead of claim snapshot", async () => {
  let claimed = false;
  const sends = [];
  await deliverWoztellCampaign("campaign", {
    isEnabled: () => true,
    claimRecipients: async () => {
      if (claimed) return [];
      claimed = true;
      return [recipient("1")];
    },
    beginDispatch: async () => ({ ...recipient("1"), element_name: "reviewed-template" }),
    updateRecipient: async () => {},
    hasPendingRecipients: async () => false,
    refreshStatus: async () => {},
    sendResponse: async (input) => {
      sends.push(input);
      return { ok: true, status: 200, body: {} };
    },
  });
  assert.equal(sends[0].response[0].elementName, "reviewed-template");
});

test("an empty claim with live pending work defers instead of reporting completion", async () => {
  await assert.rejects(
    deliverWoztellCampaign("campaign", {
      isEnabled: () => true,
      claimRecipients: async () => [],
      hasPendingRecipients: async () => true,
      refreshStatus: async () => {},
    }),
    (error) => error.code === "JOB_DEFERRED",
  );
});
