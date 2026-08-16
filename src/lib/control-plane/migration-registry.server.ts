export type RegisteredMigration = {
  id: string;
  checksum: string;
  dependencies: readonly string[];
  summary: string;
  statements: readonly { statement: string; params?: readonly unknown[] }[];
  postconditions: readonly { relation: string; column?: string }[];
};

const registeredMigrations = [
  {
    id: "20260715120000_ops_jobs_status_updated_index",
    checksum: "sha256:ed40f99a97680eadb16499bf519cd7e7dcd2075de8501b2be8f6dadeac53b582",
    dependencies: ["20260714180000_backend_control_plane.sql"],
    summary: "Add a status and update-time index for control-plane job operations.",
    statements: [
      {
        statement:
          "CREATE INDEX IF NOT EXISTS idx_ops_jobs_status_updated_at ON ops_jobs (status, updated_at DESC)",
      },
    ],
    postconditions: [
      { relation: "ops_jobs", column: "status" },
      { relation: "ops_jobs", column: "updated_at" },
    ],
  },
] as const satisfies readonly RegisteredMigration[];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeMigrationChecksum(statements: RegisteredMigration["statements"]) {
  const serialized = JSON.stringify(
    statements.map(({ statement, params = [] }) => ({
      statement,
      params: canonicalize(params),
    })),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function listRegisteredMigrations(
  registry: readonly RegisteredMigration[] = registeredMigrations,
) {
  const seen = new Set<string>();
  for (const migration of registry) {
    if (seen.has(migration.id)) {
      throw Object.assign(new Error(`Duplicate migration ID: ${migration.id}`), {
        code: "VALIDATION_ERROR",
      });
    }
    seen.add(migration.id);
    const computedChecksum = await computeMigrationChecksum(migration.statements);
    if (computedChecksum !== migration.checksum) {
      throw Object.assign(new Error(`Migration checksum mismatch: ${migration.id}`), {
        code: "VALIDATION_ERROR",
      });
    }
  }

  for (const migration of registry) {
    for (const dependency of migration.dependencies) {
      if (dependency === migration.id) {
        throw Object.assign(new Error(`Migration cannot depend on itself: ${migration.id}`), {
          code: "VALIDATION_ERROR",
        });
      }
    }
  }
  return registry;
}
