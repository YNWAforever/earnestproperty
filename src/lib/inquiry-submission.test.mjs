import assert from "node:assert/strict";
import test from "node:test";
import { submitWithInquiryIdentity } from "./inquiry-submission.ts";

test("a response loss and subsequent retry reuse one submission identity", async () => {
  const payload = { name: "Synthetic", phone: "85260000000" };
  const ids = [];
  await assert.rejects(
    submitWithInquiryIdentity(
      payload,
      async (input) => {
        ids.push(input.submissionId);
        throw new Error("response lost");
      },
      null,
    ),
  );
  await submitWithInquiryIdentity(
    payload,
    async (input) => {
      ids.push(input.submissionId);
      return { id: "inquiry" };
    },
    null,
  );
  assert.equal(ids[0], ids[1]);
});

test("pending persistence stores only digest keys and opaque identity", async () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  await assert.rejects(
    submitWithInquiryIdentity(
      { message: "PRIVATE_TEXT" },
      async () => {
        throw new Error("offline");
      },
      storage,
    ),
  );
  assert.equal(JSON.stringify([...saved]).includes("PRIVATE_TEXT"), false);
  assert.equal(saved.size, 1);
});
