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

test("a malformed stored identity is replaced before submitting", async () => {
  const malformed = "a".repeat(36);
  let persisted;
  const storage = {
    getItem: () => malformed,
    setItem: (_key, value) => {
      persisted = value;
    },
    removeItem: () => {},
  };
  await submitWithInquiryIdentity(
    { name: "Corrupted pending identity", phone: "85261111111" },
    async ({ submissionId }) => {
      assert.match(submissionId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
      assert.notEqual(submissionId, malformed);
      return { id: "inquiry" };
    },
    storage,
  );
  assert.match(persisted, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
});

test("a resolved value without an id (a rate-limited Response) keeps the pending identity for the retry", async () => {
  // TanStack Start resolves a rate-limited server fn with the 429 `Response` instead of
  // rejecting, so `submit` returns normally but nothing was saved. The identity must survive
  // that return, otherwise the visitor's retry would be recorded as a second, separate lead.
  const payload = { name: "Synthetic rate limited", phone: "85262222222" };
  const ids = [];
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  const first = await submitWithInquiryIdentity(
    payload,
    async (input) => {
      ids.push(input.submissionId);
      return new Response("Too Many Requests", { status: 429 });
    },
    storage,
  );
  assert.ok(first instanceof Response);
  assert.equal(saved.size, 1, "the pending key must still be stored after an id-less result");

  const second = await submitWithInquiryIdentity(
    payload,
    async (input) => {
      ids.push(input.submissionId);
      return { id: "inquiry" };
    },
    storage,
  );
  assert.equal(second.id, "inquiry");
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1], "the retry must reuse the same submissionId");
  assert.equal(saved.size, 0, "a confirmed save clears the pending key");
});
