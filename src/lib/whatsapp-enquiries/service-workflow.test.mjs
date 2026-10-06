import assert from "node:assert/strict";
import test from "node:test";
import { parseOutboundIntent } from "../woztell/outbound-intent.server.ts";
import { getJobHandler } from "../control-plane/job-handlers.server.ts";
import { createLiveServiceTransport, parseSurveyReply } from "./service-workflow.server.ts";
test("AT42 service authority cannot enter staff API", () => {
  assert.throws(() =>
    parseOutboundIntent({
      requestId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      kind: "text",
      payload: { text: "hello" },
      actor: "service",
    }),
  );
});
test("AT51 v2 service job carries only internal action ID", () => {
  const h = getJobHandler("woztell.reply.deliver", 2);
  assert.ok(h);
  assert.throws(() =>
    h.parsePayload({ actionId: "11111111-1111-4111-8111-111111111111", text: "unapproved" }),
  );
  assert.deepEqual(h.parsePayload({ actionId: "11111111-1111-4111-8111-111111111111" }), {
    actionId: "11111111-1111-4111-8111-111111111111",
  });
});
test("AT46 ordinary numbers and unverified provider payloads are not answers", () => {
  assert.equal(parseSurveyReply({ text: "2" }), null);
  assert.equal(parseSurveyReply({ type: "BUTTON", payload: "2" }), null);
  assert.throws(() => createLiveServiceTransport(), /UNVERIFIED/);
});

test("Job alarm includes authenticated service lane", async () => {
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync("workers/cron/src/job-alarm.js", "utf8"),
    config = readFileSync("workers/cron/wrangler.jsonc", "utf8");
  assert.match(config, /"crons"\s*:\s*\["\*\/10 0-13 \* \* \*", "0 14-23 \* \* \*"\]/);
  assert.match(worker, /"\/api\/admin\/whatsapp\/service-worker"/);
  const { drainServiceJobs } = await import("../../routes/api.admin.whatsapp.service-worker.ts");
  const original = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal(
      (await drainServiceJobs({ request: new Request("https://fixture.invalid") })).status,
      401,
    );
    process.env.CRON_SECRET = "synthetic-only";
    assert.equal(
      (
        await drainServiceJobs({
          request: new Request("https://fixture.invalid", {
            headers: { authorization: "Bearer wrong" },
          }),
        })
      ).status,
      401,
    );
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
});
