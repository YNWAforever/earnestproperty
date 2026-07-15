import type { StaffAccess } from "../neon/auth.server.ts";
import type { OperationContext } from "./request-context.ts";
import { mapControlPlaneError } from "./errors.ts";
import {
  issueMigrationApproval,
  verifyMigrationApproval,
} from "./migration-approval.ts";
import {
  listRegisteredMigrations,
  type RegisteredMigration,
} from "./migration-registry.server.ts";

type QueryRows = <T extends Record<string, unknown> = Record<string, unknown>>(
  statement: string,
  params?: unknown[],
) => Promise<T[]>;

type TransactionRows = (
  statements: readonly { statement: string; params?: unknown[] }[],
  options?: { isolationLevel?: "ReadUncommitted" | "ReadCommitted" | "RepeatableRead" | "Serializable" },
) => Promise<Record<string, unknown>[][]>;

type AuditWriter = (input: {
  actor: StaffAccess;
  permission: "system.migrations.apply";
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  context: OperationContext;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export type MigrationServiceDependencies = {
  registry?: readonly RegisteredMigration[];
  queryRows?: QueryRows;
  transactionRows?: TransactionRows;
  writeAudit?: AuditWriter;
  approvalSecret?: string;
  now?: () => number;
};

export type MigrationState = {
  id: string;
  checksum: string;
  dependencies: string[];
  summary: string;
  postconditions: RegisteredMigration["postconditions"];
  status: "pending" | "applied" | "drift";
};

const requiredSchema = {
  app_migrations: ["version", "applied_at"],
  staff_users: ["id"],
  staff_roles: ["staff_user_id", "role"],
  ops_audit_logs: ["id", "permission", "action", "outcome", "request_id", "metadata"],
  ops_jobs: ["id", "job_type", "payload_version", "status", "idempotency_key"],
  ops_job_attempts: ["id", "job_id", "attempt_number", "outcome"],
  ops_migration_runs: ["id", "migration_id", "checksum", "schema_fingerprint", "result"],
} as const;

function serviceError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

async function resolveDependencies(deps: MigrationServiceDependencies) {
  const db = deps.queryRows && deps.transactionRows ? null : await import("../neon/db.server.ts");
  const audit = deps.writeAudit ? null : await import("./audit.server.ts");
  return {
    registry: await listRegisteredMigrations(deps.registry),
    queryRows: deps.queryRows ?? (db?.queryRows as QueryRows),
    transactionRows: deps.transactionRows ?? (db?.transactionRows as TransactionRows),
    writeAudit: deps.writeAudit ?? (audit?.writeAudit as AuditWriter),
  };
}

export async function listMigrationStates(
  deps: Pick<MigrationServiceDependencies, "registry" | "queryRows"> = {},
): Promise<MigrationState[]> {
  const resolved = await resolveDependencies(deps);
  const [appliedRows, runRows] = await Promise.all([
    resolved.queryRows<{ version: unknown }>("SELECT version FROM app_migrations"),
    resolved.queryRows<{ migration_id: unknown; checksum: unknown }>(
      "SELECT DISTINCT ON (migration_id) migration_id, checksum FROM ops_migration_runs WHERE result = 'succeeded' ORDER BY migration_id, finished_at DESC NULLS LAST, id DESC",
    ),
  ]);
  const applied = new Set(appliedRows.map((row) => String(row.version)));
  const runChecksums = new Map(
    runRows.map((row) => [String(row.migration_id), String(row.checksum)]),
  );
  return resolved.registry.map((migration) => {
    const record = {
      id: migration.id,
      checksum: migration.checksum,
      dependencies: [...migration.dependencies],
      summary: migration.summary,
      postconditions: migration.postconditions.map((item) => ({ ...item })),
    };
    if (
      runChecksums.has(migration.id) && runChecksums.get(migration.id) !== migration.checksum
    ) {
      return { ...record, status: "drift" as const };
    }
    if (applied.has(migration.id) || runChecksums.has(migration.id)) {
      return { ...record, status: "applied" as const };
    }
    return { ...record, status: "pending" as const };
  });
}

async function findMigration(id: string, deps: MigrationServiceDependencies) {
  const resolved = await resolveDependencies(deps);
  const migration = resolved.registry.find((candidate) => candidate.id === id);
  if (!migration) throw serviceError("VALIDATION_ERROR", "The migration is not registered.");
  return { ...resolved, migration };
}

async function computeSchemaFingerprint(queryRows: QueryRows) {
  const tableRows = await queryRows<{ table_name: unknown }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema()
     ORDER BY table_name`,
  );
  const columnRows = await queryRows<{ table_name: unknown; column_name: unknown }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
     ORDER BY table_name, ordinal_position`,
  );
  const tables = new Set(tableRows.map((row) => String(row.table_name)));
  const columns = new Set(
    columnRows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
  );
  for (const [table, requiredColumns] of Object.entries(requiredSchema)) {
    if (!tables.has(table)) {
      throw serviceError("SCHEMA_RELATION_MISSING", `Required relation is missing: ${table}`);
    }
    for (const column of requiredColumns) {
      if (!columns.has(`${table}.${column}`)) {
        throw serviceError("SCHEMA_COLUMN_MISSING", `Required column is missing: ${table}.${column}`);
      }
    }
  }
  return sha256(
    [...tables].map((table) => `relation:${table}`).concat(
      [...columns].map((column) => `column:${column}`),
    ).sort().join("\n"),
  );
}

async function migrationState(queryRows: QueryRows) {
  const [appliedRows, successfulRows] = await Promise.all([
    queryRows<{ version: unknown }>("SELECT version FROM app_migrations"),
    queryRows<{ migration_id: unknown }>(
      "SELECT migration_id FROM ops_migration_runs WHERE result = 'succeeded'",
    ),
  ]);
  return new Set([
    ...appliedRows.map((row) => String(row.version)),
    ...successfulRows.map((row) => String(row.migration_id)),
  ]);
}

function assertMigrationReady(migration: RegisteredMigration, applied: Set<string>) {
  if (applied.has(migration.id)) {
    throw serviceError("CONFLICT_DUPLICATE", "The migration has already been applied.");
  }
  const missingDependencies = migration.dependencies.filter((dependency) => !applied.has(dependency));
  if (missingDependencies.length > 0) {
    throw serviceError(
      "VALIDATION_ERROR",
      `Migration dependencies are missing: ${missingDependencies.join(", ")}`,
    );
  }
}

function quoteSqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function postconditionStatement(postcondition: RegisteredMigration["postconditions"][number]) {
  const relation = quoteSqlLiteral(postcondition.relation);
  const condition = postcondition.column
    ? `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${relation} AND column_name = ${quoteSqlLiteral(postcondition.column)})`
    : `to_regclass(current_schema() || '.' || ${relation}) IS NOT NULL`;
  return `DO $$ BEGIN IF NOT (${condition}) THEN RAISE EXCEPTION 'Migration postcondition failed'; END IF; END $$`;
}

export async function planMigration(
  input: { migrationId: string; actor: StaffAccess },
  deps: MigrationServiceDependencies = {},
) {
  const { migration, queryRows } = await findMigration(input.migrationId, deps);
  const applied = await migrationState(queryRows);
  assertMigrationReady(migration, applied);
  const schemaFingerprint = await computeSchemaFingerprint(queryRows);
  const approvalToken = await issueMigrationApproval(
    {
      migrationId: migration.id,
      checksum: migration.checksum,
      schemaFingerprint,
      actorStaffId: input.actor.staffId,
    },
    { secret: deps.approvalSecret, now: deps.now },
  );
  return {
    migrationId: migration.id,
    checksum: migration.checksum,
    dependencies: [...migration.dependencies],
    summary: migration.summary,
    schemaFingerprint,
    approvalToken,
  };
}

async function recordFailure(input: {
  queryRows: QueryRows;
  migration: RegisteredMigration;
  actor: StaffAccess;
  context: OperationContext;
  schemaFingerprint: string | null;
  error: unknown;
}) {
  const publicError = mapControlPlaneError(input.error);
  try {
    await input.queryRows(
      `INSERT INTO ops_migration_runs
        (migration_id, checksum, plan_summary, schema_fingerprint, executed_by_staff_id,
         result, request_id, error_code, error_summary, finished_at)
       VALUES ($1, $2, $3, $4, $5, 'failed', $6::uuid, $7, $8, now())`,
      [
        input.migration.id,
        input.migration.checksum,
        input.migration.summary,
        input.schemaFingerprint ?? "unavailable",
        input.actor.staffId,
        input.context.requestId,
        publicError.code,
        publicError.message,
      ],
    );
  } catch {
    // Preserve the original migration failure when failure recording is unavailable.
  }
}

export async function applyMigration(
  input: {
    migrationId: string;
    approvalToken: string;
    actor: StaffAccess;
    context: OperationContext;
  },
  deps: MigrationServiceDependencies = {},
) {
  const { migration, queryRows, transactionRows, writeAudit } = await findMigration(
    input.migrationId,
    deps,
  );
  let schemaFingerprint: string | null = null;
  try {
    schemaFingerprint = await computeSchemaFingerprint(queryRows);
    const approval = await verifyMigrationApproval(
      input.approvalToken,
      {
        migrationId: migration.id,
        checksum: migration.checksum,
        schemaFingerprint,
        actorStaffId: input.actor.staffId,
      },
      { secret: deps.approvalSecret, now: deps.now },
    );
    if (!approval.ok) {
      throw serviceError("MIGRATION_APPROVAL_INVALID", "Migration approval is invalid or expired.");
    }

    const applied = await migrationState(queryRows);
    assertMigrationReady(migration, applied);
    const statements = [
      ...migration.statements.map(({ statement, params = [] }) => ({
        statement,
        params: [...params],
      })),
      ...migration.postconditions.map((postcondition) => ({
        statement: postconditionStatement(postcondition),
        params: [],
      })),
      {
        statement: "INSERT INTO app_migrations (version) VALUES ($1)",
        params: [migration.id],
      },
      {
        statement: `INSERT INTO ops_migration_runs
          (migration_id, checksum, plan_summary, schema_fingerprint, approved_by_staff_id,
           executed_by_staff_id, result, request_id, finished_at)
         VALUES ($1, $2, $3, $4, $5, $5, 'succeeded', $6::uuid, now())`,
        params: [
          migration.id,
          migration.checksum,
          migration.summary,
          schemaFingerprint,
          input.actor.staffId,
          input.context.requestId,
        ],
      },
    ];
    await transactionRows(statements, { isolationLevel: "Serializable" });
  } catch (error) {
    await recordFailure({
      queryRows,
      migration,
      actor: input.actor,
      context: input.context,
      schemaFingerprint,
      error,
    });
    try {
      await writeAudit({
        actor: input.actor,
        permission: "system.migrations.apply",
        action: "migration.apply",
        resourceType: "migration",
        resourceId: migration.id,
        outcome: "failure",
        context: input.context,
        metadata: { migrationId: migration.id, errorCode: mapControlPlaneError(error).code },
      });
    } catch {
      // The migration error remains the primary failure.
    }
    throw error;
  }

  await writeAudit({
    actor: input.actor,
    permission: "system.migrations.apply",
    action: "migration.apply",
    resourceType: "migration",
    resourceId: migration.id,
    outcome: "success",
    context: input.context,
    metadata: { migrationId: migration.id, checksum: migration.checksum, schemaFingerprint },
  });
  return { migrationId: migration.id, status: "succeeded" as const, schemaFingerprint };
}
