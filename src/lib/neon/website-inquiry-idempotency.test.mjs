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
