import assert from "node:assert/strict";
import test from "node:test";
import { deliverWoztellCampaign } from "./campaign-delivery.server.ts";
import {
  CAMPAIGN_UNKNOWN_STREAK_LIMIT,
  SYSTEMIC_REFUSAL_PATTERN,
  classifyCampaignSendResult,
  nextUnknownStreak,
} from "./campaign-send-outcome.ts";
import {
  CAMPAIGN_DELIVERY_UNKNOWN,
  CAMPAIGN_PAUSED_ERROR,
  CAMPAIGN_RETRYABLE_FAILURE_CODES,
  campaignHasDeliveryHistorySql,
  retryableFailedRecipientSql,
} from "../neon/campaign-retry.ts";

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

// ---------------------------------------------------------------------------
// FX-10b Task 1: one classifier for every campaign send result.
// The governing rule: anything that shows the provider MAY have accepted the
// message is `unknown` (terminal, never re-sent). Only a provable refusal is
// `failed` (retry-safe), and only an auth/channel/config refusal is `stop`.
// ---------------------------------------------------------------------------
const SENT = { kind: "sent" };
const FAILED = { kind: "failed", code: "WOZTELL_PROVIDER_REJECTED" };
const UNKNOWN = { kind: "unknown", code: "WOZTELL_DELIVERY_UNKNOWN" };
const stop = (reason, providerStatus) => ({ kind: "stop", reason, providerStatus });

test("classifyCampaignSendResult maps every provider answer to exactly one outcome", () => {
  const table = [
    [{ ok: true, status: 200 }, SENT],
    [{ ok: false }, stop("WOZTELL_CONFIGURATION_UNAVAILABLE", null)],
    [
      { ok: false, refused: true, error: "WOZTELL_CHANNEL_SCOPE_MISMATCH" },
      stop("WOZTELL_CONFIGURATION_UNAVAILABLE", null),
    ],
    [{ ok: false, status: 401 }, stop("WOZTELL_AUTH_REJECTED", 401)],
    [{ ok: false, status: 403 }, stop("WOZTELL_AUTH_REJECTED", 403)],
    [{ ok: false, status: 400 }, FAILED],
    [{ ok: false, status: 404 }, FAILED],
    [{ ok: false, status: 422 }, FAILED],
    // 429 is a per-recipient, retryable refusal -- never a campaign stop.
    [{ ok: false, status: 429 }, FAILED],
    [{ ok: false, status: 200 }, UNKNOWN],
    [{ ok: false, status: 408 }, UNKNOWN],
    [{ ok: false, status: 500 }, UNKNOWN],
    [{ ok: false, status: 503 }, UNKNOWN],
  ];
  for (const [input, expected] of table) {
    assert.deepEqual(classifyCampaignSendResult(input), expected, JSON.stringify(input));
  }
});

test('an ok:0 "User is not authorized." refusal is a systemic stop, but a per-number refusal is not', () => {
  assert.deepEqual(
    classifyCampaignSendResult({
      ok: false,
      status: 500,
      refused: true,
      error: "User is not authorized.",
    }),
    stop("WOZTELL_AUTH_REJECTED", 500),
  );
  assert.deepEqual(
    classifyCampaignSendResult({
      ok: false,
      status: 500,
      refused: true,
      error: "WOZTELL_112: Channel ID not found",
    }),
    stop("WOZTELL_AUTH_REJECTED", 500),
  );
  assert.deepEqual(
    classifyCampaignSendResult({
      ok: false,
      status: 500,
      refused: true,
      error: "WOZTELL_131026: Receiver is incapable of receiving this message",
    }),
    FAILED,
  );
  // The pattern only counts when WOZTELL actually refused: an unrefused 5xx
  // that merely mentions auth stays ambiguous.
  assert.deepEqual(
    classifyCampaignSendResult({ ok: false, status: 500, error: "User is not authorized." }),
    UNKNOWN,
  );
  assert.equal(SYSTEMIC_REFUSAL_PATTERN.test("invalid ACCESS TOKEN"), true);
  assert.equal(SYSTEMIC_REFUSAL_PATTERN.test("User is not authorised."), true);
  assert.equal(SYSTEMIC_REFUSAL_PATTERN.test("WOZTELL_1120: something"), false);
});

test("a 4xx whose body carries a message id is unknown, never retry-safe", () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    assert.deepEqual(
      classifyCampaignSendResult({ ok: false, status, providerResult: { possibleAccepted: true } }),
      UNKNOWN,
      String(status),
    );
    // Acceptance evidence wins even over an ok:0 that names auth.
    assert.deepEqual(
      classifyCampaignSendResult({
        ok: false,
        status,
        refused: true,
        error: "User is not authorized.",
        providerResult: { possibleAccepted: true },
      }),
      UNKNOWN,
      `${status} refused+accepted`,
    );
  }
});

test("a 5xx or 2xx carrying a message id is unknown", () => {
  for (const status of [200, 202, 500, 502, 503]) {
    assert.deepEqual(
      classifyCampaignSendResult({ ok: false, status, providerResult: { possibleAccepted: true } }),
      UNKNOWN,
      String(status),
    );
  }
  assert.deepEqual(
    classifyCampaignSendResult({
      ok: false,
      status: 500,
      refused: true,
      error: "WOZTELL_131026: Receiver is incapable of receiving this message",
      providerResult: { possibleAccepted: true },
    }),
    UNKNOWN,
  );
});

test("the unknown streak counts consecutive unconfirmed results only", () => {
  assert.equal(CAMPAIGN_UNKNOWN_STREAK_LIMIT, 3);
  const sequence = ["unknown", "thrown", "sent", "unknown", "unknown", "thrown"];
  const streaks = [];
  let streak = 0;
  for (const outcome of sequence) {
    streak = nextUnknownStreak(streak, outcome);
    streaks.push(streak);
  }
  assert.deepEqual(streaks, [1, 2, 0, 1, 2, 3]);
  assert.equal(nextUnknownStreak(2, "failed"), 0);
  assert.equal(nextUnknownStreak(2, "stop"), 2);
});

test("retry predicates name only never-dispatched definite refusals", () => {
  assert.deepEqual([...CAMPAIGN_RETRYABLE_FAILURE_CODES].sort(), [
    "WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED",
    "WOZTELL_PROVIDER_REJECTED",
  ]);
  assert.equal(CAMPAIGN_PAUSED_ERROR, "WOZTELL_CAMPAIGN_PAUSED");
  assert.equal(CAMPAIGN_DELIVERY_UNKNOWN, "WOZTELL_DELIVERY_UNKNOWN");
  const retryable = retryableFailedRecipientSql("r");
  assert.match(retryable, /r\.status = 'failed'/);
  assert.match(retryable, /r\.dispatch_started_at IS NULL/);
  assert.match(retryable, /'WOZTELL_PROVIDER_REJECTED'/);
  assert.match(retryable, /'WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED'/);
  assert.doesNotMatch(retryable, /WOZTELL_DELIVERY_UNKNOWN/);
  assert.throws(() => retryableFailedRecipientSql("r; drop"));
  assert.throws(() => campaignHasDeliveryHistorySql("c) OR (true"));
  const history = campaignHasDeliveryHistorySql("c");
  assert.match(history, /dispatch_started_at IS NOT NULL/);
  assert.match(history, /WOZTELL_DELIVERY_UNKNOWN/);
  assert.match(history, /c\.id/);
});

function runOneSend(sendResponse) {
  let claimed = false;
  const updates = [];
  const run = deliverWoztellCampaign("campaign", {
    isEnabled: () => true,
    claimRecipients: async () => {
      if (claimed) return [];
      claimed = true;
      return [recipient("1")];
    },
    beginDispatch: async () => recipient("1"),
    updateRecipient: async (...args) => {
      updates.push(args);
    },
    hasPendingRecipients: async () => false,
    refreshStatus: async () => {},
    sendResponse,
  });
  return { run, updates };
}

test("a 4xx with acceptance evidence is recorded as unknown", async () => {
  const { run, updates } = runOneSend(async () => ({
    ok: false,
    status: 400,
    refused: false,
    providerResult: { possibleAccepted: true },
  }));
  await run;
  assert.deepEqual(updates, [["1", "failed", "WOZTELL_DELIVERY_UNKNOWN"]]);
});

for (const [label, thrown] of [
  ["a timeout", Object.assign(new Error("The operation was aborted"), { name: "AbortError" })],
  ["a network error after the request was sent", new TypeError("fetch failed")],
]) {
  test(`${label} is recorded as unknown, never retry-safe`, async () => {
    const { run, updates } = runOneSend(async () => {
      throw thrown;
    });
    const summary = await run;
    assert.equal(summary.failed, 1);
    assert.deepEqual(updates, [["1", "failed", "WOZTELL_DELIVERY_UNKNOWN"]]);
  });
}

test("a 401 re-queues the undispatched recipient and stops the run", async () => {
  const { run, updates } = runOneSend(async () => ({ ok: false, status: 401, refused: false }));
  await assert.rejects(run, (error) => error.code === "WOZTELL_AUTH_REJECTED");
  assert.deepEqual(updates, [["1", "queued", "WOZTELL_AUTH_REJECTED"]]);
});

test("missing configuration still re-queues and stops exactly as before", async () => {
  const { run, updates } = runOneSend(async () => ({
    ok: false,
    error: "Missing WOZTELL_BOT_ACCESS_TOKEN or WOZTELL_CHANNEL_ID",
  }));
  await assert.rejects(run, (error) => error.code === "WOZTELL_CONFIGURATION_UNAVAILABLE");
  assert.deepEqual(updates, [["1", "queued", "WOZTELL_CONFIGURATION_UNAVAILABLE"]]);
});

test("a 429 stays a per-recipient retryable failure and the run continues", async () => {
  const { run, updates } = runOneSend(async () => ({ ok: false, status: 429, refused: false }));
  const summary = await run;
  assert.equal(summary.failed, 1);
  assert.deepEqual(updates, [["1", "failed", "WOZTELL_PROVIDER_REJECTED"]]);
});
