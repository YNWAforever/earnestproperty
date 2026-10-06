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

// ---------------------------------------------------------------------------
// FX-10b Task 2: a systemic stop (auth, configuration, provider outage) pauses
// the campaign back to review and keeps every unsent recipient queued.
// ---------------------------------------------------------------------------
const JOB = { jobId: "job-1", workerId: "worker-1", attempt: 1 };

function runCampaign(rows, sendResponse, extra = {}) {
  let claimed = false;
  const updates = [];
  const pauses = [];
  const sends = [];
  const events = [];
  const run = deliverWoztellCampaign("campaign", {
    job: JOB,
    isEnabled: () => true,
    claimRecipients: async () => {
      if (claimed) return [];
      claimed = true;
      return rows;
    },
    beginDispatch: async (_campaign, id) => rows.find((r) => r.id === id),
    updateRecipient: async (...args) => {
      updates.push(args);
      events.push(["update", ...args]);
    },
    hasPendingRecipients: async () => false,
    refreshStatus: async () => {},
    pauseCampaign: async (...args) => {
      pauses.push(args);
      events.push(["pause", ...args]);
      return { paused: true, remaining: 0 };
    },
    sendResponse: async (input) => {
      sends.push(input.memberId);
      return sendResponse(input, sends.length);
    },
    ...extra,
  });
  return { run, updates, pauses, sends, events };
}

test("an unreadable provider body is unknown at any status, never retry-safe", () => {
  for (const status of [200, 400, 401, 403, 404, 422, 429, 500, 502, 503]) {
    assert.deepEqual(
      classifyCampaignSendResult({ ok: false, status, bodyUnreadable: true }),
      UNKNOWN,
      String(status),
    );
  }
  // A parsed definite refusal keeps its retry-safe classification.
  assert.deepEqual(classifyCampaignSendResult({ ok: false, status: 400 }), FAILED);
  assert.deepEqual(
    classifyCampaignSendResult({ ok: false, status: 400, bodyUnreadable: false }),
    FAILED,
  );
});

test("a 401 mid-run re-queues the rest, then pauses the campaign and stops", async () => {
  const rows = ["a", "b", "c", "d", "e"].map(recipient);
  const { run, updates, pauses, sends, events } = runCampaign(rows, async (_input, call) =>
    call <= 2 ? { ok: true, status: 200 } : { ok: false, status: 401, refused: false },
  );
  await assert.rejects(
    run,
    (error) => error.code === CAMPAIGN_PAUSED_ERROR && error.reason === "WOZTELL_AUTH_REJECTED",
  );
  assert.deepEqual(sends, ["a", "b", "c"]);
  assert.deepEqual(updates, [
    ["a", "sent", null],
    ["b", "sent", null],
    ["c", "queued", "WOZTELL_AUTH_REJECTED"],
    ["d", "queued", "JOB_DELIVERY_INTERRUPTED"],
    ["e", "queued", "JOB_DELIVERY_INTERRUPTED"],
  ]);
  assert.deepEqual(pauses, [["campaign", "WOZTELL_AUTH_REJECTED", 401, JOB]]);
  // The remainder is back in the queue before the campaign is paused.
  assert.equal(events.at(-1)[0], "pause");
});

test("an ok:0 not-authorized refusal pauses exactly like a 401", async () => {
  const rows = ["a", "b"].map(recipient);
  const { run, pauses, sends } = runCampaign(rows, async () => ({
    ok: false,
    status: 500,
    refused: true,
    error: "User is not authorized.",
  }));
  await assert.rejects(run, (error) => error.code === CAMPAIGN_PAUSED_ERROR);
  assert.deepEqual(sends, ["a"]);
  assert.deepEqual(pauses, [["campaign", "WOZTELL_AUTH_REJECTED", 500, JOB]]);
});

test("three unconfirmed results in a row trip the breaker and pause the campaign", async () => {
  const rows = ["a", "b", "c", "d", "e", "f"].map(recipient);
  const { run, updates, pauses, sends } = runCampaign(rows, async () => {
    throw Object.assign(new Error("timeout"), { code: "WOZTELL_PROVIDER_TIMEOUT" });
  });
  await assert.rejects(
    run,
    (error) => error.code === CAMPAIGN_PAUSED_ERROR && error.reason === "WOZTELL_PROVIDER_UNSTABLE",
  );
  assert.deepEqual(sends, ["a", "b", "c"]);
  assert.deepEqual(updates, [
    ["a", "failed", CAMPAIGN_DELIVERY_UNKNOWN],
    ["b", "failed", CAMPAIGN_DELIVERY_UNKNOWN],
    ["c", "failed", CAMPAIGN_DELIVERY_UNKNOWN],
    ["d", "queued", "JOB_DELIVERY_INTERRUPTED"],
    ["e", "queued", "JOB_DELIVERY_INTERRUPTED"],
    ["f", "queued", "JOB_DELIVERY_INTERRUPTED"],
  ]);
  assert.deepEqual(pauses, [["campaign", "WOZTELL_PROVIDER_UNSTABLE", null, JOB]]);
});

test("a confirmed or refused send in between resets the breaker; a 429 never stops the run", async () => {
  const answers = [
    { ok: false, status: 503 },
    null, // thrown
    { ok: true, status: 200 },
    { ok: false, status: 503 },
    { ok: false, status: 429, refused: false },
    { ok: false, status: 503 },
    { ok: false, status: 503 },
  ];
  const rows = answers.map((_, i) => recipient(String(i)));
  const { run, pauses, sends } = runCampaign(rows, async (_input, call) => {
    const answer = answers[call - 1];
    if (!answer) throw new TypeError("fetch failed");
    return answer;
  });
  const summary = await run;
  assert.equal(sends.length, 7);
  assert.deepEqual(pauses, []);
  assert.equal(summary.sent, 1);
});

test("three unreadable provider bodies (400, 429, 500) count as unknown and trip the breaker", async () => {
  const rows = ["a", "b", "c", "d"].map(recipient);
  const statuses = [400, 429, 500];
  const { run, updates, pauses } = runCampaign(rows, async (_input, call) => ({
    ok: false,
    status: statuses[call - 1],
    error: "WOZTELL_INVALID_RESPONSE",
    bodyUnreadable: true,
  }));
  await assert.rejects(run, (error) => error.code === CAMPAIGN_PAUSED_ERROR);
  assert.deepEqual(updates.slice(0, 3), [
    ["a", "failed", CAMPAIGN_DELIVERY_UNKNOWN],
    ["b", "failed", CAMPAIGN_DELIVERY_UNKNOWN],
    ["c", "failed", CAMPAIGN_DELIVERY_UNKNOWN],
  ]);
  assert.deepEqual(pauses, [["campaign", "WOZTELL_PROVIDER_UNSTABLE", null, JOB]]);
});

test("disabled delivery pauses before any send when a job owns the campaign", async () => {
  const { run, pauses, sends } = runCampaign([recipient("a")], async () => ({ ok: true }), {
    isEnabled: () => false,
  });
  await assert.rejects(
    run,
    (error) =>
      error.code === CAMPAIGN_PAUSED_ERROR && error.reason === "WOZTELL_CONFIGURATION_UNAVAILABLE",
  );
  assert.deepEqual(sends, []);
  assert.deepEqual(pauses, [["campaign", "WOZTELL_CONFIGURATION_UNAVAILABLE", null, JOB]]);
});

test("a pause that could not apply keeps the original stop code", async () => {
  const notPaused = async () => ({ paused: false, remaining: 0 });
  const disabled = runCampaign([recipient("a")], async () => ({ ok: true }), {
    isEnabled: () => false,
    pauseCampaign: notPaused,
  });
  // Still retryable in the handler for the rare case the campaign was already cancelled.
  await assert.rejects(disabled.run, (error) => error.code === "WOZTELL_CONFIGURATION_UNAVAILABLE");
  const auth = runCampaign([recipient("a")], async () => ({ ok: false, status: 403 }), {
    pauseCampaign: notPaused,
  });
  await assert.rejects(auth.run, (error) => error.code === "WOZTELL_AUTH_REJECTED");
});
