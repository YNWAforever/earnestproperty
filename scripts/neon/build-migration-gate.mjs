#!/usr/bin/env node
// Runs as part of `prebuild`, right after scripts/check-required-env.mjs, so a
// Vercel deploy of code that needs migrations the database has never received
// fails the BUILD instead of shipping a site that 500s on first request.
//
// ## Why this exists
//
// On 2026-11-06 the blog CMS code was merged to `main` and Vercel deployed it,
// while the three migrations it depends on (20261105120000/140000/160000) were
// never applied to production. Nothing in the pipeline connected "this code
// needs that schema" to "the database does not have it":
//
//   - `npm run build` typechecks nothing about the live schema;
//   - the Migration drift workflow only runs on PUSH to main and only REPORTS,
//     so it went red after the deploy had already been created;
//   - the health check is pull-based (`/admin/operations`), so nobody looked.
//
// The result was `/blog`, all 112 article URLs, all 62 `/estate/<slug>` pages,
// `/estate-reviews` and `/sitemap.xml` returning 500/503 for two days, plus an
// admin articles tab stuck on a generic "operation not completed" message.
//
// `check:migration-drift` already answers the right question. It just answers it
// in the wrong place, after the fact. This gate asks it during the build, where
// a wrong answer still leaves the previous working deployment serving traffic.
//
// ## Fail-closed vs fail-open, deliberately
//
//   - Drift PROVEN (the database answered and is behind): block the build.
//   - Drift NOT provable (no URL configured, or Neon unreachable): warn and let
//     the build continue. Turning a database outage into a deploy freeze would
//     also block the deploy that carries the fix, and would make an unrelated
//     incident worse.
//
// So the gate only ever blocks on evidence, never on the absence of evidence.
//
// ## Scope
//
// Production Vercel builds enforce. Preview builds warn (a preview may legitimately
// point at an isolated branch database that has not been migrated yet). Local
// builds and CI skip unless MIGRATION_DRIFT_GATE is set explicitly.
//
// Escape hatch: MIGRATION_DRIFT_GATE=warn downgrades a production block to a
// warning, and =off skips entirely. Both are explicit, recorded in the build log,
// and exist for the case where the fix for a drift incident is itself the deploy.

import { pathToFileURL } from "node:url";

import {
  MIGRATION_VERSIONS,
  pendingMigrations,
} from "../../src/lib/control-plane/migration-versions.js";
import { formatDriftReport, resolveDatabaseUrl } from "./check-migration-drift.mjs";

export const GATE_MODE_ENV = "MIGRATION_DRIFT_GATE";

/**
 * Which posture this build gets.
 *
 * An explicit MIGRATION_DRIFT_GATE always wins, so an operator can override the
 * default without changing Vercel settings. Otherwise production enforces,
 * preview warns, everything else skips.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {"enforce" | "warn" | "off"}
 */
export function gateMode(env) {
  const explicit = env[GATE_MODE_ENV]?.trim().toLowerCase();
  if (explicit === "enforce" || explicit === "warn" || explicit === "off") return explicit;
  const vercelEnv = env.VERCEL_ENV?.trim();
  if (vercelEnv === "production") return "enforce";
  if (vercelEnv === "preview") return "warn";
  return "off";
}

/**
 * Decide what to do before touching a database.
 *
 * Pure so the matrix is testable without Neon, and so "we could not check" is a
 * decision rather than an accidental `undefined` connection attempt.
 *
 * @param {{ mode: "enforce" | "warn" | "off"; databaseUrl: string | null }} input
 * @returns {{ action: "skip"; reason: string } | { action: "check" }}
 */
export function gateDecision({ mode, databaseUrl }) {
  if (mode === "off") {
    return {
      action: "skip",
      reason:
        "MIGRATION_DRIFT_GATE is off (set it to `enforce` to check this build against the database)",
    };
  }
  if (!databaseUrl) {
    return {
      action: "skip",
      reason:
        "no DATABASE_URL/DATABASE_URL_UNPOOLED in this environment, so the schema this build expects cannot be verified",
    };
  }
  return { action: "check" };
}

/**
 * The message a blocked build prints. It has to name the files and the remedy,
 * because the person reading it is looking at a red Vercel build log and nothing
 * else.
 *
 * @param {readonly string[]} pending
 * @returns {string}
 */
export function blockedBuildMessage(pending) {
  return [
    "",
    `Build blocked (${GATE_MODE_ENV}=enforce): this code expects ${MIGRATION_VERSIONS.length} migrations but the target database is missing ${pending.length}.`,
    "",
    formatDriftReport(pending).message,
    "",
    "Why this is a build failure and not a warning: deploying code ahead of its schema",
    "is what took /blog, 62 estate pages and /sitemap.xml down on 2026-11-06.",
    "",
    `Emergency override (records the drift in the build log and deploys anyway): ${GATE_MODE_ENV}=warn`,
    "",
  ].join("\n");
}

async function main() {
  const mode = gateMode(process.env);
  const decision = gateDecision({ mode, databaseUrl: resolveDatabaseUrl(process.env) });

  if (decision.action === "skip") {
    console.log(`[migration-gate] skipped: ${decision.reason}`);
    return;
  }

  const databaseUrl = resolveDatabaseUrl(process.env);
  if (!databaseUrl) {
    // gateDecision already guaranteed this, but keep the narrowing explicit so a
    // future refactor cannot silently connect to `undefined`.
    console.log("[migration-gate] skipped: no database URL");
    return;
  }

  let applied;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(databaseUrl);
    const [{ table_exists: tableExists }] = await sql.query(
      "SELECT to_regclass('app_migrations') IS NOT NULL AS table_exists",
    );
    applied = tableExists ? await sql.query("SELECT version FROM app_migrations") : [];
  } catch (error) {
    // Deliberate fail-open, see the header. We could not prove drift, and a Neon
    // outage must not also become a deploy freeze.
    console.warn(
      `[migration-gate] could not verify the schema (${mode}); deploying unverified:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const pending = pendingMigrations(applied.map((row) => String(row.version)));
  if (pending.length === 0) {
    console.log(
      `[migration-gate] ok: all ${MIGRATION_VERSIONS.length} migrations are recorded in app_migrations.`,
    );
    return;
  }

  if (mode === "warn") {
    console.warn(blockedBuildMessage(pending).replace("Build blocked", "Build continuing"));
    return;
  }

  console.error(blockedBuildMessage(pending));
  process.exitCode = 1;
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
