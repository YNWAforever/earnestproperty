import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Names and operator sources only. Credential values never leave this boundary.
export const CONFIGURATION = [
  [
    "neon.database",
    "Neon project / branch connection settings",
    [["DATABASE_URL_UNPOOLED", "DATABASE_URL"]],
  ],
  ["neon.auth", "Neon Auth project settings", [["NEON_AUTH_BASE_URL"], ["VITE_NEON_AUTH_URL"]]],
  [
    "woztell.bot",
    "WozTell channel and Bot API settings",
    [["WOZTELL_BOT_ACCESS_TOKEN"], ["WOZTELL_CHANNEL_ID"], ["WOZTELL_CHANNEL_SECRET"]],
    "WOZTELL_ENABLED",
  ],
  [
    "woztell.history",
    "WozTell Open API settings",
    [["WOZTELL_OPEN_API_TOKEN"], ["WOZTELL_CHANNEL_ID"]],
    "WOZTELL_ENABLED",
  ],
  ["blob", "Vercel Blob store token", [["BLOB_READ_WRITE_TOKEN"]]],
  [
    "mls.r2",
    "Cloudflare account and restricted R2 API token",
    [
      ["CLOUDFLARE_ACCOUNT_ID"],
      ["MLS_EVIDENCE_BUCKET"],
      ["MLS_R2_ACCESS_KEY_ID"],
      ["MLS_R2_SECRET_ACCESS_KEY"],
    ],
  ],
  [
    "mls.publication",
    "Operator media-rights and publication approval",
    [["MLS_PUBLISH_ENABLED"], ["MLS_MEDIA_RIGHTS_CONFIRMED"]],
    "MLS_PUBLISH_ENABLED",
  ],
  ["youtube", "Google Cloud YouTube API credential", [["YOUTUBE_API_KEY"]]],
  ["ai.gateway", "AI Gateway project settings", [["AI_GATEWAY_API_KEY"], ["AI_GATEWAY_MODEL"]]],
  [
    "ai.copilot",
    "OpenCode Go provider settings",
    [["OPENCODE_GO_API_KEY"], ["OPENCODE_GO_BASE_URL"], ["OPENCODE_GO_MODEL"]],
  ],
  ["ai.research", "Tavily provider settings", [["TAVILY_API_KEY"]]],
  [
    "analytics.ga4",
    "GA4 web data stream measurement ID",
    [["VITE_GA4_MEASUREMENT_ID"], ["VITE_GA4_MANUAL_EVENTS_CONFIRMED"]],
  ],
  [
    "operations",
    "Server-only cron and approval configuration",
    [["CRON_SECRET"], ["CONTROL_PLANE_APPROVAL_SECRET"]],
  ],
];
export function inventoryConfiguration(env = {}) {
  const present = (name) => typeof env[name] === "string" && env[name].trim().length > 0;
  return CONFIGURATION.map(([capability, source, groups, flag]) => {
    const variables = groups.flat().map((name) => ({ name, source, present: present(name) }));
    let configured = groups.every((names) => names.some(present));
    if (capability === "analytics.ga4")
      configured =
        /^G-[A-Z0-9]{10,16}$/.test(env.VITE_GA4_MEASUREMENT_ID ?? "") &&
        env.VITE_GA4_MANUAL_EVENTS_CONFIRMED === "true";
    if (capability === "mls.publication")
      configured = env.MLS_MEDIA_RIGHTS_CONFIRMED === "true" && env.MLS_PUBLISH_ENABLED === "true";
    return {
      capability,
      variables,
      configured,
      enabled: flag ? env[flag] === "true" : configured,
      verification: "unverified",
    };
  });
}
const GATES = [
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
];
const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
};
export const REMEDIATION_RECORD_KIND = "earnest-admin-remediation/v1";
const REMEDIATION_SCOPES = {
  G00: ["production"],
  G01: ["local", "preview"],
  G02: ["local", "owned-postgres", "preview"],
  G03: ["owned-postgres", "preview", "production"],
  G04: ["provider", "production"],
  G05: ["provider", "production"],
  G06: ["preview", "production"],
  G07: ["provider", "production"],
  G08: ["production"],
  G09: ["preview", "production"],
  G10: ["owned-postgres", "preview", "production"],
  G11: ["preview", "production"],
};
const PACKET_SCOPES = new Set([
  "local",
  "owned-postgres",
  "synthetic-browser",
  "preview",
  "provider",
  "production",
]);
const CAPABILITY_GATES = {
  aiSafety: ["G00", "G01", "G02", "G09", "G10", "G11"],
  crmAi: ["G00", "G01", "G02", "G05", "G09", "G10", "G11"],
  whatsapp: ["G00", "G01", "G03", "G04", "G09", "G10", "G11"],
  propertyCore: ["G00", "G01", "G06", "G09", "G10", "G11"],
  property28hse: ["G00", "G01", "G06", "G08", "G09", "G10", "G11"],
  propertyHk: ["G00", "G01", "G06", "G07", "G09", "G10", "G11"],
};
const objectRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const knownText = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 500 &&
  !/^(unknown|unverified|unassigned|tbd|none|null|n\/a)(?:$|[:\s])/i.test(value.trim());
const exactSha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const packetTimestamp = (value) => (typeof value === "string" ? Date.parse(value) : NaN);
const hongKongDay = (timestamp) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);

// Derive candidate schema identity from immutable Git blobs, never the worktree
// or a version supplied by the packet. No database is contacted or modified.
export function readCandidateMigrationManifest(commit, cwd = process.cwd()) {
  if (!exactSha(commit)) return null;
  try {
    const tree = execFileSync("git", ["ls-tree", "-r", "-z", commit, "--", "neon/migrations"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    const entries = tree
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const match =
          /^100644 blob ([a-f0-9]{40})\tneon\/migrations\/(\d{14}_[a-z0-9_]+\.sql)$/.exec(line);
        return match ? { name: match[2], blob: match[1] } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!entries.length) return null;
    return {
      names: entries.map((e) => e.name),
      sha256: createHash("sha256")
        .update(entries.map((e) => `${e.name} ${e.blob}\n`).join(""))
        .digest("hex"),
      latestVersion: entries.at(-1).name.slice(0, 14),
    };
  } catch {
    return null;
  }
}

// Validate an operator evidence packet. This performs no live verification,
// provider call, send, migration or authorization; local proof stays local.
export function assessRemediationRelease(record, context = {}) {
  const missing = [],
    gates = {},
    now = context.nowMs ?? Date.now();
  if (!exactSha(record.commit)) missing.push("commit");
  if (!exactSha(context.expectedCommit) || record.commit !== context.expectedCommit)
    missing.push("expectedCommit");
  if (!finite(now)) missing.push("assessmentClock");
  const sha = record.commit;
  for (const key of ["ci", "preview", "migrationDryRun"]) {
    const proof = objectRecord(record[key]) ? record[key] : {};
    if (proof.status !== "passed") missing.push(key + ".passed");
    if (!exactSha(sha) || proof.commit !== sha) missing.push(key + ".exactCommit");
    if (!safeUrl(proof.url)) missing.push(key + ".evidenceUrl");
  }
  const manifest = context.migrationManifest;
  const validManifest =
    objectRecord(manifest) &&
    Array.isArray(manifest.names) &&
    manifest.names.length > 0 &&
    new Set(manifest.names).size === manifest.names.length &&
    manifest.names.every(
      (name) => typeof name === "string" && /^\d{14}_[a-z0-9_]+\.sql$/.test(name),
    ) &&
    manifest.names.every((name, i) => i === 0 || manifest.names[i - 1] < name) &&
    /^[a-f0-9]{64}$/.test(manifest.sha256 ?? "") &&
    manifest.latestVersion === manifest.names.at(-1).slice(0, 14);
  if (!validManifest) missing.push("migrationManifest.independentCandidate");
  if (
    !validManifest ||
    !Array.isArray(record.migrations) ||
    record.migrations.length !== manifest.names.length ||
    record.migrations.some((name, i) => name !== manifest.names[i])
  )
    missing.push("migrations.candidateManifest");
  const dryRun = objectRecord(record.migrationDryRun) ? record.migrationDryRun : {};
  if (
    !validManifest ||
    dryRun.manifestSha256 !== manifest.sha256 ||
    dryRun.schemaCount !== manifest.names.length ||
    dryRun.appliedEnvironment !== "owned-postgres" ||
    dryRun.rollbackReadback !== true
  )
    missing.push("migrationDryRun.ownedCandidateReadback");
  for (const key of ["databaseTarget", "monitoringOwner", "rollbackAction"])
    if (!knownText(record[key])) missing.push(key);
  const rollback = objectRecord(record.rollback) ? record.rollback : {};
  if (
    ["preserveCapture", "preserveOutbound", "preserveRecentWrites"].some(
      (key) => rollback[key] !== true,
    ) ||
    rollback.blindResend !== false ||
    rollback.fullProductionRestore !== false
  )
    missing.push("rollback.safeRecovery");
  const inputGates = objectRecord(record.gates) ? record.gates : {};
  if (Object.keys(inputGates).some((key) => !Object.hasOwn(REMEDIATION_SCOPES, key)))
    missing.push("gates.unknownGate");
  const requested = record.requestedCapabilities;
  if (
    !Array.isArray(requested) ||
    !requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((key) => typeof key !== "string" || !Object.hasOwn(CAPABILITY_GATES, key))
  )
    missing.push("requestedCapabilities");
  for (const [id, requiredScopes] of Object.entries(REMEDIATION_SCOPES)) {
    const gate = objectRecord(inputGates[id]) ? inputGates[id] : {};
    const errors = [],
      releaseErrors = [];
    if (!["READY", "NOT_READY", "BLOCKED"].includes(gate.status)) errors.push("status");
    if (gate.status !== "READY") {
      if (!knownText(gate.blocker)) errors.push("blocker");
      gates[id] = {
        localStatus: errors.length ? "BLOCKED" : gate.status,
        releaseStatus: errors.length ? "BLOCKED" : gate.status,
        blockers: errors,
      };
      continue;
    }
    const proof = objectRecord(gate.proof) ? gate.proof : {};
    if (proof.status !== "passed") errors.push("proof.passed");
    if (!exactSha(sha) || proof.commit !== sha) errors.push("proof.exactCommit");
    if (!safeUrl(proof.url)) errors.push("proof.evidenceUrl");
    if (!PACKET_SCOPES.has(proof.scope)) errors.push("proof.scope");
    const testedAt = packetTimestamp(proof.testedAt);
    if (!Number.isFinite(testedAt) || !finite(now) || testedAt > now || now - testedAt > 86400000)
      errors.push("proof.freshness");
    if (id !== "G01" && !knownText(proof.sourceRevision)) errors.push("proof.sourceRevision");
    if (!requiredScopes.includes(proof.scope)) releaseErrors.push("release.evidenceLayer");
    const require = (condition, key) => {
      if (!condition) releaseErrors.push(key);
    };
    if (requiredScopes.includes(proof.scope)) {
      if (id === "G00") {
        const d = gate.deployment ?? {};
        require(d.appCommit === sha &&
          knownText(d.workerRevision) &&
          validManifest &&
          d.schemaVersion === manifest.latestVersion &&
          knownText(d.flagsRevision), "deployment.alignment");
      }
      if (id === "G04") {
        const c = gate.canary ?? {},
          recipients = c.recipients;
        require(c.realProvider === true &&
          c.realAuth === true &&
          c.scopesVerified === true, "canary.verifiedProviderScope");
        require([c.provider, c.channel, c.account].every(knownText) &&
          safeUrl(c.approvalEvidence), "canary.identityAndApproval");
        require(Number.isSafeInteger(c.recipientCount) &&
          c.recipientCount > 0 &&
          c.recipientCount <= 2 &&
          Array.isArray(recipients) &&
          recipients.length === c.recipientCount &&
          new Set(recipients.map((r) => r?.destinationRef)).size === recipients.length &&
          recipients.every(
            (r) =>
              ["staff-test", "customer-test"].includes(r?.kind) &&
              knownText(r?.destinationRef) &&
              r?.consentVerified === true &&
              r?.windowOrTemplateVerified === true,
          ), "canary.recipients");
        require(Number.isSafeInteger(c.maxSends) &&
          c.maxSends > 0 &&
          c.maxSends <= 5 &&
          Number.isSafeInteger(c.actualSends) &&
          c.actualSends > 0 &&
          c.actualSends <= c.maxSends &&
          c.unknownOutcomes === 0, "canary.boundedKnownOutcome");
      }
      if (id === "G04") {
        const c = gate.canary ?? {};
        const receipt = objectRecord(c.receipt) ? c.receipt : {};
        require(receipt.status === "passed" &&
          receipt.commit === sha &&
          safeUrl(receipt.url) &&
          receipt.completedSends === c.actualSends, "canary.completedReceipt");
      }
      if (id === "G05") {
        const c = gate.canary ?? {};
        require(knownText(c.provider) &&
          knownText(c.model) &&
          safeUrl(c.modelReadbackEvidence), "model.runtimeIdentity");
        require(c.budgetApproved === true &&
          safeUrl(c.approvalEvidence) &&
          c.usageKnown === true &&
          finite(c.totalBudgetUsd) &&
          c.totalBudgetUsd > 0 &&
          c.totalBudgetUsd <= 5 &&
          finite(c.estimatedCostUsd) &&
          c.estimatedCostUsd >= 0 &&
          c.estimatedCostUsd <= c.totalBudgetUsd, "model.knownApprovedBudget");
        require(Array.isArray(c.cases) &&
          c.cases.length === 5 &&
          ["EV04", "EV05", "EV09", "EV11", "EV12"].every((v) => c.cases.includes(v)) &&
          c.repeatsPerCase === 3 &&
          c.maxAttemptsPerRun === 1 &&
          c.runCount === 15 &&
          c.passedRuns === 15 &&
          c.hardFailures === 0, "model.boundedRubricRuns");
      }
      if (id === "G06") {
        const readback = gate.readback ?? {};
        require(readback.realPublicBrowser === true &&
          readback.canonical === true &&
          readback.aiFresh === true, "public.canonicalAndFreshAiReadback");
      }
      if (id === "G07") {
        const c = gate.coverage ?? {};
        require(Array.isArray(c.branches) &&
          c.branches.length === 3 &&
          ["EPS", "EPT", "EPW"].every((b) => c.branches.includes(b)) &&
          Array.isArray(c.dtScopes) &&
          c.dtScopes.length > 0 &&
          c.dtScopes.every(knownText) &&
          safeUrl(c.scopeReadbackEvidence), "propertyHk.branchAndDtScope");
        require(c.pageOneToTerminal === true &&
          c.detailsVerified === true &&
          c.mediaVerified === true &&
          c.forbiddenResponses === 0, "propertyHk.fullDetailMedia");
      }
      if (id === "G08") {
        const runs = Array.isArray(gate.runs) ? gate.runs : [],
          dates = new Set(),
          ids = new Set();
        let complete = runs.length === 3;
        for (const run of runs) {
          const time = packetTimestamp(run?.createdAt);
          if (
            !run ||
            run.event !== "schedule" ||
            run.conclusion !== "success" ||
            run.commit !== sha ||
            run.runAttempt !== 1 ||
            run.receiptAttempt !== 1 ||
            run.receiptRunId !== run.runId ||
            !Number.isSafeInteger(run.runId) ||
            run.runId <= 0 ||
            !Number.isFinite(time) ||
            time > now ||
            now - time > 3 * 86400000 ||
            run.fullReadback !== true ||
            run.privateReceipt !== true ||
            run.publishedReadback !== true ||
            !safeUrl(run.receiptUrl)
          )
            complete = false;
          if (Number.isFinite(time)) dates.add(hongKongDay(time));
          ids.add(run?.runId);
        }
        require(complete &&
          dates.size === 3 &&
          ids.size === 3, "nativeSchedule.threeDistinctFullRuns");
      }
      if (id === "G09") {
        const c = gate.roles ?? {};
        require(c.realAuth === true &&
          c.crossScopeVerified === true &&
          Array.isArray(c.roles) &&
          c.roles.length === 4 &&
          ["admin", "manager", "agent", "viewer"].every((v) => c.roles.includes(v)) &&
          Array.isArray(c.viewports) &&
          c.viewports.length === 4 &&
          [390, 768, 1280, 1440].every((v) =>
            c.viewports.includes(v),
          ), "roles.realAuthCrossScopeAndDevices");
      }
      if (id === "G10") {
        const c = gate.restore ?? {};
        require([
          "recordCounts",
          "foreignKeys",
          "receiptIdempotency",
          "recentWritesRetained",
          "workerRestart",
          "cas",
          "unknownOutcome",
        ].every((k) => c[k] === true), "restore.casReplayAndRecentWrites");
      }
      if (id === "G11") {
        const c = gate.coverage ?? {};
        require(c.coreCases === 60 &&
          c.representativeActions === 68 &&
          c.sourceOccurrences === 1332 &&
          c.allApplicableMapped === true &&
          c.unresolvedApplicable === 0 &&
          c.skips === 0, "coverage.originalDenominatorsAndMappedActions");
      }
    }
    gates[id] = {
      localStatus: errors.length ? "BLOCKED" : "READY",
      releaseStatus: errors.length ? "BLOCKED" : releaseErrors.length ? "NOT_READY" : "READY",
      blockers: [...errors, ...releaseErrors],
    };
  }
  const capabilities = {};
  for (const [id, dependencies] of Object.entries(CAPABILITY_GATES)) {
    const statuses = dependencies.map((g) => gates[g].releaseStatus);
    capabilities[id] = {
      status:
        missing.length || statuses.includes("BLOCKED")
          ? "BLOCKED"
          : statuses.includes("NOT_READY")
            ? "NOT_READY"
            : "READY",
      gates: dependencies,
      blockers: [
        ...missing,
        ...dependencies.flatMap((g) =>
          gates[g].releaseStatus === "READY" ? [] : [g + ":" + gates[g].releaseStatus],
        ),
      ],
    };
  }
  return {
    ready:
      missing.length === 0 &&
      Array.isArray(requested) &&
      requested.length > 0 &&
      requested.every((k) => capabilities[k]?.status === "READY"),
    productionAuthorized: false,
    assessment: "operator-evidence-packet-only",
    missing,
    gates,
    capabilities,
  };
}

export function assessRelease(record = {}, context = {}) {
  if (!objectRecord(record))
    return { ready: false, productionAuthorized: false, missing: ["record"] };
  if (record.recordKind !== undefined) {
    if (record.recordKind !== REMEDIATION_RECORD_KIND)
      return { ready: false, productionAuthorized: false, missing: ["recordKind"] };
    return assessRemediationRelease(record, context);
  }
  const missing = [];
  const sha =
    typeof record.commit === "string" && /^[a-f0-9]{40}$/.test(record.commit)
      ? record.commit
      : null;
  if (!sha) missing.push("commit");
  const proof = (value, key) => {
    if (!value || value.status !== "passed") missing.push(key + ".passed");
    if (!sha || value?.commit !== sha) missing.push(key + ".exactCommit");
    if (!safeUrl(value?.url)) missing.push(key + ".evidenceUrl");
  };
  proof(record.ci, "ci");
  proof(record.preview, "preview");
  proof(record.backupRestoreProof, "backupRestoreProof");
  for (const gate of GATES) proof(record.acceptance?.[gate], "acceptance." + gate);
  for (const key of ["databaseTarget", "testRecipients", "monitoringOwner", "rollbackAction"]) {
    if (typeof record[key] !== "string" || !record[key].trim() || record[key].length > 500)
      missing.push(key);
  }
  if (
    !Array.isArray(record.migrations) ||
    record.migrations.length === 0 ||
    record.migrations.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name))
  )
    missing.push("migrations");
  // A complete evidence packet is ready for human review, never authorization.
  return { ready: missing.length === 0, productionAuthorized: false, missing };
}
export function summarizeFreshness(evidence = {}, now = Date.now(), maxAgeMs = 86400000) {
  const run = Date.parse(evidence.lastSuccessfulRunAt),
    content = Date.parse(evidence.lastContentObservedAt);
  if (
    !Number.isFinite(run) ||
    !Number.isFinite(content) ||
    run > now ||
    content > now ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0
  )
    return { status: "unverified" };
  return {
    status: now - run <= maxAgeMs && now - content <= maxAgeMs ? "fresh" : "stale",
    runAgeMs: now - run,
    contentAgeMs: now - content,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidenceIndex = process.argv.indexOf("--evidence");
  let evidence = {};
  if (evidenceIndex !== -1) {
    try {
      evidence = JSON.parse(readFileSync(process.argv[evidenceIndex + 1], "utf8"));
    } catch {
      console.error("INVALID_RELEASE_EVIDENCE_FILE");
      process.exit(2);
    }
  }
  const expectedIndex = process.argv.indexOf("--expected-commit");
  const expectedCommit = expectedIndex < 0 ? undefined : process.argv[expectedIndex + 1];
  const result = {
    scope: "current-process-environment-only",
    configuration: inventoryConfiguration(process.env),
    release: assessRelease(evidence, {
      expectedCommit,
      migrationManifest:
        evidence?.recordKind === REMEDIATION_RECORD_KIND
          ? readCandidateMigrationManifest(expectedCommit)
          : undefined,
    }),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.release.ready) process.exitCode = 2;
}
