import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import pg from "pg";
// Register the existing local TS resolver; this import does not start Docker.
import "./owned-postgres-test.mjs";
import {
  PINNED_POSTGRES_17,
  PINNED_POSTGRES_18,
} from "../../src/lib/neon/owned-postgres-images.ts";

const { verifyImportTarget, snapshotDatabase } = await import("../../src/lib/neon/blog-import.ts");
const containerId = "a".repeat(64);
const config = { containerId, targetIdentity: "owned:" + containerId + ":postgres" };
const urlKeys = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "TEST_DATABASE_URL",
  "CMS_TEST_DATABASE_URL",
  "ASTRA_TEST_DATABASE_URL",
];

function fixture(t, image = PINNED_POSTGRES_18) {
  for (const key of urlKeys) {
    const previous = process.env[key];
    delete process.env[key];
    t.after(() =>
      previous === undefined ? delete process.env[key] : (process.env[key] = previous),
    );
  }
  const calls = [];
  const meta = {
    Id: containerId,
    Name: "/earnest-remediation-qa-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    Config: { Image: image },
    State: { Running: true },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54329" }] } },
  };
  const identity = { db: "postgres", usr: "postgres", system_id: "123456789" };
  t.mock.method(childProcess, "execFileSync", (command, args) => {
    calls.push([command, ...args]);
    assert.equal(command, "docker");
    assert.deepEqual(args, ["inspect", containerId]);
    return JSON.stringify([meta]);
  });
  syncBuiltinESMExports();
  t.mock.method(pg, "Pool", function (options) {
    calls.push(["pool", options]);
    assert.deepEqual(options, {
      host: "127.0.0.1",
      port: 54329,
      user: "postgres",
      database: "postgres",
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });
    return {
      async connect() {
        return {
          async query(sql) {
            calls.push(["query", sql]);
            if (sql.includes("pg_control_system()")) return { rows: [identity] };
            if (["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "ROLLBACK"].includes(sql))
              return { rows: [] };
            assert.fail("Unexpected SQL: " + sql);
          },
          release() {},
        };
      },
      async end() {
        calls.push(["end"]);
      },
    };
  });
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { calls, meta, identity };
}

for (const image of [PINNED_POSTGRES_17, PINNED_POSTGRES_18]) {
  test(`importer accepts the fixed pin and invalidates closed handles: ${image}`, async (t) => {
    const f = fixture(t, image);
    const target = await verifyImportTarget(config);
    assert.equal(target.identity, config.targetIdentity);
    assert.equal(target.systemIdentifier, f.identity.system_id);
    assert.equal(Object.isFrozen(target), true);
    await target.close();
    await assert.rejects(snapshotDatabase(target), /IMPORT_UNVERIFIED_TARGET/);
    assert.equal(f.calls.filter(([cmd]) => cmd === "docker").length, 1);
  });
}

for (const image of [
  "pgvector/pgvector:pg18",
  "postgres:18",
  PINNED_POSTGRES_18.replace("pgvector/pgvector", "foreign/image"),
  "pgvector/pgvector@sha256:" + "b".repeat(64),
]) {
  test(`importer rejects nonallowlisted image before opening a pool: ${image}`, async (t) => {
    const f = fixture(t, image);
    await assert.rejects(verifyImportTarget(config), /IMPORT_TARGET/);
    assert.deepEqual(
      f.calls.map(([cmd]) => cmd),
      ["docker"],
    );
  });
}

for (const [label, mutate] of [
  [
    "full inspected id",
    (m) => {
      m.Id = "b".repeat(64);
    },
  ],
  [
    "owned name",
    (m) => {
      m.Name = "/foreign";
    },
  ],
  [
    "running state",
    (m) => {
      m.State.Running = false;
    },
  ],
  [
    "loopback binding",
    (m) => {
      m.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0";
    },
  ],
  [
    "single binding",
    (m) => {
      m.NetworkSettings.Ports["5432/tcp"].push({ HostIp: "127.0.0.1", HostPort: "54330" });
    },
  ],
]) {
  test(`PG18 importer preserves ${label} refusal`, async (t) => {
    const f = fixture(t);
    mutate(f.meta);
    await assert.rejects(verifyImportTarget(config), /IMPORT_TARGET/);
    assert.deepEqual(
      f.calls.map(([cmd]) => cmd),
      ["docker"],
    );
  });
}

test("short ids and mismatched target identities are refused before Docker inspection", async (t) => {
  const f = fixture(t);
  for (const bad of [
    { ...config, containerId: "a".repeat(12) },
    { ...config, targetIdentity: "owned:foreign:postgres" },
  ]) {
    await assert.rejects(verifyImportTarget(bad), /IMPORT_TARGET/);
  }
  assert.deepEqual(f.calls, []);
});

for (const key of urlKeys) {
  test(`importer refuses ${key} before Docker inspection`, async (t) => {
    const f = fixture(t);
    process.env[key] = "postgres://refused.invalid/database";
    await assert.rejects(verifyImportTarget(config), /IMPORT_REFUSES_URL_ENV/);
    assert.deepEqual(f.calls, []);
  });
}

for (const key of ["db", "usr"]) {
  test(`PG18 importer preserves database identity check: ${key}`, async (t) => {
    const f = fixture(t);
    f.identity[key] = "foreign";
    await assert.rejects(verifyImportTarget(config), /IMPORT_TARGET_DATABASE/);
    assert.equal(f.calls.at(-1)[0], "end");
  });
}

test("forged handles cannot inspect or connect", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    snapshotDatabase({ identity: config.targetIdentity, systemIdentifier: "123456789" }),
    /IMPORT_UNVERIFIED_TARGET/,
  );
  assert.deepEqual(f.calls, []);
});

test("PG18 operations re-inspect the image and recheck the database system identifier", async (t) => {
  const f = fixture(t);
  const target = await verifyImportTarget(config);
  try {
    f.meta.Config.Image = "pgvector/pgvector:pg18";
    await assert.rejects(snapshotDatabase(target), /IMPORT_TARGET/);
    f.meta.Config.Image = PINNED_POSTGRES_18;
    f.identity.system_id = "987654321";
    await assert.rejects(snapshotDatabase(target), /IMPORT_TARGET_CHANGED/);
    assert.deepEqual(f.calls.at(-1), ["query", "ROLLBACK"]);
  } finally {
    await target.close();
  }
});
