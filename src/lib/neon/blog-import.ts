/**
 * Offline operations module. No application connection loader or server-function export.
 * The only constructor opens an inspected, loopback-only owned Docker target.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fingerprint } from "../blog/reconcile";
import type { DatabaseSnapshot, ImportPlan } from "../blog/reconcile";
import {
  assertPlan,
  captureBlogSnapshot,
  checkedReceipt,
  completeOwnedImport,
  mutateBlogImport,
  readReceipt,
} from "./blog-import-transaction";
import type { ImportReceipt } from "./blog-import-transaction";
import { captureBlogRelease, runBlogRelease } from "./blog-release-transaction";
import { readReleaseInputs } from "./blog-release-packet";
export type { ImportReceipt } from "./blog-import-transaction";
import { isOwnedPostgresImage } from "./owned-postgres-images";

type Row = Record<string, unknown>;
type Client = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  release: (discard?: boolean) => void;
};
type Pool = { connect: () => Promise<Client>; end: () => Promise<void> };
export type VerifiedImportTarget = Readonly<{
  identity: string;
  systemIdentifier: string;
  close: () => Promise<void>;
}>;
type Authorization = { planFingerprint: string; backupPath: string; backupSha256: string };
type TargetConfig = { containerId: string; targetIdentity: string; authorization?: Authorization };
const verified = new WeakMap<
  VerifiedImportTarget,
  { pool: Pool; config: TargetConfig; backup?: DatabaseSnapshot }
>();
function inspect(config: TargetConfig) {
  if (
    !/^[a-f0-9]{64}$/.test(config.containerId) ||
    config.targetIdentity !== "owned:" + config.containerId + ":postgres"
  )
    throw new Error("IMPORT_TARGET");
  const meta = JSON.parse(
    execFileSync("docker", ["inspect", config.containerId], { encoding: "utf8", timeout: 15000 }),
  )[0];
  const ports = meta.NetworkSettings.Ports["5432/tcp"];
  if (
    meta.Id !== config.containerId ||
    !/^\/earnest-remediation-qa-[a-f0-9-]+$/.test(meta.Name) ||
    !isOwnedPostgresImage(meta.Config.Image) ||
    !meta.State.Running ||
    ports?.length !== 1 ||
    ports[0].HostIp !== "127.0.0.1"
  )
    throw new Error("IMPORT_TARGET");
  return Number(ports[0].HostPort);
}
async function dbIdentity(client: Client) {
  const { rows } = await client.query(
    "SELECT system_identifier::text system_id,current_database() db,current_user usr FROM pg_control_system()",
  );
  if (rows[0]?.db !== "postgres" || rows[0]?.usr !== "postgres")
    throw new Error("IMPORT_TARGET_DATABASE");
  return String(rows[0].system_id);
}
export async function verifyImportTarget(config: TargetConfig): Promise<VerifiedImportTarget> {
  // Refuse even accidental URL configuration. Never read dotenv or application secrets.
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "TEST_DATABASE_URL",
    "CMS_TEST_DATABASE_URL",
    "ASTRA_TEST_DATABASE_URL",
  ])
    if (process.env[key]) throw new Error("IMPORT_REFUSES_URL_ENV");
  const port = inspect(config);
  const pg = createRequire(import.meta.url)("pg") as { Pool: new (config: object) => Pool };
  const pool = new pg.Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  try {
    const client = await pool.connect();
    let systemIdentifier: string;
    try {
      systemIdentifier = await dbIdentity(client);
    } finally {
      client.release();
    }
    let backup: DatabaseSnapshot | undefined;
    if (config.authorization) {
      const bytes = readFileSync(config.authorization.backupPath);
      if (createHash("sha256").update(bytes).digest("hex") !== config.authorization.backupSha256)
        throw new Error("IMPORT_BACKUP_DIGEST");
      backup = JSON.parse(bytes.toString("utf8")) as DatabaseSnapshot;
      if (
        backup.targetIdentity !== config.targetIdentity ||
        backup.systemIdentifier !== systemIdentifier ||
        fingerprint({
          targetIdentity: backup.targetIdentity,
          systemIdentifier: backup.systemIdentifier,
          tables: backup.tables,
        }) !== backup.fingerprint
      )
        throw new Error("IMPORT_BACKUP_TARGET");
    }
    const target = Object.freeze({
      identity: config.targetIdentity,
      systemIdentifier,
      close: async () => {
        verified.delete(target);
        await pool.end();
      },
    });
    verified.set(target, { pool, config: structuredClone(config), backup });
    return target;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
function state(target: VerifiedImportTarget) {
  const s = verified.get(target);
  if (!s) throw new Error("IMPORT_UNVERIFIED_TARGET");
  inspect(s.config);
  return s;
}
async function transaction<T>(
  target: VerifiedImportTarget,
  write: boolean,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const s = state(target),
    client = await s.pool.connect();
  try {
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if ((await dbIdentity(client)) !== target.systemIdentifier)
      throw new Error("IMPORT_TARGET_CHANGED");
    if (write) {
      await client.query("SELECT blog_lock()");
      // Protect against direct SQL writers as well as the cooperating CMS lock.
      await client.query(
        "LOCK TABLE articles,cms_content_revisions,blog_categories,blog_settings,blog_featured_articles,blog_legacy_category_map,blog_import_receipts IN SHARE ROW EXCLUSIVE MODE",
      );
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function snapshotDatabase(
  target: VerifiedImportTarget,
  pageSize = 100,
): Promise<DatabaseSnapshot> {
  return transaction(target, false, (client) => captureBlogSnapshot(client, target, pageSize));
}
export async function verifyImport(
  plan: ImportPlan,
  target: VerifiedImportTarget,
): Promise<ImportReceipt> {
  assertPlan(plan, target);
  return transaction(target, false, async (client) => {
    const receipt = await readReceipt(client, plan);
    if (!receipt) throw new Error("IMPORT_RECEIPT_MISSING");
    return checkedReceipt(client, target, plan, receipt);
  });
}
export async function applyImport(
  plan: ImportPlan,
  target: VerifiedImportTarget,
): Promise<ImportReceipt> {
  assertPlan(plan, target);
  const s = state(target),
    approval = s.config.authorization;
  if (!approval || approval.planFingerprint !== plan.fingerprint || !s.backup)
    throw new Error("IMPORT_APPROVAL");
  if (plan.conflicts.length || plan.unresolved.length) throw new Error("IMPORT_BLOCKED");
  if (!plan.inventory.database || plan.inventory.database.fingerprint !== s.backup.fingerprint)
    throw new Error("IMPORT_BACKUP_SNAPSHOT");
  return transaction(target, true, async (client) => {
    const prior = await readReceipt(client, plan);
    if (prior) return checkedReceipt(client, target, plan, prior);
    const before = await captureBlogSnapshot(client, target);
    if (before.fingerprint !== plan.inventory.database!.fingerprint)
      throw new Error("IMPORT_STALE");
    const result = await mutateBlogImport(client, plan, before);
    return completeOwnedImport(client, target, plan, approval.backupSha256, result);
  });
}

// Separate 95->98 rehearsal entry points. They can only use the original owned capability.
async function ownedReleaseTransaction<T>(
  target: VerifiedImportTarget,
  write: boolean,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await state(target).pool.connect();
  let committing = false;
  let discard = false;
  try {
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // Leave pg_catalog implicit so it precedes public for built-in resolution
    // while unqualified DDL still creates objects in public.
    await client.query(`SET LOCAL search_path TO public, pg_temp;
      SET LOCAL TIME ZONE 'UTC';
      SET LOCAL DateStyle TO 'ISO, YMD';
      SET LOCAL row_security TO off;
      SET LOCAL lock_timeout TO '2s';
      SET LOCAL statement_timeout TO '30s';
      SET LOCAL idle_in_transaction_session_timeout TO '10s';
      SET LOCAL transaction_timeout TO '90s'`);
    if ((await dbIdentity(client)) !== target.systemIdentifier)
      throw new Error("IMPORT_TARGET_CHANGED");
    const session = async () =>
      (
        await client.query(
          "SELECT session_user AS role, current_setting('server_version_num') AS version, pg_backend_pid() AS pid",
        )
      ).rows[0];
    const before = await session();
    if (before.role !== "postgres" || before.version !== "180006")
      throw new Error("RELEASE_OWNED_PG18_6_REQUIRED");
    const result = await run(client);
    const after = await session();
    if (after.pid !== before.pid || after.role !== before.role || after.version !== before.version)
      throw new Error("RELEASE_SESSION");
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // If COMMIT was sent, its outcome is ambiguous. Discard the session and let a
    // fresh invocation resolve the matching durable receipt under the same locks.
    discard = committing;
    if (!committing) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export function snapshotOwnedBlogRelease(
  target: VerifiedImportTarget,
  phase: "baseline" | "migrated",
) {
  return ownedReleaseTransaction(target, false, (client) =>
    captureBlogRelease(client, target, phase),
  );
}

export async function applyOwnedBlogRelease(
  target: VerifiedImportTarget,
  packetBytes: Uint8Array,
  expectedPacketSha256: string,
  sourceBytes: Uint8Array,
) {
  state(target);
  const inputs = readReleaseInputs(target, packetBytes, expectedPacketSha256, sourceBytes);
  return ownedReleaseTransaction(target, true, (client) => runBlogRelease(client, target, inputs));
}
