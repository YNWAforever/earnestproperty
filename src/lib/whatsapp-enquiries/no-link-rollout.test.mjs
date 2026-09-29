import assert from "node:assert/strict";
import test from "node:test";
import { canCaptureNoLinkEffects, canExecuteNoLinkEffects } from "./no-link-rollout.ts";
import { maybePrepareNoLinkFollowup, noLinkCaptureEligible } from "./no-link-rollout.server.ts";
import { buildLiveEventStatements } from "./workflow.server.ts";
import { normalizeWoztellEvent } from "../woztell/woztell.server.ts";

const activation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const staff = "44444444-4444-4444-8444-444444444444";
const ready = {
  mode: "active",
  effectsEnabled: true,
  companyChannelId: "company",
  canaryChannelId: "company",
  canaryActivationId: activation,
  canaryStaffIds: [staff],
  channelId: "company",
  activationId: activation,
  origin: "live_webhook",
  capturedMode: "active",
  effectsEligible: true,
  noLinkSnapshot: true,
  receiptMode: "active",
  receiptActivationId: activation,
  receiptReceivedAt: "2026-09-30T00:01:00Z",
  eventOccurredAt: "2026-09-30T00:00:30Z",
  activationCutoverAt: "2026-09-30T00:00:00Z",
  activationEndedAt: null,
  timing: "fresh",
  identityQuality: "provider_id",
  candidateStaffId: staff,
  capturedStaffIds: [staff],
  mappingVerified: true,
  providerMappingVerified: true,
};

test("new activation and exact channel/cohort allow one canary candidate", () => {
  assert.equal(canCaptureNoLinkEffects(ready).allowed, true);
  assert.deepEqual(canExecuteNoLinkEffects(ready), { allowed: true, reasons: [] });
});

test("shadow_cannot_send_assign_notify_or_mint_link: every inactive mode is denied", () => {
  for (const mode of ["off", "observe"]) {
    assert.equal(canCaptureNoLinkEffects({ ...ready, mode }).allowed, false);
    assert.equal(canExecuteNoLinkEffects({ ...ready, mode }).allowed, false);
  }
  assert.equal(canExecuteNoLinkEffects({ ...ready, effectsEnabled: false }).allowed, false);
});

test("global flag alone cannot cross canary channel, activation or staff scope", () => {
  for (const change of [
    { canaryChannelId: null },
    { channelId: "other" },
    { companyChannelId: "other" },
    { canaryActivationId: null },
    { activationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { canaryStaffIds: [] },
    { candidateStaffId: "55555555-5555-4555-8555-555555555555" },
    { canaryStaffIds: [staff, "bad-id"] },
    { capturedStaffIds: [] },
    { capturedStaffIds: null },
    { capturedStaffIds: ["55555555-5555-4555-8555-555555555555"] },
  ])
    assert.equal(canExecuteNoLinkEffects({ ...ready, ...change }).allowed, false);
});

test("old, history, unverified and stale captures never upgrade on recovery", () => {
  for (const change of [
    { origin: "history_import" },
    { capturedMode: "observe" },
    { effectsEligible: false },
    { noLinkSnapshot: false },
    { receiptMode: "observe" },
    { receiptActivationId: null },
    { receiptReceivedAt: null },
    { eventOccurredAt: null },
    { receiptReceivedAt: "2026-09-29T23:59:59Z" },
    { eventOccurredAt: "2026-09-29T23:59:59Z" },
    { activationEndedAt: "2026-09-30T01:00:00Z" },
    { timing: "stale" },
    { identityQuality: "synthetic_ambiguous" },
  ])
    assert.equal(canExecuteNoLinkEffects({ ...ready, ...change }).allowed, false);
});

test("mapping and provider readiness are required at execution time", () => {
  assert.equal(canExecuteNoLinkEffects({ ...ready, mappingVerified: false }).allowed, false);
  assert.equal(
    canExecuteNoLinkEffects({ ...ready, providerMappingVerified: false }).allowed,
    false,
  );
});

const env = {
  EP_WA_NO_LINK_EFFECTS_ENABLED: "true",
  EP_WA_COMPANY_CHANNEL_ID: "company",
  EP_WA_NO_LINK_CANARY_CHANNEL_ID: "company",
  EP_WA_ACTIVATION_ID: activation,
  EP_WA_NO_LINK_CANARY_ACTIVATION_ID: activation,
  EP_WA_NO_LINK_CANARY_STAFF_IDS: staff,
};
const row = {
  channel_id: ready.channelId,
  activation_id: ready.activationId,
  origin: ready.origin,
  captured_mode: ready.capturedMode,
  effects_eligible: ready.effectsEligible,
  no_link_snapshot: ready.noLinkSnapshot,
  receipt_mode: ready.receiptMode,
  receipt_activation_id: ready.receiptActivationId,
  receipt_received_at: ready.receiptReceivedAt,
  event_occurred_at: ready.eventOccurredAt,
  activation_cutover_at: ready.activationCutoverAt,
  activation_ended_at: ready.activationEndedAt,
  timing: ready.timing,
  identity_quality: ready.identityQuality,
  candidate_staff_id: ready.candidateStaffId,
  captured_staff_ids: ready.capturedStaffIds,
  mapping_verified: ready.mappingVerified,
  provider_mapping_verified: ready.providerMappingVerified,
};

test("capture snapshot requires canary config even when global effects flag is on", () => {
  assert.equal(noLinkCaptureEligible("active", "company", activation, env), true);
  assert.equal(noLinkCaptureEligible("active", "other", activation, env), false);
  assert.equal(noLinkCaptureEligible("observe", "company", activation, env), false);
  assert.equal(
    noLinkCaptureEligible("active", "company", activation, {
      ...env,
      EP_WA_NO_LINK_CANARY_ACTIVATION_ID: undefined,
    }),
    false,
  );
});

test("shadow path touches no effect port and old receipt cannot be promoted", async () => {
  let calls = 0;
  const forbidden = async () => {
    calls++;
    throw new Error("effect port touched");
  };
  const shadow = await maybePrepareNoLinkFollowup(activation, "observe", forbidden, {
    env,
    wake: forbidden,
  });
  assert.equal(shadow.allowed, false);
  assert.equal(calls, 0);
  const seen = [];
  const stale = await maybePrepareNoLinkFollowup(
    activation,
    "active",
    async (sql) => {
      seen.push(sql);
      if (sql.includes("wa_prepare")) throw new Error("effect port touched");
      return [{ ...row, receipt_mode: "observe" }];
    },
    { env, wake: forbidden },
  );
  assert.equal(stale.allowed, false);
  assert.equal(seen.length, 1);
  assert.equal(calls, 0);
});

test("verified canary reaches locking SQL once and wakes only on queued effect", async () => {
  const seen = [];
  let wakes = 0;
  const result = await maybePrepareNoLinkFollowup(
    activation,
    "active",
    async (sql) => {
      seen.push(sql);
      return sql.includes("wa_prepare")
        ? [{ decision: { decision: "assignment_pending" } }]
        : [row];
    },
    {
      env,
      wake: () => {
        wakes++;
      },
    },
  );
  assert.equal(result.allowed, true);
  assert.equal(result.prepared.decision, "assignment_pending");
  assert.equal(seen.length, 2);
  assert.equal(wakes, 1);
});

test("live event statement stores exact immutable canary cohort only for eligible capture", () => {
  const keys = Object.keys(env);
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const event = normalizeWoztellEvent({
    type: "TEXT",
    messageId: "provider-1",
    member: "customer",
    channel: "company",
    app: "app",
    timestamp: 1790726400,
    data: { text: "Synthetic enquiry" },
  });
  try {
    Object.assign(process.env, env);
    const active = buildLiveEventStatements(event, new Date("2026-09-30T00:01:00Z"), "active");
    const snapshot = JSON.parse(active[0].params[11]);
    assert.equal(snapshot.noLinkEffectsEligible, true);
    assert.deepEqual(snapshot.noLinkCanaryStaffIds, [staff]);
    process.env.EP_WA_NO_LINK_CANARY_STAFF_IDS = "";
    const unconfigured = buildLiveEventStatements(
      event,
      new Date("2026-09-30T00:01:00Z"),
      "active",
    );
    const denied = JSON.parse(unconfigured[0].params[11]);
    assert.equal(denied.noLinkEffectsEligible, false);
    assert.deepEqual(denied.noLinkCanaryStaffIds, []);
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
