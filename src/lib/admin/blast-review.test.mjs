import assert from "node:assert/strict";
import test from "node:test";
import {
  isCampaignDraftDirty,
  reviewAudienceRows,
  resolveAudienceSelection,
} from "./blast-review.ts";
const empty = {
  name: "",
  template_id: null,
  audience_id: null,
  status: "draft",
  scheduled_at: null,
};
test("pristine new campaign is clean, edits remain guarded", () => {
  assert.equal(isCampaignDraftDirty(empty, empty), false);
  assert.equal(isCampaignDraftDirty({ ...empty, name: "新推廣" }, empty), true);
});
test("audience exclusions overlap but unique excluded uses recipient identity", () => {
  const rows = [
    {
      id: "a",
      normalized_phone: "61234567",
      opt_in_whatsapp: true,
      opted_out_whatsapp: false,
      identity_safe: true,
    },
    {
      id: "b",
      normalized_phone: "61234567",
      opt_in_whatsapp: true,
      opted_out_whatsapp: false,
      identity_safe: true,
    },
    {
      id: "c",
      normalized_phone: null,
      opt_in_whatsapp: false,
      opted_out_whatsapp: true,
      identity_safe: false,
    },
  ];
  const result = reviewAudienceRows(rows, (phone) => phone);
  assert.equal(result.total, 3);
  assert.equal(result.eligible, 1);
  assert.equal(result.uniqueExcluded, 2);
  assert.equal(result.duplicatePhone, 1);
  assert.equal(result.optedOut, 1);
  assert.equal(result.missingPhone, 1);
  assert.equal(result.notOptedIn, 1);
});

test("saved audience lookup fails closed on missing or ambiguous input", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  await assert.rejects(
    resolveAudienceSelection({ audience_id: id }, async () => null),
    /AUDIENCE_NOT_FOUND/,
  );
  await assert.rejects(
    resolveAudienceSelection({}, async () => {
      throw new Error("unexpected lookup");
    }),
    /INVALID_AUDIENCE_PREVIEW/,
  );
  await assert.rejects(
    resolveAudienceSelection({ audience_id: id, filters: {} }, async () => null),
    /INVALID_AUDIENCE_PREVIEW/,
  );
  let lookupCount = 0;
  const saved = await resolveAudienceSelection({ audience_id: id }, async (actual) => {
    assert.equal(actual, id);
    lookupCount++;
    return { district_slug: "sham-tseng" };
  });
  assert.equal(lookupCount, 1);
  assert.deepEqual(saved, { district_slug: "sham-tseng" });
});
