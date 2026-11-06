/**
 * No CLI, credentials, environment loading, logging or filesystem side effects.
 * The controller verifies target/binding/access, injects a read-only session and
 * stores raw output privately. This inventory is NOT a recoverable backup.
 *
 * Interactive: collectLiveInventory(verifiedTarget, adapter, { pageSize: 500 }).
 * MCP/Neon HTTP: buildLiveInventoryBatch(verifiedTarget, observedCatalog), execute
 * ALL queries in ONE RepeatableRead/readOnly transaction, then validate(results).
 * Catalog changes invalidate the batch; never retry only a failed page/query.
 */
import { createHash } from "node:crypto";
import type { Pool } from "@neondatabase/serverless";
import type { DatabaseSnapshot } from "../../src/lib/blog/reconcile";

type Row = Record<string, unknown>;
export type VerifiedLiveInventoryTarget = Readonly<{
  verified: true;
  identity: string;
  projectId: string;
  branchId: string;
  endpointId: string;
  database: string;
  role: string;
  sourceRevision: string;
  bindingReceiptSha256: string;
  bindingVerification: "USER_CONFIRMED" | "AUTOMATED";
  verifiedAtUtc: string;
  readOnlySessionAuthorized: true;
  /** Only if independently verified; never derive from a hostname/project ID. */
  systemIdentifier?: string;
}>;
export type ReadOnlyQuery = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};
export type ReadOnlyInventoryAdapter = {
  /** Must pin one connection/snapshot, rollback on error, and reject lost responses. */
  transaction<T>(
    options: { isolationLevel: "RepeatableRead"; readOnly: true },
    run: (session: ReadOnlyQuery) => Promise<T>,
  ): Promise<T>;
};
export type InventoryOptions = {
  pageSize?: number;
  maxRowsPerTable?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
  signal?: AbortSignal;
};

const contracts = {
  // Ledger first, before reading content. All ledger rows are retained.
  app_migrations: { key: ["version"], columns: "version applied_at" },
  articles: {
    key: ["id"],
    columns:
      "id slug title excerpt content cover_image category reading_minutes published published_at created_at updated_at author_id seo_title seo_description category_id content_format cover_alt supplemental_links slug_locked version editorial_metadata",
  },
  cms_content_revisions: {
    key: ["id"],
    columns:
      "id resource_type resource_id version_number state payload validation_summary base_published_version created_by restored_from_revision_id created_at published_at draft_edit_version draft_retired_at browse_created_at",
  },
  blog_categories: { key: ["id"], columns: "id key name navigation_order hidden version" },
  blog_settings: {
    key: ["id"],
    columns: "id scope_kind category_id heading introduction seo_title seo_description version",
  },
  blog_featured_articles: {
    key: ["scope_id", "article_id"],
    columns: "scope_id article_id position",
  },
  blog_legacy_category_map: { key: ["legacy_key"], columns: "legacy_key category_id" },
  blog_import_receipts: {
    key: ["fingerprint"],
    columns: "fingerprint target_identity receipt created_at",
  },
  blog_mutation_requests: {
    key: ["request_id"],
    columns: "request_id actor_id operation fingerprint command result created_at",
  },
} as const;
type Table = keyof typeof contracts;
const tableNames = Object.keys(contracts) as Table[];
// Exactly the tables consumed by the existing importer/snapshot contract. The
// receipts remain raw evidence, never inputs to the owned importer or its guard.
const snapshotTables: Table[] = [
  "articles",
  "cms_content_revisions",
  "blog_categories",
  "blog_settings",
  "blog_featured_articles",
  "blog_legacy_category_map",
  "app_migrations",
];
const expectedMigrations = [
  "20261105120000_blog_presentation_contracts.sql",
  "20261105140000_blog_repository_mutations.sql",
  "20261105160000_blog_import_receipts.sql",
];
export type InventoryCatalogColumn = {
  table_name: Table;
  column_name: string;
  data_type: string;
  relation_kind: string;
};
export type TableCapability = {
  present: boolean;
  columns: { name: string; type: string }[];
  missingColumns: string[];
  extraColumns: string[];
  readable: boolean;
};
type TableCapture = {
  status: "captured" | "absent" | "unsupported";
  count: number | null;
  /** Authoritative PostgreSQL JSON text, before any JS numeric decoding. */
  rawRows: string[] | null;
  /** Convenience view, withheld for the whole table if any numeric value loses precision. */
  rows: Row[] | null;
  numericPrecision: "exact" | "unrepresentable" | null;
};
export type RawLiveInventory = {
  schemaVersion: 1;
  kind: "blog-live-inventory";
  target: VerifiedLiveInventoryTarget;
  observedAtUtc: string;
  completedAtUtc: string;
  transaction: {
    snapshot: string;
    startedAtUtc: string;
    isolationLevel: "RepeatableRead";
    readOnly: true;
  };
  capabilities: Record<Table, TableCapability>;
  tables: Record<Table, TableCapture>;
  /** Complete is only scoped row capture, never content/release readiness. */
  coverage: "complete" | "schema-limited";
};

export class LiveInventoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LiveInventoryError";
  }
}
function fail(code: string): never {
  throw new LiveInventoryError("LIVE_INVENTORY_" + code);
}
function safeError(error: unknown): LiveInventoryError {
  // Driver exceptions can contain SQL, credentials, bodies or connection strings.
  return error instanceof LiveInventoryError
    ? error
    : new LiveInventoryError("LIVE_INVENTORY_READ_FAILED");
}
function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => JSON.stringify(key) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return fail("NON_JSON");
}
const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const clone = <T>(value: T): T => JSON.parse(stable(value));
const iso = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) &&
  Number.isFinite(Date.parse(value));

function verifyTarget(input: VerifiedLiveInventoryTarget): VerifiedLiveInventoryTarget {
  if (!input || input.verified !== true || input.readOnlySessionAuthorized !== true)
    fail("TARGET_UNVERIFIED");
  for (const key of [
    "identity",
    "projectId",
    "branchId",
    "endpointId",
    "database",
    "role",
  ] as const)
    if (typeof input[key] !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(input[key]))
      fail("TARGET_INVALID");
  if (
    !/^[a-f0-9]{40,64}$/.test(input.sourceRevision) ||
    !/^[a-f0-9]{64}$/.test(input.bindingReceiptSha256) ||
    !["USER_CONFIRMED", "AUTOMATED"].includes(input.bindingVerification) ||
    !iso(input.verifiedAtUtc) ||
    (input.systemIdentifier !== undefined && !/^\d{1,30}$/.test(input.systemIdentifier))
  )
    fail("TARGET_INVALID");
  // Deliberately do not spread arbitrary controller properties into output/receipt.
  return Object.freeze({
    verified: true,
    identity: input.identity,
    projectId: input.projectId,
    branchId: input.branchId,
    endpointId: input.endpointId,
    database: input.database,
    role: input.role,
    sourceRevision: input.sourceRevision,
    bindingReceiptSha256: input.bindingReceiptSha256,
    verifiedAtUtc: input.verifiedAtUtc,
    bindingVerification: input.bindingVerification,
    readOnlySessionAuthorized: true,
    ...(input.systemIdentifier ? { systemIdentifier: input.systemIdentifier } : {}),
  });
}
function bounds(options: InventoryOptions) {
  const bounded = (value: number | undefined, fallback: number, max: number) => {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) fail("INVALID_LIMIT");
    return n;
  };
  return {
    pageSize: bounded(options.pageSize, 500, 5000),
    maxRows: bounded(options.maxRowsPerTable, 1_000_000, 10_000_000),
    statement: bounded(options.statementTimeoutMs, 15000, 60000),
    lock: bounded(options.lockTimeoutMs, 3000, 60000),
    idle: bounded(options.idleTransactionTimeoutMs, 30000, 60000),
  };
}
function cancelled(options: InventoryOptions) {
  if (options.signal?.aborted) fail("INTERRUPTED");
}
function settingsSql(limits: ReturnType<typeof bounds>) {
  // true means transaction-local; no ALTER ROLE/DATABASE or session-persistent settings.
  return `SELECT pg_catalog.set_config('statement_timeout','${limits.statement}ms',true),
    pg_catalog.set_config('lock_timeout','${limits.lock}ms',true),
    pg_catalog.set_config('idle_in_transaction_session_timeout','${limits.idle}ms',true),
    pg_catalog.set_config('row_security','off',true),
    pg_catalog.set_config('TimeZone','UTC',true), pg_catalog.set_config('DateStyle','ISO, YMD',true)`;
}
const sessionSql = `SELECT current_database() AS database, current_user AS role,
  current_setting('transaction_read_only') AS read_only,
  current_setting('transaction_isolation') AS isolation,
  current_setting('row_security') AS row_security,
  pg_catalog.pg_current_snapshot()::text AS snapshot,
  to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at`;
/** Parameter-free, fixed allowlist. Catalog access failure is not table absence. */
export const liveInventoryCatalogQuery = `SELECT c.relname AS table_name, a.attname AS column_name,
  pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type, c.relkind::text AS relation_kind
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  WHERE n.nspname='public' AND c.relname IN (${tableNames.map((t) => "'" + t + "'").join(",")})
  ORDER BY c.relname COLLATE "C", a.attname COLLATE "C"`;

function catalog(rows: Row[]): Record<Table, TableCapability> {
  const output = {} as Record<Table, TableCapability>;
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      !tableNames.includes(row.table_name as Table) ||
      typeof row.column_name !== "string" ||
      !row.column_name ||
      typeof row.data_type !== "string" ||
      typeof row.relation_kind !== "string"
    )
      fail("CATALOG_INVALID");
    const key = row.table_name + ":" + row.column_name;
    if (seen.has(key)) fail("CATALOG_DUPLICATE");
    seen.add(key);
  }
  for (const table of tableNames) {
    const found = rows.filter((r) => r.table_name === table);
    const columns = found
      .map((r) => ({ name: r.column_name as string, type: r.data_type as string }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
    const expected = contracts[table].columns.split(" ");
    const names = columns.map((c) => c.name);
    const required = [
      ...contracts[table].key,
      ...(table === "cms_content_revisions" ? ["resource_type"] : []),
    ];
    output[table] = {
      present: found.length > 0,
      columns,
      missingColumns: expected.filter((c) => !names.includes(c)),
      extraColumns: names.filter((c) => !expected.includes(c)),
      readable:
        found.length > 0 &&
        found.every((r) => r.relation_kind === "r" || r.relation_kind === "p") &&
        required.every((c) => names.includes(c)),
    };
  }
  return output;
}
function session(rows: Row[], target: VerifiedLiveInventoryTarget) {
  if (rows.length !== 1) fail("SESSION_INVALID");
  const row = rows[0];
  if (row.database !== target.database || row.role !== target.role) fail("TARGET_MISMATCH");
  if (row.read_only !== "on" || row.isolation !== "repeatable read" || row.row_security !== "off")
    fail("SESSION_UNSAFE");
  if (
    typeof row.snapshot !== "string" ||
    !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(row.snapshot) ||
    !iso(row.started_at)
  )
    fail("SESSION_INVALID");
  return {
    snapshot: row.snapshot,
    startedAtUtc: row.started_at,
    isolationLevel: "RepeatableRead" as const,
    readOnly: true as const,
  };
}
function from(table: Table) {
  return (
    `FROM "public"."${table}" AS t` +
    (table === "cms_content_revisions" ? " WHERE t.resource_type='article'" : "")
  );
}
function orderColumns(table: Table, cap: TableCapability): string[] {
  return table === "blog_featured_articles" && cap.columns.some((c) => c.name === "position")
    ? ["scope_id", "position", "article_id"]
    : [...contracts[table].key];
}
function rowsSql(table: Table, cap: TableCapability) {
  const order = orderColumns(table, cap)
    .map((c) => (c === "position" ? `t."${c}" ASC` : `t."${c}"::text COLLATE "C" ASC`))
    .join(",");
  // TEXT prevents the driver from rounding JSON numerics before we can preserve them.
  return `SELECT to_jsonb(t)::text AS raw ${from(table)} ORDER BY ${order}`;
}
const countSql = (table: Table) => `SELECT count(*)::text AS count ${from(table)}`;
function count(rows: Row[], maximum: number) {
  if (
    rows.length !== 1 ||
    typeof rows[0].count !== "string" ||
    !/^(0|[1-9]\d*)$/.test(rows[0].count)
  )
    fail("COUNT_INVALID");
  const value = Number(rows[0].count);
  if (!Number.isSafeInteger(value) || value > maximum) fail("ROW_LIMIT");
  return value;
}
/** Compare decimal values without expanding exponents or rounding through Number. */
function decimalIdentity(token: string): string {
  const [mantissa, exponent = "0"] = token.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const coefficient = digits.replace(/0+$/, "");
  const power =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - coefficient.length);
  return (negative ? "-" : "") + coefficient + "e" + power;
}
function exactJsonNumerics(raw: string): boolean {
  // JSON.parse has already validated the document. Consume quoted strings as a
  // whole so digits in bodies/keys/escaped text cannot trigger a precision gap.
  const tokens = raw.matchAll(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  for (const [token] of tokens) {
    if (token.startsWith('"')) continue;
    const value = Number(token);
    if (!Number.isFinite(value) || decimalIdentity(token) !== decimalIdentity(String(value)))
      return false;
  }
  return true;
}
function validateRows(table: Table, cap: TableCapability, rows: Row[], expected: number) {
  if (rows.length !== expected) fail("COUNT_MISMATCH");
  const identities = new Set<string>();
  const keys = orderColumns(table, cap);
  const columns = cap.columns.map((c) => c.name).sort();
  let previous: Row | undefined;
  let exact = true;
  const rawRows: string[] = [];
  const parsed = rows.map((wrapper) => {
    if (typeof wrapper.raw !== "string") fail("ROW_TEXT_REQUIRED");
    const raw = wrapper.raw;
    let row: Row;
    try {
      row = JSON.parse(raw) as Row;
    } catch {
      return fail("ROW_TEXT_INVALID");
    }
    rawRows.push(raw);
    if (!exactJsonNumerics(raw)) exact = false;
    if (
      !row ||
      Array.isArray(row) ||
      typeof row !== "object" ||
      stable(Object.keys(row).sort()) !== stable(columns)
    )
      fail("ROW_COLUMNS");
    for (const key of contracts[table].key) {
      const permitsEmpty = table === "blog_legacy_category_map" && key === "legacy_key";
      if (typeof row[key] !== "string" || (!row[key] && !permitsEmpty)) fail("ROW_IDENTITY");
    }
    if (table === "cms_content_revisions" && row.resource_type !== "article")
      fail("RESOURCE_SCOPE");
    const identity = stable(contracts[table].key.map((key) => row[key]));
    if (identities.has(identity)) fail("DUPLICATE_IDENTITY");
    identities.add(identity);
    if (
      keys.includes("position") &&
      (!Number.isSafeInteger(row.position) || Number(row.position) < 0)
    )
      fail("FEATURE_POSITION");
    if (previous) {
      let comparison = 0;
      for (const key of keys) {
        comparison =
          key === "position"
            ? Number(previous[key]) - Number(row[key])
            : Buffer.compare(Buffer.from(String(previous[key])), Buffer.from(String(row[key])));
        if (comparison !== 0) break;
      }
      if (comparison >= 0) fail("ROW_ORDER");
    }
    previous = row;
    return row;
  });
  return {
    rawRows,
    rows: exact ? parsed : null,
    numericPrecision: exact ? ("exact" as const) : ("unrepresentable" as const),
  };
}
function initialTables(caps: Record<Table, TableCapability>) {
  return Object.fromEntries(
    tableNames.map((table) => [
      table,
      {
        status: caps[table].present ? "unsupported" : "absent",
        count: null,
        rawRows: null,
        rows: null,
        numericPrecision: null,
      },
    ]),
  ) as Record<Table, TableCapture>;
}
function finish(
  target: VerifiedLiveInventoryTarget,
  observedAtUtc: string,
  transaction: RawLiveInventory["transaction"],
  capabilities: RawLiveInventory["capabilities"],
  tables: RawLiveInventory["tables"],
) {
  const gaps: string[] = [];
  for (const table of tableNames) {
    const cap = capabilities[table];
    if (!cap.present) gaps.push("missing-table:" + table);
    else {
      if (!cap.readable) gaps.push("unsupported-table:" + table);
      gaps.push(...cap.missingColumns.map((c) => "missing-column:" + table + "." + c));
      if (cap.extraColumns.length) gaps.push("unreviewed-columns:" + table);
    }
  }
  for (const version of expectedMigrations)
    if (!tables.app_migrations.rows?.some((r) => r.version === version))
      gaps.push("missing-migration:" + version);
  const raw: RawLiveInventory = {
    schemaVersion: 1,
    kind: "blog-live-inventory",
    target,
    observedAtUtc,
    completedAtUtc: new Date().toISOString(),
    transaction,
    capabilities,
    tables,
    coverage: gaps.length ? "schema-limited" : "complete",
  };
  const precisionGaps = tableNames
    .filter((table) => tables[table].numericPrecision === "unrepresentable")
    .map((table) => "unrepresentable-json-numeric:" + table);
  const normalizationGaps = [...gaps, ...precisionGaps];
  if (!target.systemIdentifier) normalizationGaps.push("unverified-system-identifier");
  // Lossless structural projection only. No dates, versions, empty absent tables,
  // categories, revision payloads or source/public observations are synthesized.
  let databaseSnapshot: DatabaseSnapshot | null = null;
  if (!normalizationGaps.length) {
    const data = {
      targetIdentity: target.identity,
      systemIdentifier: target.systemIdentifier!,
      tables: Object.fromEntries(
        snapshotTables.map((table) => [table, clone(tables[table].rows!)]),
      ),
    };
    databaseSnapshot = { ...data, fingerprint: digest(data) };
  }
  return {
    raw,
    readiness: {
      ready: false as const,
      gaps: [...gaps, ...precisionGaps],
      activationAuthorized: false as const,
    },
    normalization: {
      databaseSnapshot,
      sourceBundle: null,
      gaps: [
        ...normalizationGaps,
        "source-bundle-requires-deployed-source-and-public-observations",
      ],
      contentReviewRequired: true as const,
    },
    receipt: {
      schemaVersion: 1 as const,
      kind: "blog-live-inventory-receipt" as const,
      target: {
        identity: target.identity,
        projectId: target.projectId,
        branchId: target.branchId,
        endpointId: target.endpointId,
        bindingVerification: target.bindingVerification,
        database: target.database,
        sourceRevision: target.sourceRevision,
        bindingReceiptSha256: target.bindingReceiptSha256,
        verifiedAtUtc: target.verifiedAtUtc,
      },
      observedAtUtc,
      completedAtUtc: raw.completedAtUtc,
      coverage: raw.coverage,
      counts: Object.fromEntries(tableNames.map((table) => [table, tables[table].count])),
      schemaGaps: gaps,
      precisionGaps,
      rawSha256: digest(raw),
      tableSha256: Object.fromEntries(
        tableNames.map((table) => [
          table,
          tables[table].rawRows === null ? null : digest(tables[table].rawRows),
        ]),
      ),
      writes: 0 as const,
      recoverableBackup: false as const,
      activationAuthorized: false as const,
    },
  };
}

/** Rejects the whole capture on any failed page, cancellation, mismatch or lost commit response. */
export async function collectLiveInventory(
  input: VerifiedLiveInventoryTarget,
  adapter: ReadOnlyInventoryAdapter,
  options: InventoryOptions = {},
) {
  try {
    const target = verifyTarget(input),
      limits = bounds(options),
      observedAtUtc = new Date().toISOString();
    cancelled(options);
    return await adapter.transaction(
      { isolationLevel: "RepeatableRead", readOnly: true },
      async (tx) => {
        const read = async (sql: string, params?: unknown[]) => {
          cancelled(options);
          const result = await tx.query(sql, params);
          cancelled(options);
          if (!result || !Array.isArray(result.rows)) fail("RESULT_INVALID");
          return result.rows;
        };
        await read(settingsSql(limits));
        const start = session(await read(sessionSql), target);
        const caps = catalog(await read(liveInventoryCatalogQuery));
        const tables = initialTables(caps);
        for (const table of tableNames) {
          if (!caps[table].readable) continue;
          const expected = count(await read(countSql(table)), limits.maxRows);
          const rows: Row[] = [];
          // Read an empty terminal page as well; never accept a hidden tail or short page.
          while (true) {
            const page = await read(rowsSql(table, caps[table]) + " LIMIT $1 OFFSET $2", [
              limits.pageSize,
              rows.length,
            ]);
            if (page.length !== Math.min(limits.pageSize, expected - rows.length))
              fail("PAGE_INCOMPLETE");
            rows.push(...page);
            if (!page.length) break;
          }
          if (count(await read(countSql(table)), limits.maxRows) !== expected)
            fail("COUNT_MISMATCH");
          tables[table] = {
            status: "captured",
            count: expected,
            ...validateRows(table, caps[table], rows, expected),
          };
        }
        if (stable(caps) !== stable(catalog(await read(liveInventoryCatalogQuery))))
          fail("SCHEMA_DRIFT");
        if (stable(start) !== stable(session(await read(sessionSql), target)))
          fail("SNAPSHOT_CHANGED");
        return finish(target, observedAtUtc, start, caps, tables);
      },
    );
  } catch (error) {
    throw safeError(error);
  }
}

/**
 * A bounded, parameter-free batch for MCP run_sql_transaction or Neon HTTP's
 * transaction(queryPromises, { isolationLevel: 'RepeatableRead', readOnly: true }).
 * Pass catalog rows from a preliminary read; this batch rechecks them in its own
 * snapshot. Results must be decoded full row arrays, in query order (not tool text).
 * The LIMIT sentinel rejects oversize/truncated results rather than saving a subset.
 */
export function buildLiveInventoryBatch(
  input: VerifiedLiveInventoryTarget,
  observedCatalog: readonly InventoryCatalogColumn[],
  options: InventoryOptions = {},
) {
  const target = verifyTarget(input),
    limits = bounds(options),
    caps = catalog(clone([...observedCatalog]));
  cancelled(options);
  const observedAtUtc = new Date().toISOString();
  const readable = tableNames.filter((table) => caps[table].readable);
  const queries = [
    settingsSql(limits),
    sessionSql,
    liveInventoryCatalogQuery,
    ...readable.flatMap((table) => [
      countSql(table),
      rowsSql(table, caps[table]) + ` LIMIT ${limits.maxRows + 1}`,
      countSql(table),
    ]),
    liveInventoryCatalogQuery,
    sessionSql,
  ];
  return Object.freeze({
    isolationLevel: "RepeatableRead" as const,
    readOnly: true as const,
    queries: Object.freeze(queries),
    validate(results: readonly { rows: Row[] }[]) {
      try {
        cancelled(options);
        if (results.length !== queries.length || results.some((r) => !r || !Array.isArray(r.rows)))
          fail("BATCH_INCOMPLETE");
        const start = session(results[1].rows, target);
        if (
          stable(caps) !== stable(catalog(results[2].rows)) ||
          stable(caps) !== stable(catalog(results[results.length - 2].rows))
        )
          fail("SCHEMA_DRIFT");
        if (stable(start) !== stable(session(results[results.length - 1].rows, target)))
          fail("SNAPSHOT_CHANGED");
        const tables = initialTables(caps);
        for (const [i, table] of readable.entries()) {
          const offset = 3 + i * 3;
          const expected = count(results[offset].rows, limits.maxRows);
          if (count(results[offset + 2].rows, limits.maxRows) !== expected) fail("COUNT_MISMATCH");
          tables[table] = {
            status: "captured",
            count: expected,
            ...validateRows(table, caps[table], results[offset + 1].rows, expected),
          };
        }
        return finish(target, observedAtUtc, start, caps, tables);
      } catch (error) {
        throw safeError(error);
      }
    },
  });
}

/** Inject an already configured Neon Pool. Never constructs a connection or loads a URL. */
export function createNeonInventoryAdapter(pool: Pick<Pool, "connect">): ReadOnlyInventoryAdapter {
  return {
    async transaction(options, run) {
      if (options.isolationLevel !== "RepeatableRead" || options.readOnly !== true)
        fail("SESSION_UNSAFE");
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await run({ query: (sql, params) => client.query(sql, params) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        discard = true;
        try {
          await client.query("ROLLBACK");
        } catch {
          /* Preserve only sanitized failure. */
        }
        throw safeError(error);
      } finally {
        client.release(discard);
      }
    },
  };
}
