import { readFileSync } from "node:fs";
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
  [
    "ai.gateway",
    "AI Gateway project settings",
    [["AI_GATEWAY_API_KEY"], ["AI_GATEWAY_MODEL"], ["AI_GATEWAY_EMBEDDING_MODEL"]],
  ],
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
export function assessRelease(record = {}) {
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
  const result = {
    scope: "current-process-environment-only",
    configuration: inventoryConfiguration(process.env),
    release: assessRelease(evidence),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.release.ready) process.exitCode = 2;
}
