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
