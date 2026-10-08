import assert from "node:assert/strict";
import test from "node:test";
import { inventoryConfiguration, assessRelease, summarizeFreshness } from "./release-readiness.mjs";

test("configuration inventory exposes presence only and does not confuse flags with evidence", () => {
  const result = inventoryConfiguration({
    WOZTELL_ENABLED: "false",
    WOZTELL_BOT_ACCESS_TOKEN: "secret-canary",
    DATABASE_URL: "postgres://private-secret",
    WOZTELL_CHANNEL_ID: "private-channel",
  });
  assert.equal(JSON.stringify(result).includes("secret-canary"), false);
  assert.equal(JSON.stringify(result).includes("postgres://"), false);
  assert.equal(JSON.stringify(result).includes("private-channel"), false);
  const bot = result.find((row) => row.capability === "woztell.bot");
  assert.equal(bot.enabled, false);
  assert.equal(bot.verification, "unverified");
  assert.equal(bot.variables.find((v) => v.name === "WOZTELL_BOT_ACCESS_TOKEN").present, true);
});
test("release fails closed with missing or different-commit acceptance evidence", () => {
  const sha = "a".repeat(40);
  assert.equal(assessRelease({ commit: sha }).ready, false);
  const evidence = {
    commit: sha,
    ci: {
      commit: "b".repeat(40),
      status: "passed",
      url: "https://github.com/org/repo/actions/runs/123",
    },
  };
  assert.ok(assessRelease(evidence).missing.includes("ci.exactCommit"));
  assert.equal(assessRelease({ ...evidence, approved: "true" }).ready, false);
});
test("complete evidence is review-ready but never production authorization", () => {
  const sha = "a".repeat(40);
  const proof = { commit: sha, url: "https://example.test/evidence", status: "passed" };
  const result = assessRelease({
    commit: sha,
    ci: proof,
    preview: proof,
    databaseTarget: "disposable-branch",
    migrations: ["20260905110000_cms_atomic_mutations.sql"],
    testRecipients: "test-cohort-1",
    monitoringOwner: "release-oncall",
    backupRestoreProof: proof,
    rollbackAction: "redeploy previous immutable build and restore approved branch",
    acceptance: Object.fromEntries(
      [
        "emptySchema",
        "previousSchema",
        "staffScope",
        "draftIsolation",
        "leadLinks",
        "providerFailures",
        "providerCapabilities",
        "syncFreshness",
        "publicBrowser",
        "staffBrowser",
        "performance",
        "migrationDrift",
      ].map((k) => [k, proof]),
    ),
  });
  assert.deepEqual(result.missing, []);
  assert.equal(result.ready, true);
  assert.equal(result.productionAuthorized, false);
});
test("freshness uses sync evidence rather than historical listing dates", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  assert.equal(
    summarizeFreshness(
      {
        lastSuccessfulRunAt: "2026-09-05T11:00:00Z",
        lastContentObservedAt: "2026-09-05T11:00:00Z",
        latestListingDate: "2001-01-01",
      },
      now,
      7200000,
    ).status,
    "fresh",
  );
  assert.equal(
    summarizeFreshness({ latestListingDate: "2026-09-05" }, now, 7200000).status,
    "unverified",
  );
  assert.equal(
    summarizeFreshness(
      { lastSuccessfulRunAt: "2026-09-04", lastContentObservedAt: "2026-09-04" },
      now,
      7200000,
    ).status,
    "stale",
  );
});

test("GA4 inventory matches manual-events and measurement ID runtime gates", () => {
  const row = (env) => inventoryConfiguration(env).find((r) => r.capability === "analytics.ga4");
  assert.equal(row({ VITE_GA4_MEASUREMENT_ID: "G-ABCDEFGHIJ" }).enabled, false);
  assert.equal(
    row({ VITE_GA4_MEASUREMENT_ID: "G-ABCDE", VITE_GA4_MANUAL_EVENTS_CONFIRMED: "true" }).enabled,
    false,
  );
  assert.equal(
    row({ VITE_GA4_MEASUREMENT_ID: "G-ABCDEFGHIJ", VITE_GA4_MANUAL_EVENTS_CONFIRMED: "true" })
      .enabled,
    true,
  );
});

// Reserved fixture identities validate packet shape only; no provider is called.
const REMEDIATION_NOW = Date.parse("2026-10-04T13:45:00Z");
const REMEDIATION_SHA = "a".repeat(40);
const REMEDIATION_URL = "https://evidence.test/owned-run";
const remediationAssessment = (record) =>
  assessRelease(record, {
    nowMs: REMEDIATION_NOW,
    expectedCommit: REMEDIATION_SHA,
    migrationManifest: {
      names: ["20261003040000_content_proposal_source_guard.sql"],
      sha256: "c".repeat(64),
      latestVersion: "20261003040000",
    },
  });
function remediationPacket() {
  const legacyProof = { commit: REMEDIATION_SHA, status: "passed", url: REMEDIATION_URL };
  const proof = (scope) => ({
    ...legacyProof,
    scope,
    testedAt: new Date(REMEDIATION_NOW).toISOString(),
    sourceRevision: "fixture-source-revision-7",
  });
  const gates = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      "G" + String(i).padStart(2, "0"),
      { status: "READY", proof: proof("production") },
    ]),
  );
  gates.G01.proof.scope = "local";
  gates.G02.proof.scope = "local";
  gates.G03.proof.scope = "owned-postgres";
  gates.G10.proof.scope = "owned-postgres";
  gates.G00.deployment = {
    appCommit: REMEDIATION_SHA,
    workerRevision: "fixture-worker-revision",
    schemaVersion: "20261003040000",
    flagsRevision: "fixture-flags-revision",
  };
  gates.G04.canary = {
    realProvider: true,
    realAuth: true,
    scopesVerified: true,
    provider: "fixture-provider",
    channel: "fixture-channel",
    account: "fixture-account",
    recipients: [
      {
        kind: "staff-test",
        destinationRef: "fixture-staff-destination",
        consentVerified: true,
        windowOrTemplateVerified: true,
      },
      {
        kind: "customer-test",
        destinationRef: "fixture-customer-destination",
        consentVerified: true,
        windowOrTemplateVerified: true,
      },
    ],
    recipientCount: 2,
    maxSends: 5,
    actualSends: 3,
    receipt: { commit: REMEDIATION_SHA, status: "passed", url: REMEDIATION_URL, completedSends: 3 },
    unknownOutcomes: 0,
    approvalEvidence: REMEDIATION_URL,
  };
  gates.G05.canary = {
    provider: "fixture-provider",
    model: "fixture-model",
    modelReadbackEvidence: REMEDIATION_URL,
    cases: ["EV04", "EV05", "EV09", "EV11", "EV12"],
    repeatsPerCase: 3,
    maxAttemptsPerRun: 1,
    runCount: 15,
    passedRuns: 15,
    hardFailures: 0,
    totalBudgetUsd: 5,
    estimatedCostUsd: 1,
    usageKnown: true,
    budgetApproved: true,
    approvalEvidence: REMEDIATION_URL,
  };
  gates.G06.readback = { realPublicBrowser: true, canonical: true, aiFresh: true };
  gates.G07.coverage = {
    branches: ["EPS", "EPT", "EPW"],
    dtScopes: ["fixture-dt-range"],
    pageOneToTerminal: true,
    detailsVerified: true,
    mediaVerified: true,
    forbiddenResponses: 0,
    scopeReadbackEvidence: REMEDIATION_URL,
  };
  gates.G08.runs = Array.from({ length: 3 }, (_, i) => ({
    runId: 100 + i,
    runAttempt: 1,
    receiptRunId: 100 + i,
    receiptAttempt: 1,
    event: "schedule",
    conclusion: "success",
    commit: REMEDIATION_SHA,
    createdAt: new Date(REMEDIATION_NOW - (2 - i) * 86400000).toISOString(),
    fullReadback: true,
    privateReceipt: true,
    publishedReadback: true,
    receiptUrl: REMEDIATION_URL,
  }));
  gates.G09.proof.scope = "preview";
  gates.G09.roles = {
    realAuth: true,
    crossScopeVerified: true,
    roles: ["admin", "manager", "agent", "viewer"],
    viewports: [390, 768, 1280, 1440],
  };
  gates.G10.restore = {
    recordCounts: true,
    foreignKeys: true,
    receiptIdempotency: true,
    recentWritesRetained: true,
    workerRestart: true,
    cas: true,
    unknownOutcome: true,
  };
  gates.G11.coverage = {
    coreCases: 60,
    representativeActions: 68,
    sourceOccurrences: 1332,
    allApplicableMapped: true,
    unresolvedApplicable: 0,
    skips: 0,
  };
  return {
    recordKind: "earnest-admin-remediation/v1",
    commit: REMEDIATION_SHA,
    ci: legacyProof,
    preview: legacyProof,
    backupRestoreProof: legacyProof,
    databaseTarget: "owned-fixture-target",
    migrations: ["20261003040000_content_proposal_source_guard.sql"],
    testRecipients: "fixture-recipient-cohort",
    monitoringOwner: "fixture-release-owner",
    rollbackAction: "Stop new effects; retain capture, receipts and current writes",
    acceptance: Object.fromEntries(
      [
        "emptySchema",
        "previousSchema",
        "staffScope",
        "draftIsolation",
        "leadLinks",
        "providerFailures",
        "providerCapabilities",
        "syncFreshness",
        "publicBrowser",
        "staffBrowser",
        "performance",
        "migrationDrift",
      ].map((k) => [k, legacyProof]),
    ),
    migrationDryRun: {
      status: "passed",
      commit: REMEDIATION_SHA,
      url: REMEDIATION_URL,
      manifestSha256: "c".repeat(64),
      schemaCount: 1,
      appliedEnvironment: "owned-postgres",
      rollbackReadback: true,
    },
    rollback: {
      preserveCapture: true,
      preserveOutbound: true,
      preserveRecentWrites: true,
      blindResend: false,
      fullProductionRestore: false,
    },
    gates,
    requestedCapabilities: ["whatsapp"],
  };
}
test("admin remediation refuses synthetic provider and synthetic role proof while retaining local proof", () => {
  const packet = remediationPacket();
  packet.gates.G04.proof.scope = "synthetic-browser";
  packet.gates.G04.canary.realProvider = false;
  packet.gates.G09.proof.scope = "synthetic-browser";
  packet.gates.G09.roles.realAuth = false;
  const result = remediationAssessment(packet);
  assert.equal(result.ready, false);
  assert.equal(result.gates.G03.localStatus, "READY");
  assert.notEqual(result.capabilities.whatsapp.status, "READY");
  assert.equal(result.productionAuthorized, false);
});
test("admin remediation manual, replay and skip runs never satisfy native schedule acceptance", () => {
  for (const event of ["workflow_dispatch", "replay", "skipped"]) {
    const packet = remediationPacket();
    packet.requestedCapabilities = ["property28hse"];
    packet.gates.G08.runs.forEach((r) => (r.event = event));
    const result = remediationAssessment(packet);
    assert.equal(result.ready, false);
    assert.notEqual(result.gates.G08.releaseStatus, "READY");
  }
});
test("admin remediation schedule acceptance requires three unique Hong Kong days, exact revision and full receipts", () => {
  for (const mutate of [
    (p) => (p.gates.G08.runs[1].runId = 100),
    (p) => (p.gates.G08.runs[1].createdAt = p.gates.G08.runs[0].createdAt),
    (p) => (p.gates.G08.runs[1].commit = "b".repeat(40)),
    (p) => (p.gates.G08.runs[1].privateReceipt = false),
    (p) => (p.gates.G08.runs[1].publishedReadback = false),
  ]) {
    const packet = remediationPacket();
    packet.requestedCapabilities = ["property28hse"];
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation rejects stale, future or other-commit evidence", () => {
  for (const mutate of [
    (p) => (p.gates.G01.proof.testedAt = new Date(REMEDIATION_NOW - 86400001).toISOString()),
    (p) => (p.gates.G01.proof.testedAt = new Date(REMEDIATION_NOW + 1).toISOString()),
    (p) => (p.gates.G01.proof.commit = "b".repeat(40)),
    (p) => (p.commit = "b".repeat(40)),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation unknown statuses, scopes, gate IDs and capabilities fail closed", () => {
  for (const mutate of [
    (p) => (p.gates.G04.status = "PASS"),
    (p) => (p.gates.G04.proof.scope = "unknown"),
    (p) => (p.gates.G99 = p.gates.G04),
    (p) => (p.requestedCapabilities = ["send-now"]),
    (p) => (p.recordKind = "earnest-admin-remediation/v99"),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation missing cost or runtime identity cannot be model-canary READY", () => {
  for (const mutate of [
    (p) => (p.gates.G05.canary.provider = "UNKNOWN"),
    (p) => (p.gates.G05.canary.model = null),
    (p) => (p.gates.G05.canary.estimatedCostUsd = null),
    (p) => (p.gates.G05.canary.usageKnown = false),
    (p) => (p.gates.G05.canary.totalBudgetUsd = 6),
    (p) => (p.gates.G05.canary.runCount = 16),
    (p) => (p.gates.G05.canary.maxAttemptsPerRun = 2),
    (p) => (p.gates.G05.canary.budgetApproved = false),
  ]) {
    const packet = remediationPacket();
    packet.requestedCapabilities = ["crmAi"];
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation index-only or incomplete Property.hk cannot be full coverage", () => {
  for (const mutate of [
    (p) => (p.gates.G07.coverage.branches = ["EPS", "EPT"]),
    (p) => (p.gates.G07.coverage.pageOneToTerminal = false),
    (p) => (p.gates.G07.coverage.detailsVerified = false),
    (p) => (p.gates.G07.coverage.mediaVerified = false),
    (p) => (p.gates.G07.coverage.forbiddenResponses = 1),
  ]) {
    const packet = remediationPacket();
    packet.requestedCapabilities = ["propertyHk"];
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation Property.hk blocker does not block an independently evidenced core capability", () => {
  const packet = remediationPacket();
  packet.gates.G07 = { status: "BLOCKED", blocker: "Provider detail access not supplied" };
  packet.requestedCapabilities = ["propertyCore"];
  const result = remediationAssessment(packet);
  assert.equal(result.ready, true);
  assert.equal(result.capabilities.propertyHk.status, "BLOCKED");
  assert.equal(result.capabilities.propertyCore.status, "READY");
  assert.equal(result.productionAuthorized, false);
});
test("admin remediation candidate controls and skipped actions cannot be complete coverage", () => {
  for (const mutate of [
    (p) => (p.gates.G11.coverage.allApplicableMapped = false),
    (p) => (p.gates.G11.coverage.unresolvedApplicable = 1),
    (p) => (p.gates.G11.coverage.skips = 1),
    (p) => (p.gates.G11.coverage.sourceOccurrences = 1400),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation malformed envelopes are reported rather than crashing", () => {
  for (const value of [null, [], "unknown"]) {
    assert.doesNotThrow(() => remediationAssessment(value));
    assert.equal(remediationAssessment(value).ready, false);
  }
});
test("admin remediation validation never echoes recipients, model identifiers or credential-shaped input", () => {
  const packet = remediationPacket();
  packet.gates.G04.canary.channel = "private-channel-fixture";
  packet.gates.G05.canary.model = "private-model-fixture";
  packet.testRecipients = "private-recipient-fixture";
  const result = remediationAssessment(packet);
  assert.equal(result.ready, true);
  for (const value of [
    "private-channel-fixture",
    "private-model-fixture",
    "private-recipient-fixture",
  ])
    assert.equal(JSON.stringify(result).includes(value), false);
});

test("admin remediation contradictory or missing CI and preview proof fail closed", () => {
  for (const mutate of [
    (p) => (p.ci.status = "skipped"),
    (p) => (p.preview.commit = "b".repeat(40)),
    (p) => delete p.ci,
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation migration dry-run must match the independently supplied candidate manifest", () => {
  for (const mutate of [
    (p) => (p.migrations = ["20261003050000_invented.sql"]),
    (p) => (p.migrationDryRun.manifestSha256 = "d".repeat(64)),
    (p) => (p.migrationDryRun.schemaCount = 85),
    (p) => (p.gates.G00.deployment.schemaVersion = "20261003030000"),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation unassigned owner or destructive rollback cannot be review-ready", () => {
  for (const mutate of [
    (p) => (p.monitoringOwner = "UNASSIGNED"),
    (p) => (p.rollback.fullProductionRestore = true),
    (p) => (p.rollback.blindResend = true),
    (p) => (p.rollback.preserveRecentWrites = false),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});
test("admin remediation malformed capability objects and unknown role values cannot crash or pass", () => {
  for (const mutate of [
    (p) => (p.requestedCapabilities = [{ toString: null }]),
    (p) => p.gates.G09.roles.roles.push("unknown-role"),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.doesNotThrow(() => remediationAssessment(packet));
    assert.equal(remediationAssessment(packet).ready, false);
  }
});

test("admin remediation JSON date objects fail closed instead of crashing", () => {
  for (const mutate of [
    (p) => (p.gates.G01.proof.testedAt = { toString: null }),
    (p) => (p.gates.G08.runs[0].createdAt = { toString: null }),
  ]) {
    const packet = remediationPacket();
    packet.requestedCapabilities = ["property28hse"];
    mutate(packet);
    assert.doesNotThrow(() => remediationAssessment(packet));
    assert.equal(remediationAssessment(packet).ready, false);
  }
});

test("admin remediation zero-send preview or missing completed provider receipt cannot satisfy canary", () => {
  for (const mutate of [
    (p) => (p.gates.G04.canary.actualSends = 0),
    (p) => delete p.gates.G04.canary.receipt,
    (p) =>
      (p.gates.G04.canary.receipt = {
        commit: "b".repeat(40),
        status: "passed",
        url: REMEDIATION_URL,
        completedSends: 3,
      }),
    (p) =>
      (p.gates.G04.canary.receipt = {
        commit: REMEDIATION_SHA,
        status: "queued",
        url: REMEDIATION_URL,
        completedSends: 3,
      }),
    (p) =>
      (p.gates.G04.canary.receipt = {
        commit: REMEDIATION_SHA,
        status: "passed",
        url: REMEDIATION_URL,
        completedSends: 2,
      }),
  ]) {
    const packet = remediationPacket();
    mutate(packet);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});

test("admin remediation scheduled manual reruns or unbound receipt attempts are not native acceptance", () => {
  for (const mutate of [
    (r) => (r.runAttempt = 2),
    (r) => delete r.runAttempt,
    (r) => (r.receiptAttempt = 2),
    (r) => delete r.receiptAttempt,
    (r) => (r.receiptRunId = 999),
  ]) {
    const packet = remediationPacket();
    packet.requestedCapabilities = ["property28hse"];
    packet.gates.G08.runs.forEach(mutate);
    assert.equal(remediationAssessment(packet).ready, false);
  }
});

test("ai.gateway readiness no longer lists the embedding model", () => {
  const row = inventoryConfiguration({
    AI_GATEWAY_API_KEY: "fixture-key",
    AI_GATEWAY_MODEL: "fixture/model",
  }).find((r) => r.capability === "ai.gateway");
  assert.deepEqual(
    row.variables.map((v) => v.name),
    ["AI_GATEWAY_API_KEY", "AI_GATEWAY_MODEL"],
  );
  assert.equal(row.configured, true);
});
