import test from "node:test";
import assert from "node:assert/strict";
import { handlePropertyhkRequest } from "./propertyhk-http.mjs";
import { SnapshotError } from "./ingestion-contract.mjs";
const secret = "synthetic-test-secret";
const request = (body = "{}", headers = {}) =>
  new Request("https://example.invalid/api/admin/propertyhk-sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, ...headers },
    body,
  });
test("machine auth rejects before body or ingestion and no configured secret fails closed", async () => {
  let calls = 0;
  const ingest = () => calls++;
  assert.equal((await handlePropertyhkRequest(request(), { ingest })).status, 503);
  assert.equal(
    (await handlePropertyhkRequest(request("{}", { authorization: "bad" }), { secret, ingest }))
      .status,
    401,
  );
  assert.equal(calls, 0);
});
test("bounded stream, malformed UTF8/JSON and source authority cannot reach service", async () => {
  let calls = 0;
  const ports = { secret, ingest: () => calls++, maxBytes: 30 };
  for (const [body, status] of [
    [" ".repeat(31), 413],
    ["{", 400],
    [JSON.stringify({ source: "28hse" }), 400],
  ])
    assert.equal((await handlePropertyhkRequest(request(body), ports)).status, status);
  const malformed = new Request("https://example.invalid", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: new Uint8Array([0xff]),
  });
  assert.equal((await handlePropertyhkRequest(malformed, ports)).status, 400);
  assert.equal(calls, 0);
});
test("success and partial receipt return unchanged, source scope and apply options are server bound", async () => {
  const result = {
    success: true,
    status: "partial_success",
    summary: { advertisement_count: 1 },
    receipt_id: "r",
  };
  let captured;
  const response = await handlePropertyhkRequest(
    request(JSON.stringify({ source: "propertyhk" })),
    {
      secret,
      connectionString: "private",
      ingest: async (...args) => {
        captured = args;
        return result;
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(captured[1], {
    apply: true,
    expectedSource: "propertyhk",
    connectionString: "private",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("status matrix is safe and quota includes Retry-After", async () => {
  for (const status of [400, 409, 422, 429, 503]) {
    const response = await handlePropertyhkRequest(request('{"source":"propertyhk"}'), {
      secret,
      ingest: async () => {
        throw new SnapshotError("SAFE_CODE", status, { retryAfter: 120 });
      },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, "SAFE_CODE");
    if (status === 429) assert.equal(response.headers.get("retry-after"), "120");
  }
  const response = await handlePropertyhkRequest(request('{"source":"propertyhk"}'), {
    secret,
    ingest: async () => {
      throw new Error("postgres://private:secret SQL stack");
    },
  });
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes("private"), false);
});
test("slow body is bounded without waiting for an untrusted cancel hook", async () => {
  const body = new ReadableStream({
    start() {},
    cancel() {
      return new Promise(() => {});
    },
  });
  const req = new Request("https://example.invalid", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body,
    duplex: "half",
  });
  const res = await handlePropertyhkRequest(req, {
    secret,
    bodyTimeoutMs: 10,
    ingest: () => assert.fail("no ingest"),
  });
  assert.equal(res.status, 503);
});
