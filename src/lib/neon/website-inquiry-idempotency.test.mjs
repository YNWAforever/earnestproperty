import assert from "node:assert/strict";
import test from "node:test";
import { persistWebsiteInquiry } from "./website-inquiry.js";

const input = {
  submissionId: "11111111-1111-4111-8111-111111111111",
  name: "Test",
  phone: "85260000000",
  normalizedPhone: "85260000000",
  email: null,
  message: "Synthetic enquiry",
  listingNo: null,
  propertyId: null,
  consentWhatsapp: false,
};

test("a duplicate request resolves the existing inquiry without a second intake write", async () => {
  const statements = [];
  const result = await persistWebsiteInquiry(async (sql, params) => {
    statements.push(sql);
    if (statements.length === 1) return [];
    return [{ id: "existing", payload_hash: params[1], replayable: true }];
  }, input);
  assert.equal(result.id, "existing");
  assert.equal(statements.length, 2);
  assert.match(statements[0], /ON CONFLICT \(submission_id\) DO NOTHING/);
  assert.match(statements[1], /^\s*SELECT/);
});

test("request id reuse with a different payload is rejected", async () => {
  let calls = 0;
  await assert.rejects(
    persistWebsiteInquiry(
      async () =>
        ++calls === 1 ? [] : [{ id: "existing", payload_hash: "different", replayable: true }],
      input,
    ),
    (error) => error.code === "INQUIRY_SUBMISSION_CONFLICT",
  );
});

test("expired replay refuses to create another enquiry", async () => {
  let calls = 0;
  await assert.rejects(
    persistWebsiteInquiry(
      async (_sql, params) =>
        ++calls === 1 ? [] : [{ id: "existing", payload_hash: params[1], replayable: false }],
      input,
    ),
    (error) => error.code === "INQUIRY_REPLAY_EXPIRED",
  );
});

test("the replay hash is byte-identical with or without the listing number (C-15)", async () => {
  // The listing page now sends its public number. It is a label, not part of the
  // submission identity: the hash input must stay what it was before, or a retry
  // across a deploy would conflict (or a duplicate slip through).
  const hashOf = async (overrides) => {
    let params;
    await persistWebsiteInquiry(
      async (_sql, p) => {
        params = p;
        return [{ id: "inquiry-1" }];
      },
      {
        ...input,
        submissionId: "79180000-0000-4000-8000-000000000101",
        name: "陳先生",
        phone: "9123 4567",
        normalizedPhone: "85291234567",
        message: "想睇樓",
        propertyId: "79180000-0000-4000-8000-000000000102",
        consentWhatsapp: true,
        ...overrides,
      },
    );
    return params[9];
  };
  const pinned = "0f1f9d5c5fff91e3ded4dfd79dcdd141175d262e24259ebf222547015c98bf35";
  assert.equal(await hashOf({ listingNo: null }), pinned);
  assert.equal(await hashOf({ listingNo: "EP12345-R" }), pinned);
});
