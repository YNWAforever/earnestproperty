import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleWoztellWebhook } from "./webhook.server.ts";
const config = {
  channelSecret: "synthetic-secret",
  channelId: "fixture-channel",
  appId: "fixture-app",
};
const payload = {
  type: "TEXT",
  member: "fixture-member",
  channel: "fixture-channel",
  app: "fixture-app",
  data: { text: "Synthetic" },
};
function request(p = payload, signature = true) {
  const body = JSON.stringify(p);
  return new Request("https://example.invalid/api/woztell/webhook", {
    method: "POST",
    body,
    headers: {
      "x-woztell-signature": signature
        ? createHmac("sha256", config.channelSecret).update(body).digest("base64")
        : "invalid",
    },
  });
}
test("AT-01 signature validation precedes parsing and mutation", async () => {
  let calls = 0;
  const r = await handleWoztellWebhook(request(payload, false), {
    config,
    ingest: async () => {
      calls++;
    },
  });
  assert.equal(r.status, 401);
  assert.equal(calls, 0);
});
test("AT-02 wrong or missing expected channel/app never ingests", async () => {
  for (const p of [
    { ...payload, channel: "other" },
    { ...payload, app: "other" },
    { ...payload, app: undefined },
  ]) {
    let calls = 0;
    const r = await handleWoztellWebhook(request(p), {
      config,
      ingest: async () => {
        calls++;
      },
    });
    assert.equal(r.status, 403);
    assert.equal(calls, 0);
  }
});
test("Trusted live origin cannot be overridden by signed payload content", async () => {
  let origin;
  const r = await handleWoztellWebhook(request({ ...payload, origin: "history_import" }), {
    config,
    ingest: async (e, o) => {
      origin = o;
      return { skipped: null };
    },
  });
  assert.equal(r.status, 200);
  assert.equal(origin, "live_webhook");
});
test("Body budget and malformed envelopes fail before ingestion", async () => {
  let calls = 0;
  const deps = {
    config,
    ingest: async () => {
      calls++;
    },
  };
  assert.equal(
    (
      await handleWoztellWebhook(
        new Request("https://example.invalid", { method: "POST", body: "x".repeat(1048577) }),
        deps,
      )
    ).status,
    413,
  );
  assert.equal((await handleWoztellWebhook(request([]), deps)).status, 400);
  assert.equal(calls, 0);
});

test("AT-02 contradictory wrapped scope cannot be hidden by outer aliases", async () => {
  let calls = 0;
  const r = await handleWoztellWebhook(
    request({ ...payload, messageEvent: { ...payload, channel: "different" } }),
    {
      config,
      ingest: async () => {
        calls++;
        return { skipped: null };
      },
    },
  );
  assert.equal(r.status, 403);
  assert.equal(calls, 0);
});
