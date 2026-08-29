import assert from "node:assert/strict";
import test from "node:test";

import { createObservation, SOURCE_28HSE, SOURCE_OLD_SITE } from "./source-contract.mjs";
import { runDualSourceSync } from "./orchestrator.mjs";
import { PublicationOutcomeUnknownError } from "./sync-repository.mjs";

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
    async getRunStartedAt() {
      return "2026-08-18T01:00:00.000000Z";
    },
    async loadCanonicalReadModels() {
      const candidates = await this.findCanonicalCandidates();
      return candidates.map((property) => ({
        property,
        currentOwnedImages: Array.isArray(property.images) ? property.images : [],
        activeLinks: [],
      }));
    },
    async listActiveLinkedPropertyIds() {
      return { propertyIds: [], nextCursor: null };
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
        candidateResults: [],
        preparedMedia: null,
      };
    },
    ...overrides,
  };
}

function currentCandidate(id = "00000000-0000-4000-8000-000000000900") {
  return {
    id,
    listing_no: "EP-100-L100-S",
    canonical_property_no: "EP-100",
    legacy_property_no: null,
    deal_type: "sale",
    updated_at: "2026-08-18T00:00:00.000000Z",
    title_zh: "\u539f\u6709\u55ae\u4F4D",
    title_en: null,
    estate_id: null,
    district_slug: "tsuen-wan",
    address: null,
    price: 12500000,
    rent: null,
    saleable_area: null,
    gross_area: null,
    bedrooms: null,
    bathrooms: null,
    floor: null,
    orientation: null,
    features: [],
    description: null,
    images: [],
    status: "active",
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
          ...currentCandidate("00000000-0000-4000-8000-000000000900"),
          listing_no: "L100",
          images: ["https://owned.example/current.png"],
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
          publishable: true,
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

test("uses nonempty provenance reasons for every Task 9 change event", async () => {
  const outcome = await runDualSourceSync(input());
  assert.ok(outcome.proposals[0].events.length > 0);
  assert.ok(
    outcome.proposals[0].events.every(
      (event) => typeof event.reason === "string" && event.reason.length > 0,
    ),
  );
});

test("quarantines media that invalidates the untouched reconciliation canonical", async () => {
  const outcome = await runDualSourceSync(
    input({
      mode: "publish",
      publishEnabled: true,
      media: fakeMedia({
        async prepareListingMedia(mediaInput) {
          return {
            publishable: true,
            reasons: [],
            images: ["https://cdn.example.test/owned.jpg"],
            uploadCount: 0,
            wouldUploadCount: mediaInput.mode === "validate" ? 1 : 0,
            candidateResults: [],
            preparedMedia: null,
          };
        },
      }),
    }),
  );
  assert.equal(outcome.proposals.length, 0);
  assert.ok(outcome.quarantines.some((entry) => entry.code === "canonical_validation_failed"));
});

test("links old-site persisted evidence into the new canonical and its new event", async () => {
  const outcome = await runDualSourceSync(input());
  const proposal = outcome.proposals[0];
  assert.equal(proposal.canonical.legacy_detail_id, "old-100");
  assert.equal(proposal.canonical.legacy_property_no, "EP-100");
  assert.equal(
    proposal.events.find((event) => event.changeType === "new").newValue.legacy_url,
    "https://example.test/old_site/old-100",
  );
});

test("refreshes proposed-link state before deriving source-link events", async () => {
  const propertyId = "00000000-0000-4000-8000-000000000900";
  let linked = false;
  let sourceLinkReads = 0;
  const repository = fakeRepository({
    async findCanonicalCandidates() {
      return [currentCandidate(propertyId)];
    },
    async loadSourceLinks() {
      sourceLinkReads += 1;
      return [SOURCE_OLD_SITE, SOURCE_28HSE].map((source, index) => ({
        property_id: propertyId,
        source,
        external_listing_id: index === 0 ? "old-100" : "28-100",
        deal_type: "sale",
        match_key: "sale:EP-100",
        link_reason: "exact_property_no_and_deal_type",
        status: linked ? "active" : "proposed",
      }));
    },
    async saveProposedLinks() {
      linked = true;
    },
  });
  const outcome = await runDualSourceSync(input({ repository }));
  assert.equal(sourceLinkReads, 2);
  assert.equal(outcome.proposals.length, 1);
  assert.equal(
    outcome.proposals[0].events.some((event) => event.changeType === "link_change"),
    false,
  );
});

test("preserves explicit-null automated field baselines", async () => {
  const propertyId = "00000000-0000-4000-8000-000000000900";
  const repository = fakeRepository({
    async findCanonicalCandidates() {
      return [currentCandidate(propertyId)];
    },
    async loadFieldStates() {
      return [
        {
          property_id: propertyId,
          field_name: "features",
          last_published_value: null,
          override_value: ["staff-choice"],
          active_override: true,
          winning_observation_id: null,
          updated_at: "2026-08-18T00:00:00.000000Z",
        },
      ];
    },
  });
  const outcome = await runDualSourceSync(input({ repository }));
  const field = outcome.proposals[0].fields.find((candidate) => candidate.fieldName === "features");
  assert.equal(field.lastPublishedValue, null);
  assert.equal(field.activeOverride, true);
});

test("uses the Task 8 current read model and owned current media for a matched property", async () => {
  const propertyId = "00000000-0000-4000-8000-000000000900";
  const current = {
    ...currentCandidate(propertyId),
    address: "Staff retained address",
    images: ["https://earnestproperty.com/media/current.jpg"],
  };
  const repository = fakeRepository({
    async findCanonicalCandidates() {
      return [
        {
          id: propertyId,
          listing_no: current.listing_no,
          canonical_property_no: "EP-100",
          legacy_property_no: null,
          deal_type: "sale",
          updated_at: current.updated_at,
        },
      ];
    },
    async loadCanonicalReadModels() {
      return [{ property: current, currentOwnedImages: current.images, activeLinks: [] }];
    },
  });
  const outcome = await runDualSourceSync(
    input({
      repository,
      media: fakeMedia({
        async prepareListingMedia(mediaInput) {
          assert.deepEqual(mediaInput.currentImages, current.images);
          return {
            publishable: true,
            reasons: [],
            images: current.images,
            uploadCount: 0,
            wouldUploadCount: 0,
            candidateResults: [],
            preparedMedia: null,
          };
        },
      }),
    }),
  );
  assert.equal(outcome.proposals[0].canonical.address, "Staff retained address");
});
test("falls back from a rejected 28Hse media candidate to linked old-site media", async () => {
  const old = createObservation({
    source: SOURCE_OLD_SITE,
    externalId: "old-100",
    dealType: "sale",
    sourceUrl: "https://example.test/old-100",
    propertyNoRaw: "EP-100",
    fetchedAt: "2026-08-18T01:00:00.000Z",
    fields: {
      title_zh: "測試單位",
      district_slug: "tsuen-wan",
      price: 12500000,
      status: "active",
    },
    mediaCandidates: [
      {
        url: "https://images.example.test/old.jpg",
        category: "listing_photo",
        isPrimary: true,
      },
    ],
  });
  const hse = observation(SOURCE_28HSE, "28-100");
  const calls = [];
  const outcome = await runDualSourceSync(
    input({
      adapters: {
        oldSite: {
          collect: async () =>
            result(SOURCE_OLD_SITE, [old], {
              advertisedCounts: { sale: 1, rent: 0 },
              pageCounts: { sale: 1, rent: 1 },
            }),
        },
        hse28: {
          collect: async () =>
            result(SOURCE_28HSE, [hse], {
              advertisedCounts: { sale: 1, rent: 0 },
              pageCounts: { sale: 1, rent: 1 },
            }),
        },
      },
      media: fakeMedia({
        async prepareListingMedia(mediaInput) {
          calls.push(mediaInput.observation.externalId);
          return mediaInput.observation.externalId === "28-100"
            ? {
                publishable: false,
                reasons: ["primary_image_required"],
                images: [],
                uploadCount: 0,
                wouldUploadCount: 0,
                candidateResults: [],
                preparedMedia: null,
              }
            : {
                publishable: true,
                reasons: [],
                images: ["https://earnestproperty.com/media/old.jpg"],
                uploadCount: 0,
                wouldUploadCount: 1,
                candidateResults: [],
                preparedMedia: null,
              };
        },
      }),
    }),
  );
  assert.deepEqual(calls, ["28-100", "old-100"]);
  assert.equal(outcome.proposals.length, 1);
});

test("classifies a publication outcome of unknown commit state without claiming rollback", async () => {
  const artifacts = [];
  const value = input({
    mode: "publish",
    publishEnabled: true,
    reporter: {
      writeRunArtifacts: async (artifact) => artifacts.push(artifact),
    },
    repository: fakeRepository({
      async publishBatch() {
        throw new PublicationOutcomeUnknownError("commit outcome unknown");
      },
    }),
  });
  await assert.rejects(() => runDualSourceSync(value), PublicationOutcomeUnknownError);
  assert.equal(artifacts.at(-1).failureCode, "publication_outcome_unknown");
});

test("redacts complete HTML bodies and credential tails", async () => {
  const artifacts = [];
  const value = input({
    mode: "publish",
    publishEnabled: true,
    reporter: {
      writeRunArtifacts: async (artifact) => artifacts.push(artifact),
    },
    repository: fakeRepository({
      async finishRun() {
        throw new Error("<html>PRIVATE BODY</html> Authorization=Bearer secret-token");
      },
    }),
  });
  await assert.rejects(() => runDualSourceSync(value), /PRIVATE BODY/);
  assert.doesNotMatch(artifacts.at(-1).failureSummary, /PRIVATE BODY|secret-token|Bearer/);
});
test("counts each quarantined observation once", async () => {
  const invalid = {
    ...observation(SOURCE_OLD_SITE, "old-invalid"),
    validationState: "quarantined",
    quarantineReasons: ["bad_fixture"],
  };
  const outcome = await runDualSourceSync(
    input({
      adapters: {
        oldSite: {
          collect: async () => result(SOURCE_OLD_SITE, [invalid]),
        },
        hse28: {
          collect: async () => result(SOURCE_28HSE, [observation(SOURCE_28HSE, "28-100")]),
        },
      },
    }),
  );
  assert.equal(outcome.counts.quarantined, 1);
});
test("uses Task 8 read models and run-start evidence for absent and unknown links", async () => {
  const absentId = "00000000-0000-4000-8000-000000000901";
  const unknownId = "00000000-0000-4000-8000-000000000902";
  const absent = currentCandidate(absentId);
  const unknown = currentCandidate(unknownId);
  unknown.listing_no = "EP-200-L100-S";
  unknown.canonical_property_no = "EP-200";
  const invalid = observation(SOURCE_OLD_SITE, "old-unknown", "EP-200");
  const repository = fakeRepository({
    async listActiveLinkedPropertyIds() {
      return { propertyIds: [absentId, unknownId], nextCursor: null };
    },
    async loadCanonicalReadModels(ids) {
      return ids.map((id) => ({
        property: id === absentId ? absent : unknown,
        currentOwnedImages: [],
        activeLinks: [
          {
            property_id: id,
            source: SOURCE_OLD_SITE,
            external_listing_id: id === absentId ? "old-absent" : "old-unknown",
            deal_type: "sale",
            match_key: id === absentId ? "sale:EP-100" : "sale:EP-200",
            link_reason: "exact_property_no_and_deal_type",
            status: "active",
          },
        ],
      }));
    },
    async loadLifecycleStates() {
      return [
        {
          property_id: absentId,
          consecutive_absent_healthy_runs: 1,
          last_evaluated_run_id: null,
          inactive_reason: null,
          inactive_at: null,
          updated_at: "2026-08-18T00:00:00.000000Z",
        },
        {
          property_id: unknownId,
          consecutive_absent_healthy_runs: 1,
          last_evaluated_run_id: null,
          inactive_reason: null,
          inactive_at: null,
          updated_at: "2026-08-18T00:00:00.000000Z",
        },
      ];
    },
    async getRunStartedAt() {
      return "2026-08-18T01:00:00.000000Z";
    },
  });
  const outcome = await runDualSourceSync(
    input({
      repository,
      adapters: {
        oldSite: {
          collect: async () =>
            result(SOURCE_OLD_SITE, [observation(SOURCE_OLD_SITE, "old-current"), invalid], {
              advertisedCounts: { sale: 2, rent: 0 },
              pageCounts: { sale: 2, rent: 1 },
            }),
        },
        hse28: {
          collect: async () => result(SOURCE_28HSE, [observation(SOURCE_28HSE, "28-current")]),
        },
      },
    }),
  );
  const absentProposal = outcome.proposals.find((proposal) => proposal.propertyId === absentId);
  const unknownProposal = outcome.proposals.find((proposal) => proposal.propertyId === unknownId);
  assert.equal(absentProposal.canonical.status, "inactive");
  assert.equal(absentProposal.lifecycle.inactiveAt, "2026-08-18T01:00:00.000000Z");
  assert.equal(unknownProposal.lifecycle.consecutiveAbsentHealthyRuns, 0);
  assert.equal(unknownProposal.canonical.status, "active");
});
test("counts upload-mode media validation separately", async () => {
  const published = await runDualSourceSync(input({ mode: "publish", publishEnabled: true }));
  assert.equal(published.counts.mediaValidated, 1);
  assert.equal(published.counts.mediaUploaded, 1);
});

test("counts reactivated matched properties separately", async () => {
  const propertyId = "00000000-0000-4000-8000-000000000900";
  const current = { ...currentCandidate(propertyId), status: "inactive" };
  const repository = fakeRepository({
    async findCanonicalCandidates() {
      return [current];
    },
    async loadCanonicalReadModels() {
      return [{ property: current, currentOwnedImages: [], activeLinks: [] }];
    },
    async loadFieldStates() {
      return [
        {
          property_id: propertyId,
          field_name: "status",
          last_published_value: "inactive",
          override_value: null,
          active_override: false,
          winning_observation_id: null,
          updated_at: "2026-08-18T00:00:00.000000Z",
        },
      ];
    },
  });
  const shadow = await runDualSourceSync(input({ repository }));
  assert.equal(shadow.counts.reactivated, 1);
  assert.ok(shadow.proposals[0].events.some((event) => event.changeType === "reactivated"));
});

test("records a stable source-health diagnostic when 28Hse blocks a run", async () => {
  const completions = [];
  const value = input({
    repository: fakeRepository({
      async finishRun(_runId, completion) {
        completions.push(completion);
      },
    }),
    adapters: {
      oldSite: {
        collect: async () => result(SOURCE_OLD_SITE, [observation(SOURCE_OLD_SITE, "old-100")]),
      },
      hse28: {
        collect: async () =>
          result(SOURCE_28HSE, [], {
            challengeDetected: true,
            failures: [{ code: "challenge_detected", detail: "upstream challenge" }],
          }),
      },
    },
  });

  const outcome = await runDualSourceSync(value);

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.failureCode, "source_health_blocked");
  assert.equal(
    outcome.failureSummary,
    "source health blocked: 28hse_unhealthy; 28hse_agent_540:pagination_evidence_invalid,challenge_detected,zero_inventory,sale_count_below_floor,combined_count_below_floor,parse_rate_below_minimum",
  );
  assert.equal(completions.length, 1);
  assert.equal(completions[0].failureCode, "source_health_blocked");
  assert.equal(completions[0].failureSummary, outcome.failureSummary);
});

test("preserves descriptor-safe source diagnostics independently of adapters", async () => {
  const oldDiagnostic = {
    sourceUrl: "https://legacy.invalid/property/c1?token=secret",
    responseStatus: 200,
    attempts: 1,
    templateFingerprint: null,
    selectorCounts: {},
    failureCode: "robots_disallowed",
  };
  const hseDiagnostic = {
    sourceUrl:
      "https://www.28hse.com/agent/540?buyRent=1&page=1&plan_id=540&propertyDoSearchVersion=2.0",
    responseStatus: 200,
    attempts: 1,
    templateFingerprint: "fixture-fingerprint",
    selectorCounts: { listings: 0 },
    failureCode: "unexpected_template",
  };
  const malformedDiagnostic = {
    sourceUrl: "https://example.test/malformed",
    responseStatus: 200,
    attempts: "1",
    templateFingerprint: null,
    selectorCounts: {},
    failureCode: null,
  };
  const accessorDiagnostic = {
    sourceUrl: "https://example.test/accessor",
    responseStatus: 200,
    attempts: 1,
    templateFingerprint: null,
    selectorCounts: {},
    failureCode: null,
  };
  Object.defineProperty(accessorDiagnostic, "failureCode", {
    enumerable: true,
    get() {
      throw new Error("diagnostic accessor must not run");
    },
  });
  const outcome = await runDualSourceSync(
    input({
      adapters: {
        oldSite: {
          collect: async () =>
            result(SOURCE_OLD_SITE, [observation(SOURCE_OLD_SITE, "old-100")], {
              diagnostics: [oldDiagnostic, malformedDiagnostic],
            }),
        },
        hse28: {
          collect: async () =>
            result(SOURCE_28HSE, [], {
              challengeDetected: true,
              diagnostics: [hseDiagnostic, accessorDiagnostic],
            }),
        },
      },
    }),
  );

  assert.deepEqual(outcome.diagnostics, [
    {
      sourceUrl: oldDiagnostic.sourceUrl,
      responseStatus: 200,
      attempts: 1,
      templateFingerprint: null,
      selectorCounts: {},
      failureCode: "robots_disallowed",
    },
    {
      sourceUrl: hseDiagnostic.sourceUrl,
      responseStatus: 200,
      attempts: 1,
      templateFingerprint: "fixture-fingerprint",
      selectorCounts: { listings: 0 },
      failureCode: "unexpected_template",
    },
  ]);
  assert.ok(Object.isFrozen(outcome.diagnostics));
  assert.ok(outcome.diagnostics.every(Object.isFrozen));
  assert.ok(outcome.diagnostics.every((diagnostic) => Object.isFrozen(diagnostic.selectorCounts)));

  oldDiagnostic.selectorCounts.changed = 1;
  hseDiagnostic.failureCode = "changed";
  assert.deepEqual(outcome.diagnostics, [
    {
      sourceUrl: "https://legacy.invalid/property/c1?token=secret",
      responseStatus: 200,
      attempts: 1,
      templateFingerprint: null,
      selectorCounts: {},
      failureCode: "robots_disallowed",
    },
    {
      sourceUrl:
        "https://www.28hse.com/agent/540?buyRent=1&page=1&plan_id=540&propertyDoSearchVersion=2.0",
      responseStatus: 200,
      attempts: 1,
      templateFingerprint: "fixture-fingerprint",
      selectorCounts: { listings: 0 },
      failureCode: "unexpected_template",
    },
  ]);
});

test("preserves source diagnostics across the complete terminal outcome matrix", async () => {
  const diagnostic = {
    sourceUrl: "https://example.test/source?token=secret",
    responseStatus: 200,
    attempts: 1,
    templateFingerprint: "fixture-fingerprint",
    selectorCounts: { listings: 1 },
    failureCode: null,
  };
  const adapters = {
    oldSite: {
      collect: async () =>
        result(SOURCE_OLD_SITE, [observation(SOURCE_OLD_SITE, "old-100")], {
          diagnostics: [diagnostic],
        }),
    },
    hse28: {
      collect: async () =>
        result(SOURCE_28HSE, [observation(SOURCE_28HSE, "28-100")], {
          diagnostics: [diagnostic],
        }),
    },
  };
  const cases = [
    {
      name: "source-health blocked",
      value: input({
        adapters: {
          ...adapters,
          hse28: {
            collect: async () =>
              result(SOURCE_28HSE, [], {
                challengeDetected: true,
                diagnostics: [diagnostic],
              }),
          },
        },
      }),
      status: "blocked",
    },
    {
      name: "publish gate blocked",
      value: input({ mode: "publish", publishEnabled: false, adapters }),
      status: "blocked",
    },
    {
      name: "healthy shadow",
      value: input({ adapters }),
      status: "shadow_healthy",
    },
    {
      name: "publish success",
      value: input({ mode: "publish", publishEnabled: true, adapters }),
      status: "healthy",
    },
  ];

  for (const item of cases) {
    const outcome = await runDualSourceSync(item.value);
    assert.equal(outcome.status, item.status, item.name);
    assert.equal(outcome.diagnostics.length, 2, item.name);
    assert.deepEqual(item.value.artifacts.at(-1).diagnostics, outcome.diagnostics);
  }

  const failureArtifacts = [];
  const failing = input({
    adapters,
    reporter: {
      writeRunArtifacts: async (artifact) => failureArtifacts.push(artifact),
    },
    repository: fakeRepository({
      async findCanonicalCandidates() {
        throw new Error("post-collection failure");
      },
    }),
  });
  await assert.rejects(() => runDualSourceSync(failing), /post-collection failure/);
  assert.equal(failureArtifacts.at(-1).status, "failed");
  assert.equal(failureArtifacts.at(-1).diagnostics.length, 2);
});
