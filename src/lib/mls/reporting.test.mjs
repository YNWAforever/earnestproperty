import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildRunArtifactObjects,
  pruneArtifacts,
  toCsvCell,
  writeRunArtifacts,
} from "./reporting.mjs";

async function makeTemporaryArtifactRoot() {
  return mkdtemp(path.join(os.tmpdir(), "earnest-mls-report-"));
}

function reportFixture() {
  return {
    runId: "run-1",
    scheduledFor: "2026-08-17",
    mode: "shadow",
    status: "shadow_healthy",
    evaluation: {
      sourceStatus: {
        old_site: { healthy: true, reasons: [], counts: { sale: 1, rent: 0 } },
        "28hse_agent_540": {
          healthy: true,
          reasons: [],
          counts: { sale: 1, rent: 0 },
        },
      },
      baselines: { old_site: { sale: 1 }, "28hse_agent_540": { sale: 1 } },
    },
    counts: {
      discovered: 2,
      parsed: 2,
      quarantined: 0,
      exactGroups: 1,
      new: 1,
      changed: 0,
      inactive: 0,
      reactivated: 0,
      retainedOverrideFields: 0,
      existingMediaReused: 0,
      mediaValidated: 2,
      mediaUploaded: 0,
      mediaRejected: 0,
      sourceFailures: 0,
    },
    observations: [
      {
        source: "old_site",
        externalId: "old-1",
        dealType: "sale",
        propertyNoRaw: "EP-1",
        propertyNoNormalized: "EP-1",
        matchKey: "sale:EP-1",
        fields: {
          title_zh: "測試單位",
          title_en: "Test unit",
          estate_slug: "test-estate",
          district_slug: "tsuen-wan",
          address: "1 Test Road",
          price: 12000000,
          rent: null,
          saleable_area: 500,
          gross_area: 650,
          bedrooms: 2,
          bathrooms: 1,
          floor: "12",
          orientation: "South",
          features: ["Balcony"],
          description: "<html>private description</html>",
        },
        rawFields: {
          view_count: "123",
          mortgage: "secret-token",
          school: "raw",
        },
        mediaCandidates: [],
        sourceUpdatedAt: "2026-08-17T01:00:00.000Z",
        validationState: "valid",
        quarantineReasons: [],
        contentHash: "a".repeat(64),
        sourceUrl:
          "https://www.earnestproperty.com/property-detail/old-1?token=test-token",
      },
    ],
    quarantines: [{ code: "diagnostic", reason: "none" }],
    proposals: [
      {
        kind: "new",
        canonical: {
          listing_no: "EP-1-L100-S",
          canonical_property_no: "EP-1",
          price: 12000000,
          status: "active",
        },
        links: [
          {
            source: "old_site",
            externalId: "old-1",
            dealType: "sale",
            matchKey: "sale:EP-1",
          },
        ],
        fields: [
          {
            fieldName: "price",
            changed: true,
            winningObservationId: "obs-1",
          },
        ],
        events: [
          {
            changeType: "new",
            fieldName: null,
            winningObservationId: "obs-1",
            newValue: { price: 12000000 },
          },
        ],
      },
    ],
    diagnostics: [
      {
        sourceUrl:
          "https://www.earnestproperty.com/robots.txt?api_key=secret-token",
        responseStatus: 200,
        attempts: 1,
        templateFingerprint: "fingerprint-1",
        selectorCounts: { listing: 1 },
        failureCode: null,
      },
    ],
    sourceStatus: {
      old_site: { diagnostics: [], failures: [] },
      "28hse_agent_540": { diagnostics: [], failures: [] },
    },
    failureSummary: "none",
  };
}

async function retentionFixture() {
  const root = await makeTemporaryArtifactRoot();
  const oldRun = path.join(
    root,
    "2026-05-01",
    "00000000-0000-4000-8000-000000000001",
  );
  const recentRun = path.join(
    root,
    "2026-08-01",
    "00000000-0000-4000-8000-000000000002",
  );
  const outsideSentinel = path.join(
    path.dirname(root),
    "earnest-mls-outside-sentinel",
  );
  await mkdir(oldRun, { recursive: true });
  await mkdir(recentRun, { recursive: true });
  await writeFile(path.join(oldRun, "report.json"), "{}\n");
  await writeFile(path.join(recentRun, "report.json"), "{}\n");
  await writeFile(outsideSentinel, "keep\n");
  return { root, oldRun, recentRun, outsideSentinel };
}

test("report artifacts contain provenance and decisions but no raw HTML or secrets", async () => {
  const root = await makeTemporaryArtifactRoot();
  try {
    const paths = await writeRunArtifacts({ root, run: reportFixture() });
    const json = JSON.parse(await readFile(paths.json, "utf8"));
    const csv = await readFile(paths.listingsCsv, "utf8");
    const observationsCsv = await readFile(paths.observationsCsv, "utf8");
    const diagnostics = JSON.parse(await readFile(paths.diagnostics, "utf8"));
    assert.equal(json.runId, "run-1");
    assert.match(
      csv,
      /source,external_id,deal_type,property_no,match_key,canonical_property_id,decision/,
    );
    assert.match(
      observationsCsv,
      /title_zh,title_en,estate_slug,district_slug,address,price,rent/,
    );
    assert.doesNotMatch(
      observationsCsv,
      /view_count|mortgage|school|transport|editorial/i,
    );
    assert.doesNotMatch(
      csv + "\n" + observationsCsv,
      /test-token|secret-token|private description|<html/i,
    );
    assert.doesNotMatch(
      JSON.stringify({ json, diagnostics }),
      /test-token|secret-token|postgres:|<html/i,
    );
    assert.equal(toCsvCell("=1+1"), "'=1+1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact serialization is deterministic and independent of storage", () => {
  const objects = buildRunArtifactObjects(reportFixture());
  assert.deepEqual(
    objects.map(({ name, contentType }) => [name, contentType]),
    [
      ["report.json", "application/json; charset=utf-8"],
      ["listings.csv", "text/csv; charset=utf-8"],
      ["observations.csv", "text/csv; charset=utf-8"],
      ["diagnostics.json", "application/json; charset=utf-8"],
    ],
  );
  assert.ok(Object.isFrozen(objects));
  assert.ok(objects.every(Object.isFrozen));
  assert.ok(
    objects.every(
      (object) => object.byteLength === Buffer.byteLength(object.body),
    ),
  );
  assert.ok(objects.every((object) => /^[0-9a-f]{64}$/.test(object.sha256)));
  assert.doesNotMatch(
    objects.map((object) => object.body).join("\n"),
    /secret-token|<html>/i,
  );
});

test("report serialization redacts complete Authorization credentials in summary and diagnostic details", () => {
  const run = reportFixture();
  run.failureSummary =
    "sync failed: Authorization: Bearer secret-token; retry remains safe";
  run.evaluation.sourceStatus.old_site.failures = [
    {
      code: "upstream_failed",
      detail:
        "remote failed: Authorization: Basic dXNlcjpzZWNyZXQ=; preserve this prose",
    },
  ];
  const objects = buildRunArtifactObjects(run);
  const report = JSON.parse(
    objects.find(({ name }) => name === "report.json").body,
  );
  const diagnostics = JSON.parse(
    objects.find(({ name }) => name === "diagnostics.json").body,
  );

  assert.equal(
    report.failureSummary,
    "sync failed: Authorization=[redacted]; retry remains safe",
  );
  assert.equal(
    diagnostics.at(-1).detail,
    "remote failed: Authorization=[redacted]; preserve this prose",
  );
  assert.doesNotMatch(
    JSON.stringify({ report, diagnostics }),
    /secret-token|dXNlcjpzZWNyZXQ=/i,
  );
});

test("report serialization redacts an entire Authorization value for every authentication scheme", () => {
  const run = reportFixture();
  run.failureSummary =
    "sync failed: Authorization: AWS4-HMAC-SHA256 Credential=AKIAFAKE/signature; retry remains safe";
  run.evaluation.sourceStatus.old_site.failures = [
    {
      code: "digest_failed",
      detail:
        "remote failed: Authorization: Digest username=alice, response=secret; preserve prose",
    },
    {
      code: "custom_failed",
      detail:
        "remote failed: Authorization: Custom token=opaque-value; preserve prose",
    },
  ];
  const objects = buildRunArtifactObjects(run);
  const report = JSON.parse(
    objects.find(({ name }) => name === "report.json").body,
  );
  const diagnostics = JSON.parse(
    objects.find(({ name }) => name === "diagnostics.json").body,
  );

  assert.equal(
    report.failureSummary,
    "sync failed: Authorization=[redacted]; retry remains safe",
  );
  assert.deepEqual(
    diagnostics.slice(-2).map(({ detail }) => detail),
    [
      "remote failed: Authorization=[redacted]; preserve prose",
      "remote failed: Authorization=[redacted]; preserve prose",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify({ report, diagnostics }),
    /AWS4-HMAC|Credential=|AKIAFAKE|username=alice|response=secret|opaque-value/i,
  );
});

test("diagnostic serialization preserves safe text after a redacted Authorization newline", () => {
  const run = reportFixture();
  run.evaluation.sourceStatus.old_site.failures = [
    {
      code: "upstream Authorization: Bearer code-secret",
      detail:
        "Authorization: Digest username=alice, response=secret\nsafe-after-newline",
    },
  ];
  const diagnostics = JSON.parse(
    buildRunArtifactObjects(run).find(({ name }) => name === "diagnostics.json")
      .body,
  );

  assert.deepEqual(diagnostics.at(-1), {
    code: "upstream Authorization=[redacted]",
    detail: "Authorization=[redacted] safe-after-newline",
  });
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /alice|response=secret|code-secret/i,
  );
});

test("retention removes only old run directories beneath the configured root", async () => {
  const fixture = await retentionFixture();
  try {
    const result = await pruneArtifacts({
      root: fixture.root,
      now: new Date("2026-08-17T02:00:00.000Z"),
      retentionDays: 90,
    });
    assert.deepEqual(result.removed, [fixture.oldRun]);
    await assert.doesNotReject(() =>
      readFile(path.join(fixture.recentRun, "report.json")),
    );
    await assert.doesNotReject(() => readFile(fixture.outsideSentinel));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.outsideSentinel, { force: true });
  }
});

test("retention rejects broad roots, traversal, and symlinks", async () => {
  await assert.rejects(
    () => pruneArtifacts({ root: "/", retentionDays: 90 }),
    /unsafe artifact root/i,
  );
  const root = await makeTemporaryArtifactRoot();
  const outside = await makeTemporaryArtifactRoot();
  try {
    const link = path.join(root, "2026-01-01");
    await symlink(outside, link, "junction");
    await assert.rejects(
      () => pruneArtifacts({ root, retentionDays: 90 }),
      /symlink|outside artifact root/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("sync CLI passes mode and environment flags through the lock and orchestrator", async () => {
  const source = await readFile(
    new URL("../../../scripts/mls/sync.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /--mode=shadow|mode/);
  assert.match(source, /MLS_PUBLISH_ENABLED/);
  assert.match(source, /MLS_MEDIA_RIGHTS_CONFIRMED/);
  assert.match(source, /withMlsAdvisoryLock/);
  assert.match(source, /runDualSourceSync/);
  assert.match(source, /DATABASE_URL_UNPOOLED/);
  assert.doesNotMatch(
    source,
    /console\.log\([^)]*(?:DATABASE_URL|BLOB_READ_WRITE_TOKEN|process\.env)/i,
  );
});
