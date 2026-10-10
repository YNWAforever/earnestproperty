import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignSavePayload,
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
// FX-17a D-13: the schedule field is gone. A stored scheduled_at (including an
// old 已排期 row's) is sent back exactly as loaded, never cleared or rewritten.
test("saving a campaign keeps an existing scheduled_at untouched", () => {
  const stored = "2026-11-01T10:00:00.000Z";
  const scheduled = {
    ...empty,
    id: "7917a000-0000-4000-8000-000000000501",
    name: "  已排期推廣 ",
    template_id: "7917a000-0000-4000-8000-000000000502",
    audience_id: "7917a000-0000-4000-8000-000000000503",
    status: "scheduled",
    scheduled_at: stored,
  };
  const payload = campaignSavePayload(scheduled);
  assert.equal(payload.scheduled_at, stored);
  assert.equal(payload.status, "scheduled");
  assert.equal(payload.name, "已排期推廣");
  assert.deepEqual(campaignSavePayload({ ...scheduled, status: "review" }).scheduled_at, stored);
  // An empty string is passed through too: the client never decides a stored value.
  assert.equal(campaignSavePayload({ ...scheduled, scheduled_at: "" }).scheduled_at, "");
  assert.equal(campaignSavePayload({ ...empty, name: "新推廣" }).scheduled_at, null);
  // The draft itself is not mutated.
  assert.equal(scheduled.name, "  已排期推廣 ");
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
