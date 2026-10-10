import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { failureReason } from "../../src/lib/media/remote-variants.mjs";
import {
  assertApplyTarget,
  parseBackfillArgs,
  readCheckpointFile,
  runBackfill,
  writeCheckpointFile,
} from "./backfill-remote-variants.mjs";

const HOST = "ep-quiet-sky-a1b2c3.ap-southeast-1.aws.neon.tech";
const DATABASE_URL = `postgres://owner:s3cret-pass@${HOST}/neondb?sslmode=require`;
const TOKEN = "vercel_blob_rw_store123_secret-token-value";
const ENV = {
  DATABASE_URL,
  BLOB_READ_WRITE_TOKEN: TOKEN,
  MLS_OWNED_BLOB_HOSTS: "owned.public.blob.vercel-storage.com",
};
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

test("backfill defaults to dry-run and bounds batch/checkpoint inputs", () => {
  assert.deepEqual(parseBackfillArgs([]), {
    apply: false,
    limit: 50,
    checkpoint: ".cache/media-variant-backfill.json",
    confirmDbHost: null,
    skipFailed: false,
  });
  assert.deepEqual(
    parseBackfillArgs([
      "--apply",
      "--limit=50",
      "--checkpoint=.cache/test.json",
      `--confirm-db-host=${HOST}`,
    ]),
    {
      apply: true,
      limit: 50,
      checkpoint: ".cache/test.json",
      confirmDbHost: HOST,
      skipFailed: false,
    },
  );
  assert.equal(parseBackfillArgs(["--apply", "--skip-failed"]).skipFailed, true);
  assert.equal(parseBackfillArgs(["--apply"]).skipFailed, false);
  for (const input of [
    ["--limit=0"],
    ["--limit=101"],
    ["--limit=NaN"],
    ["--checkpoint=../outside.json"],
    ["--confirm-db-host="],
    ["--write"],
  ])
    assert.throws(() => parseBackfillArgs(input));
});

test("backfill apply refuses unless --confirm-db-host matches DATABASE_URL", () => {
  assert.equal(assertApplyTarget(DATABASE_URL, HOST), HOST);
  for (const [url, confirm] of [
    [DATABASE_URL, "ep-other-host.ap-southeast-1.aws.neon.tech"],
    [DATABASE_URL, HOST.toUpperCase() + "x"],
    [DATABASE_URL, HOST + ".evil.test"],
    [DATABASE_URL, null],
    [DATABASE_URL, undefined],
    [DATABASE_URL, ""],
    ["postgres://", HOST],
    ["postgres:///neondb", ""],
    ["not a url", HOST],
    [undefined, HOST],
  ]) {
    assert.throws(
      () => assertApplyTarget(url, confirm),
      (error) => {
        assert.doesNotMatch(error.message, /s3cret-pass/);
        return true;
      },
    );
  }
});

function harness({ rows = [], remaining = rows.length, tables = true, ensure } = {}) {
  const statements = [];
  const checkpoints = [];
  const logs = [];
  const ensured = [];
  let connected = 0;
  let blobStores = 0;
  return {
    statements,
    checkpoints,
    logs,
    ensured,
    get connected() {
      return connected;
    },
    get blobStores() {
      return blobStores;
    },
    deps: {
      connect: async () => {
        connected += 1;
        return {
          query: async (statement, params) => {
            statements.push({ statement, params });
            if (/to_regclass/.test(statement)) return [{ ready: tables }];
            if (/count\(\*\)/.test(statement)) return [{ remaining }];
            return rows;
          },
          end: async () => {},
        };
      },
      createBlobStore: () => {
        blobStores += 1;
        return { put: async () => ({}) };
      },
      ensure:
        ensure ??
        (async (input) => {
          ensured.push(input.assetId);
          return { status: "ready", variants: [{}] };
        }),
      readCheckpoint: async () => null,
      writeCheckpoint: async (_file, value) => checkpoints.push(value),
      log: (line) => logs.push(line),
    },
  };
}
const candidate = (id) => ({
  id,
  url: "https://owned.public.blob.vercel-storage.com/mls/" + id + ".jpg",
  hash: "a".repeat(64),
});

test("dry run never writes", async () => {
  const h = harness({ rows: ids.map(candidate), remaining: 137 });
  await runBackfill({ options: parseBackfillArgs([]), env: ENV, ...h.deps });
  assert.ok(h.statements.length >= 2);
  for (const { statement } of h.statements) assert.match(statement.trimStart(), /^SELECT\b/i);
  assert.equal(h.blobStores, 0);
  assert.deepEqual(h.ensured, []);
  assert.deepEqual(h.checkpoints, []);
  const report = JSON.parse(h.logs.at(-1));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.dbHost, HOST);
  assert.equal(report.remaining, 137);
  assert.equal(report.estimatedBlobWrites, 137 * 5);
  assert.equal(report.candidates, 3);
  assert.equal(report.limit, 50);
  const output = h.logs.join("\n");
  assert.doesNotMatch(output, /s3cret-pass|secret-token-value|postgres:\/\//);
});

test("apply with a mismatched or missing host refuses before any query or Blob client", async () => {
  for (const argv of [["--apply"], ["--apply", "--confirm-db-host=wrong.neon.tech"]]) {
    const h = harness({ rows: ids.map(candidate) });
    await assert.rejects(runBackfill({ options: parseBackfillArgs(argv), env: ENV, ...h.deps }));
    assert.equal(h.connected, 0);
    assert.equal(h.statements.length, 0);
    assert.equal(h.blobStores, 0);
  }
  for (const missing of ["BLOB_READ_WRITE_TOKEN", "MLS_OWNED_BLOB_HOSTS"]) {
    const h = harness({ rows: ids.map(candidate) });
    await assert.rejects(
      runBackfill({
        options: parseBackfillArgs(["--apply", `--confirm-db-host=${HOST}`]),
        env: { ...ENV, [missing]: "" },
        ...h.deps,
      }),
    );
    assert.equal(h.connected, 0);
  }
});

test("missing variant tables stop the backfill with the migration name", async () => {
  const h = harness({ rows: ids.map(candidate), tables: false });
  await assert.rejects(
    runBackfill({ options: parseBackfillArgs([]), env: ENV, ...h.deps }),
    /20260927172000_media_asset_variants/,
  );
  assert.equal(h.statements.length, 1);
});

test("apply resumes from the checkpoint and saves it after every finished photo", async () => {
  const h = harness({ rows: ids.map(candidate) });
  h.deps.readCheckpoint = async () => ({ lastAssetId: "00000000-0000-4000-8000-000000000000" });
  await runBackfill({
    options: parseBackfillArgs(["--apply", `--confirm-db-host=${HOST}`]),
    env: ENV,
    ...h.deps,
  });
  const select = h.statements.find((s) => /LIMIT \$2/.test(s.statement));
  assert.deepEqual(select.params, ["00000000-0000-4000-8000-000000000000", 50]);
  assert.deepEqual(h.ensured, ids);
  assert.deepEqual(
    h.checkpoints,
    ids.map((lastAssetId) => ({ lastAssetId })),
  );
  const report = JSON.parse(h.logs.at(-1));
  assert.equal(report.mode, "apply");
  assert.equal(report.ready, 3);
  assert.equal(report.dbHost, HOST);
  // Only SELECTs run here: every write goes through ensure() -> saveMediaVariantSet.
  for (const { statement } of h.statements) assert.match(statement.trimStart(), /^SELECT\b/i);
});

const APPLY = ["--apply", `--confirm-db-host=${HOST}`];
// The real ensureMediaVariants: Blob and save errors come back as status "failed" with
// a log-safe reason; source errors (read, hash, decode, size) throw after the lookup.
const failsAt = (failId, outcome) => async (input, ports) => {
  await ports.find(input.assetId, input.sourceHash);
  if (input.assetId === failId) {
    if (outcome === "source") throw new Error(`Owned source read failed ${TOKEN}`);
    return {
      status: "failed",
      variants: [],
      reason: failureReason(new Error(`Vercel Blob upload failed: 403 ${DATABASE_URL}`)),
    };
  }
  return { status: "ready", variants: [{}] };
};
function failHarness(ensure) {
  const ensured = [];
  const h = harness({ rows: ids.map(candidate) });
  h.deps.ensure = async (input, ports) => {
    ensured.push(input.assetId);
    return ensure(input, ports);
  };
  h.deps.connect = async () => ({
    query: async (statement) => {
      h.statements.push({ statement });
      if (/to_regclass/.test(statement)) return [{ ready: true }];
      if (/count\(\*\)/.test(statement)) return [{ remaining: 3 }];
      if (/media_variant_sets s JOIN/.test(statement)) return [];
      return ids.map(candidate);
    },
    end: async () => {},
  });
  return { h, ensured };
}

test("apply stops on the first failed photo, shows the redacted reason, and leaves the rest untouched", async () => {
  for (const argv of [APPLY, [...APPLY, "--skip-failed"]]) {
    const { h, ensured } = failHarness(failsAt(ids[1], "write"));
    await assert.rejects(
      runBackfill({ options: parseBackfillArgs(argv), env: ENV, ...h.deps }),
      (error) => {
        assert.match(error.message, new RegExp("Stopped at asset " + ids[1]));
        assert.match(error.message, /Vercel Blob upload failed: 403/);
        assert.doesNotMatch(error.message, /s3cret-pass|secret-token-value|postgres:\/\//);
        return true;
      },
    );
    assert.deepEqual(ensured, ids.slice(0, 2));
    assert.deepEqual(h.checkpoints, [{ lastAssetId: ids[0] }]);
  }
});

test("a source error stops the run by default", async () => {
  const { h, ensured } = failHarness(failsAt(ids[1], "source"));
  await assert.rejects(
    runBackfill({ options: parseBackfillArgs(APPLY), env: ENV, ...h.deps }),
    (error) => {
      assert.match(error.message, /Stopped at asset .*Owned source read failed/);
      assert.doesNotMatch(error.message, /secret-token-value/);
      return true;
    },
  );
  assert.deepEqual(ensured, ids.slice(0, 2));
  assert.deepEqual(h.checkpoints, [{ lastAssetId: ids[0] }]);
});

test("--skip-failed passes a source error, advances the checkpoint and exits 1", async () => {
  const { h, ensured } = failHarness(failsAt(ids[1], "source"));
  const result = await runBackfill({
    options: parseBackfillArgs([...APPLY, "--skip-failed"]),
    env: ENV,
    ...h.deps,
  });
  assert.deepEqual(ensured, ids);
  assert.deepEqual(
    h.checkpoints,
    ids.map((lastAssetId) => ({ lastAssetId })),
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    result.skipped.map((item) => item.id),
    [ids[1]],
  );
  const lines = h.logs.map((line) => JSON.parse(line));
  assert.deepEqual(lines[0].skipped, ids[1]);
  assert.match(lines[0].reason, /Owned source read failed/);
  const report = lines.at(-1);
  assert.equal(report.ready, 2);
  assert.deepEqual(
    report.skipped.map((item) => item.id),
    [ids[1]],
  );
  assert.doesNotMatch(h.logs.join("\n"), /secret-token-value|s3cret-pass/);
});

test("--skip-failed never skips a lookup or input error", async () => {
  const { h } = failHarness(async () => {
    throw new Error("connection reset during variant lookup");
  });
  await assert.rejects(
    runBackfill({
      options: parseBackfillArgs([...APPLY, "--skip-failed"]),
      env: ENV,
      ...h.deps,
    }),
    /Stopped at asset/,
  );
  assert.deepEqual(h.checkpoints, []);
});

test("checkpoint writes are atomic and a corrupt checkpoint says to delete it", async () => {
  const { mkdtemp, readFile, readdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "variant-backfill-"));
  try {
    const file = path.join(dir, "nested", "checkpoint.json");
    assert.equal(await readCheckpointFile(file), null);
    await writeCheckpointFile(file, { lastAssetId: ids[0] });
    await writeCheckpointFile(file, { lastAssetId: ids[1] });
    assert.deepEqual(await readCheckpointFile(file), { lastAssetId: ids[1] });
    assert.deepEqual(await readdir(path.dirname(file)), ["checkpoint.json"]);
    assert.equal(await readFile(file, "utf8"), JSON.stringify({ lastAssetId: ids[1] }) + "\n");
    for (const torn of ['{"lastAssetId":"0000', '{"lastAssetId":"x"}']) {
      await writeFile(file, torn);
      await assert.rejects(readCheckpointFile(file), /unreadable\. Delete it to restart/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("real SQL on in-process Postgres: counts, resumes and writes only the variant tables", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFileSync } = await import("node:fs");
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE media_assets(id uuid PRIMARY KEY,url text NOT NULL,content_hash text," +
        "owner_type text NOT NULL)",
    );
    const connect = async () => ({
      query: async (sql, params) => (await db.query(sql, params)).rows,
      end: async () => {},
    });
    const base = { ...harness().deps, connect };
    // Before the migration: refuse with its name, write nothing.
    await assert.rejects(
      runBackfill({ options: parseBackfillArgs([]), env: ENV, ...base }),
      /20260927172000_media_asset_variants/,
    );
    await db.exec(readFileSync("neon/migrations/20260927172000_media_asset_variants.sql", "utf8"));
    for (const [index, id] of ids.entries())
      await db.query("INSERT INTO media_assets VALUES($1,$2,$3,'mls-shared')", [
        id,
        "https://owned.public.blob.vercel-storage.com/mls/" + index + ".jpg",
        String(index + 1).repeat(64),
      ]);
    await db.query("INSERT INTO media_assets VALUES($1,'https://x.test/a.jpg',$2,'cms')", [
      "00000000-0000-4000-8000-000000000009",
      "f".repeat(64),
    ]);
    const before = (await db.query("SELECT * FROM media_assets ORDER BY id")).rows;

    const dry = harness();
    await runBackfill({ options: parseBackfillArgs([]), env: ENV, ...dry.deps, connect });
    assert.equal(JSON.parse(dry.logs.at(-1)).remaining, 3);
    assert.equal(JSON.parse(dry.logs.at(-1)).estimatedBlobWrites, 15);

    let checkpoint = null;
    const apply = {
      ...base,
      readCheckpoint: async () => checkpoint,
      writeCheckpoint: async (_file, value) => {
        checkpoint = value;
      },
      ensure: async (input, ports) => {
        const set = {
          ...input,
          status: "ready",
          variants: [
            {
              width: 160,
              url: "https://owned.public.blob.vercel-storage.com/mls-variants/" + input.sourceHash,
              bytes: 10,
              format: "webp",
            },
          ],
        };
        await ports.save(set);
        return set;
      },
    };
    const argv = ["--apply", "--limit=2", `--confirm-db-host=${HOST}`];
    await runBackfill({ options: parseBackfillArgs(argv), env: ENV, ...apply });
    assert.deepEqual(checkpoint, { lastAssetId: ids[1] });
    // An interrupted run continues from the checkpoint and finishes the last photo.
    await runBackfill({ options: parseBackfillArgs(argv), env: ENV, ...apply });
    assert.deepEqual(checkpoint, { lastAssetId: ids[2] });
    // A fresh checkpoint still skips every finished photo.
    checkpoint = null;
    const again = harness();
    await runBackfill({ options: parseBackfillArgs([]), env: ENV, ...again.deps, connect });
    assert.equal(JSON.parse(again.logs.at(-1)).remaining, 0);

    assert.deepEqual((await db.query("SELECT * FROM media_assets ORDER BY id")).rows, before);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM media_variant_sets")).rows[0].n,
      3,
    );
  } finally {
    await db.close();
  }
});

test("--help prints the flags and the Node 22 requirement", async () => {
  const { BACKFILL_HELP } = await import("./backfill-remote-variants.mjs");
  for (const flag of ["--apply", "--confirm-db-host", "--limit", "--checkpoint", "--skip-failed"])
    assert.ok(BACKFILL_HELP.includes(flag), flag);
  assert.match(BACKFILL_HELP, /Node 22/);
  assert.deepEqual(parseBackfillArgs(["--help"]), { help: true });
});
