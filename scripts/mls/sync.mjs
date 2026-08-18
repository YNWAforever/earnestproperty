import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { create28HseAgentSourceAdapter } from "../../src/lib/mls/sources/28hse-agent.mjs";
import { createOldSiteSourceAdapter } from "../../src/lib/mls/sources/old-site.mjs";
import {
  createFilesystemReporter,
  logRunEvent,
  pruneArtifacts,
  validateArtifactRoot,
} from "../../src/lib/mls/reporting.mjs";
import { createVercelBlobStore } from "../../src/lib/media/vercel-blob.mjs";
import { prepareListingMedia } from "../../src/lib/mls/media.mjs";
import { withMlsAdvisoryLock } from "../../src/lib/mls/neon-lock.mjs";
import { runDualSourceSync } from "../../src/lib/mls/orchestrator.mjs";
import { createSyncRepository } from "../../src/lib/mls/sync-repository.mjs";
import { MLS_PARSER_VERSION } from "../../src/lib/mls/source-contract.mjs";

export class MlsConfigurationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MlsConfigurationError";
    this.code = code;
  }
}

function literalTrue(value) {
  return value === "true";
}

function parseMode(argv = []) {
  let mode = "shadow";
  for (const argument of argv) {
    if (argument === "--mode=shadow") mode = "shadow";
    else if (argument === "--mode=publish") mode = "publish";
    else throw new MlsConfigurationError("invalid_mode");
  }
  return mode;
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new MlsConfigurationError(`missing_${name.toLowerCase()}`);
  return value;
}

function validateDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new MlsConfigurationError("invalid_database_url");
  }
  return value;
}

function validateContactUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      throw new Error("invalid contact URL");
    }
  } catch {
    throw new MlsConfigurationError("invalid_crawler_contact_url");
  }
  return value;
}

function parseMediaHosts(value) {
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0 || new Set(hosts).size !== hosts.length) {
    throw new MlsConfigurationError("invalid_media_allowed_hosts");
  }
  for (const host of hosts) {
    if (host.includes("/") || host.includes("@") || host.includes(":")) {
      throw new MlsConfigurationError("invalid_media_allowed_hosts");
    }
    try {
      const parsed = new URL(`https://${host}`);
      if (parsed.hostname !== host || parsed.pathname !== "/") {
        throw new Error("invalid host");
      }
    } catch {
      throw new MlsConfigurationError("invalid_media_allowed_hosts");
    }
  }
  return Object.freeze(hosts);
}

export async function loadEnvironmentFiles({ cwd = process.cwd() } = {}) {
  if (typeof process.loadEnvFile !== "function") return;
  for (const filename of [".env", ".env.local"]) {
    const file = path.join(cwd, filename);
    try {
      await access(file);
    } catch {
      continue;
    }
    process.loadEnvFile(file);
  }
}

export function readConfiguration(mode) {
  const databaseUrl = validateDatabaseUrl(requiredEnvironment("DATABASE_URL_UNPOOLED"));
  const contactUrl = validateContactUrl(requiredEnvironment("MLS_CRAWLER_CONTACT_URL"));
  const mediaAllowedHosts = parseMediaHosts(requiredEnvironment("MLS_MEDIA_ALLOWED_HOSTS"));
  const publishEnabled = literalTrue(process.env.MLS_PUBLISH_ENABLED);
  const mediaRightsConfirmed = literalTrue(process.env.MLS_MEDIA_RIGHTS_CONFIRMED);
  if (mode === "publish" && !publishEnabled) {
    throw new MlsConfigurationError("publication_disabled");
  }
  if (mode === "publish" && !mediaRightsConfirmed) {
    throw new MlsConfigurationError("media_rights_not_confirmed");
  }
  const blobToken = String(process.env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  if (mode === "publish" && !blobToken) {
    throw new MlsConfigurationError("missing_blob_read_write_token");
  }
  return Object.freeze({
    mode,
    databaseUrl,
    contactUrl,
    mediaAllowedHosts,
    publishEnabled,
    mediaRightsConfirmed,
    artifactRoot:
      String(process.env.MLS_ARTIFACT_DIR ?? "artifacts/mls-sync").trim() || "artifacts/mls-sync",
  });
}

export function scheduledForHongKong(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new TypeError("now is invalid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function installSignalHandlers(controller) {
  let interrupted = false;
  const handle = () => {
    if (interrupted) {
      process.exit(130);
      return;
    }
    interrupted = true;
    controller.abort(new Error("process_interrupted"));
  };
  process.once("SIGINT", handle);
  process.once("SIGTERM", handle);
  return () => {
    process.removeListener("SIGINT", handle);
    process.removeListener("SIGTERM", handle);
  };
}

function exitCodeForOutcome(outcome) {
  if (outcome?.kind === "lock_unavailable") return 75;
  if (outcome?.status === "shadow_healthy" || outcome?.status === "healthy") return 0;
  if (outcome?.status === "degraded") return 2;
  if (outcome?.status === "blocked") {
    return outcome.gate?.mode === "blocked" ? 20 : 30;
  }
  return 40;
}

export async function main(argv = process.argv.slice(2)) {
  let mode;
  let configuration;
  try {
    mode = parseMode(argv);
    await loadEnvironmentFiles();
    configuration = readConfiguration(mode);
  } catch (error) {
    logRunEvent({
      level: "error",
      event: "mls_configuration_rejected",
      code: error.code ?? "invalid_configuration",
    });
    return 30;
  }

  try {
    validateArtifactRoot(configuration.artifactRoot);
  } catch {
    logRunEvent({
      level: "error",
      event: "mls_configuration_rejected",
      code: "unsafe_artifact_root",
    });
    return 30;
  }

  let blobStore;
  try {
    blobStore =
      configuration.mode === "publish"
        ? createVercelBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN })
        : undefined;
  } catch {
    logRunEvent({
      level: "error",
      event: "mls_configuration_rejected",
      code: "invalid_blob_read_write_token",
    });
    return 30;
  }
  const now = new Date();
  const controller = new AbortController();
  let artifactPaths = null;
  const removeSignalHandlers = installSignalHandlers(controller);
  try {
    const locked = await withMlsAdvisoryLock({
      connectionString: configuration.databaseUrl,
      work: async (client) => {
        const repository = createSyncRepository({ client });
        const filesystemReporter = createFilesystemReporter({ root: configuration.artifactRoot });
        const reporter = {
          writeRunArtifacts: async (run) => {
            artifactPaths = await filesystemReporter.writeRunArtifacts(run);
            return artifactPaths;
          },
        };
        const oldSite = createOldSiteSourceAdapter({
          fetchImpl: globalThis.fetch,
          signal: controller.signal,
          now: () => now,
        });
        const hse28 = create28HseAgentSourceAdapter({
          fetchImpl: globalThis.fetch,
          signal: controller.signal,
          now: () => now,
        });
        const result = await runDualSourceSync({
          scheduledFor: scheduledForHongKong(now),
          mode: configuration.mode,
          publishEnabled: configuration.publishEnabled,
          mediaRightsConfirmed: configuration.mediaRightsConfirmed,
          mediaAllowedHosts: configuration.mediaAllowedHosts,
          blobStore,
          parserVersion: MLS_PARSER_VERSION,
          adapters: { oldSite, hse28 },
          repository,
          media: { prepareListingMedia },
          reporter,
          signal: controller.signal,
          now: () => now,
        });
        return { ...result, artifactPaths };
      },
    });
    if (locked?.kind === "lock_unavailable") {
      logRunEvent({ level: "warn", event: "mls_lock_unavailable", code: "lock_unavailable" });
      return 75;
    }
    try {
      await pruneArtifacts({ root: configuration.artifactRoot, retentionDays: 90 });
    } catch (error) {
      logRunEvent({
        level: "error",
        event: "mls_retention_failed",
        code: "artifact_retention_failed",
      });
      return 40;
    }
    logRunEvent({
      level: locked?.status === "healthy" || locked?.status === "shadow_healthy" ? "info" : "warn",
      event: "mls_run_finished",
      code: locked?.status ?? "unknown_status",
      runId: locked?.runId ?? null,
      counts: locked?.counts ?? {},
    });
    return exitCodeForOutcome(locked);
  } catch (error) {
    try {
      await pruneArtifacts({ root: configuration.artifactRoot, retentionDays: 90 });
    } catch {}
    logRunEvent({ level: "error", event: "mls_run_failed", code: error?.code ?? "mls_run_failed" });
    return 40;
  } finally {
    removeSignalHandlers();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
