import assert from "node:assert/strict";
import test from "node:test";

import { createObservation, SOURCE_28HSE, SOURCE_OLD_SITE } from "./source-contract.mjs";
import { runDualSourceSync } from "./orchestrator.mjs";

const NOW = () => new Date("2026-08-18T01:00:00.000Z");

function observation(source, externalId, propertyNo = "EP-100") {
  return createObservation({
    source,
    externalId,
    dealType: "sale",
    sourceUrl: `https://example.test/${source}/${externalId}`,
    propertyNoRaw: propertyNo,
    fetchedAt: "2026-08-18T01:00:00.000Z",
    fields: {
      title_zh: "測試單位",
      district_slug: "tsuen-wan",
      price: 12500000,
      status: "active",
    },
  });
}

function result(source, observations, overrides = {}) {
  return {
    source,
    identityValid: true,
    robotsAllowed: true,
    paginationComplete: true,
    challengeDetected: false,
    advertisedCounts: { sale: observations.length, rent: 0 },
    pageCounts: { sale: observations.length, rent: 1 },
    discovered: observations.length,
    observations,
    failures: [],
    diagnostics: [],
    conflictingDuplicateIds: [],
    ...overrides,
  };
}

function fakeRepository(overrides = {}) {
  const calls = [];
  let nextId = 1;
  return {
    calls,
    async beginRun() {
      calls.push("beginRun");
      return { runId: "11111111-1111-4111-8111-111111111111" };
    },
    async saveObservations(runId, observations) {
      calls.push(`save:${observations.length}`);
      return observations.map((item) => ({
        id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
        source: item.source,
        externalId: item.externalId,
        dealType: item.dealType,
        propertyNoNormalized: item.propertyNoNormalized,
        matchKey: item.matchKey,
        contentHash: item.contentHash,
      }));
    },
    async getHealthyCountHistory() {
      return [{ sale: 1, rent: 0 }];
    },
    async recordRunEvaluation(_runId, evaluation) {
      calls.push(`evaluate:${evaluation.sourceStatus[SOURCE_28HSE].healthy}`);
    },
    async assertLockSession() {
      calls.push("assertLockSession");
    },
    async finishRun(_runId, completion) {
      calls.push(`finish:${completion.status}`);
    },
    async getApprovedHealthyShadowStreak() {
      return { length: 7, lastDate: "2026-08-17" };
    },
    async findCanonicalCandidates() {
      return [];
    },
    async loadSourceLinks() {
      return [];
    },
    async saveProposedLinks(_runId, links) {
      calls.push(`proposed:${links.length}`);
    },
    async loadEstateIdsBySlug() {
      return new Map();
    },
    async loadFieldStates() {
      return [];
    },
    async loadLifecycleStates() {
      return [];
    },
    async publishBatch(input) {
      calls.push(`publish:${input.proposals.length}`);
      return { inserted: 0, updated: 0, events: 0 };
    },
    ...overrides,
  };
}

function fakeMedia(overrides = {}) {
  return {
    async prepareListingMedia(input) {
      return {
        publishable: true,
        reasons: [],
        images: [],
        uploadCount: input.mode === "upload" ? 1 : 0,
        wouldUploadCount: input.mode === "validate" ? 1 : 0,
        results: [],
        prepared: null,
      };
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  const oldSite = result(SOURCE_OLD_SITE, [observation(SOURCE_OLD_SITE, "old-100")]);
  const hse28 = result(SOURCE_28HSE, [observation(SOURCE_28HSE, "28-100")]);
  const repository = fakeRepository();
  const artifacts = [];
  return {
    scheduledFor: "2026-08-18",
    mode: "shadow",
    publishEnabled: false,
    mediaRightsConfirmed: true,
    parserVersion: "dual-source-v1",
    adapters: {
      oldSite: { collect: async () => oldSite },
      hse28: { collect: async () => hse28 },
    },
    repository,
    media: fakeMedia(),
    reporter: { writeRunArtifacts: async (value) => artifacts.push(value) },
    signal: new AbortController().signal,
    now: NOW,
    artifacts,
    ...overrides,
  };
}

test("unhealthy 28Hse persists evidence before blocking every canonical write", async () => {
  const value = input({
    adapters: {
      oldSite: {
        collect: async () => result(SOURCE_OLD_SITE, [observation(SOURCE_OLD_SITE, "old-100")]),
      },
      hse28: { collect: async () => result(SOURCE_28HSE, [], { challengeDetected: true }) },
    },
  });
  const outcome = await runDualSourceSync(value);
  assert.equal(outcome.status, "blocked");
  assert.deepEqual(value.repository.calls, [
    "beginRun",
    "save:1",
    "save:0",
    "evaluate:false",
    "finish:blocked",
  ]);
  assert.equal(value.artifacts.length, 1);
});

test("degraded old site only permits safe 28Hse reconciliation and resets inactivity", async () => {
  const repository = fakeRepository({
    async findCanonicalCandidates() {
      return [
        {
          id: "00000000-0000-4000-8000-000000000900",
          listing_no: "L100",
          canonical_property_no: "EP-100",
          legacy_property_no: null,
          deal_type: "sale",
          updated_at: "2026-08-18T00:00:00.000000Z",
        },
      ];
    },
  });
  const value = input({
    mode: "publish",
    publishEnabled: true,
    repository,
    adapters: {
      oldSite: { collect: async () => result(SOURCE_OLD_SITE, [], { paginationComplete: false }) },
      hse28: { collect: async () => result(SOURCE_28HSE, [observation(SOURCE_28HSE, "28-100")]) },
    },
  });
  const outcome = await runDualSourceSync(value);
  assert.equal(outcome.status, "degraded");
  assert.ok(repository.calls.includes("publish:1"));
});

test("exact duplicates make one proposal while ambiguity and linked quarantined detail make none", async () => {
  const value = input({
    media: fakeMedia({
      async prepareListingMedia() {
        return {
          publishable: false,
          reasons: ["media_failed"],
          images: [],
          uploadCount: 0,
          wouldUploadCount: 0,
          results: [],
          prepared: null,
        };
      },
    }),
  });
  const outcome = await runDualSourceSync(value);
  assert.equal(outcome.counts.exactGroups, 1);
  assert.equal(outcome.counts.quarantined, 1);
  assert.equal(outcome.proposals.length, 0);
});

test("shadow validates media and writes no public publication", async () => {
  const value = input();
  const outcome = await runDualSourceSync(value);
  assert.equal(outcome.status, "shadow_healthy");
  assert.ok(!value.repository.calls.includes("assertLockSession"));
  assert.ok(!value.repository.calls.some((call) => call.startsWith("publish:")));
  assert.equal(outcome.counts.mediaValidated, 1);
});

test("adapter exceptions and finalization failures are surfaced without discarding saved evidence", async () => {
  const value = input({
    adapters: {
      oldSite: {
        collect: async () => {
          throw new Error("adapter exploded");
        },
      },
      hse28: { collect: async () => result(SOURCE_28HSE, [observation(SOURCE_28HSE, "28-100")]) },
    },
  });
  const outcome = await runDualSourceSync(value);
  assert.equal(outcome.status, "degraded");
  assert.equal(outcome.counts.sourceFailures, 1);
  assert.ok(value.repository.calls.includes("save:0"));
});

test("publication rollback errors propagate and an unchanged rerun has no duplicate public event", async () => {
  const failing = input({
    mode: "publish",
    publishEnabled: true,
    repository: fakeRepository({
      async publishBatch() {
        throw new Error("rollback propagated");
      },
    }),
  });
  await assert.rejects(() => runDualSourceSync(failing), /rollback propagated/);
});

test("converts enumerable reconciliation evidence to Task 9 plain proposal evidence", async () => {
  const outcome = await runDualSourceSync(input());
  assert.equal(outcome.proposals.length, 1);
  assert.deepEqual(Object.getOwnPropertySymbols(outcome.proposals[0].canonical), []);
  assert.equal(Object.getOwnPropertySymbols(outcome.proposals[0]).length, 0);
});

test("asserts the locked session immediately before a complete publish-mode media handoff", async () => {
  const calls = [];
  const repository = fakeRepository({
    async assertLockSession() {
      calls.push("lock");
    },
    async publishBatch(input) {
      calls.push("publish");
      return { inserted: 0, updated: 0, events: 0 };
    },
  });
  const value = input({
    mode: "publish",
    publishEnabled: true,
    repository,
    mediaAllowedHosts: ["images.example.test"],
    blobStore: {
      put: async () => {
        throw new Error("not reached");
      },
    },
    media: {
      async prepareListingMedia(mediaInput) {
        calls.push("media");
        assert.match(mediaInput.observationId, /^00000000-0000-4000-8000-\d{12}$/);
        assert.equal(mediaInput.propertyId, null);
        assert.deepEqual(mediaInput.currentImages, []);
        assert.deepEqual(mediaInput.allowedMediaHosts, ["images.example.test"]);
        assert.equal(mediaInput.blobStore != null, true);
        return {
          publishable: false,
          reasons: ["fixture_media"],
          images: [],
          uploadCount: 0,
          wouldUploadCount: 0,
          candidateResults: [],
          preparedMedia: null,
        };
      },
    },
  });
  await runDualSourceSync(value);
  assert.deepEqual(calls, ["lock", "media", "publish"]);
});

test("emits lifecycle and provenance events for seen, absent, unknown, and quarantined linked details", async () => {
  const outcome = await runDualSourceSync(input());
  assert.equal(outcome.proposals.length, 1);
  const proposal = outcome.proposals[0];
  assert.ok(proposal.events.length > 0);
  assert.ok(proposal.events.some((event) => event.winningObservationId));
  assert.ok(
    proposal.events.some((event) => ["new", "changed", "reactivated"].includes(event.changeType)),
  );
  assert.ok(Object.hasOwn(proposal.lifecycle, "consecutiveAbsentHealthyRuns"));
});

test("classifies post-commit finalization failures and redacts diagnostic evidence", async () => {
  const artifacts = [];
  let finishCalls = 0;
  const value = input({
    mode: "publish",
    publishEnabled: true,
    reporter: { writeRunArtifacts: async (artifact) => artifacts.push(artifact) },
    repository: fakeRepository({
      async finishRun() {
        finishCalls += 1;
        throw new Error("password=hunter2 <html>body</html> SQL params [$1]");
      },
    }),
  });
  await assert.rejects(() => runDualSourceSync(value), /password=hunter2/);
  assert.ok(finishCalls >= 1);
  const failure = artifacts.at(-1);
  assert.equal(failure.failureCode, "run_finalization_failed_after_publish");
  assert.doesNotMatch(failure.failureSummary, /hunter2|<html|\$1/);
});
