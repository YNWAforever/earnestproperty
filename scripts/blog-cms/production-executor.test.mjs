import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mock, test } from "node:test";
import pg from "pg";
import "../acceptance/owned-postgres-test.mjs";

const { canonical } = await import("../../src/lib/blog/reconcile.ts");
const { releaseArtifacts } = await import("../../src/lib/neon/blog-release-packet.ts");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const seal = (value) => sha(canonical(value));
const keys = Object.fromEntries(
  ["mapping", "approval", "recovery", "fence"].map((kind) => [
    kind,
    generateKeyPairSync("ed25519"),
  ]),
);
const authority = {
  format: "earnest-blog-release-authority-v1",
  ...Object.fromEntries(
    Object.entries(keys).map(([kind, pair]) => [
      kind + "Key",
      pair.publicKey.export({ type: "spki", format: "pem" }),
    ]),
  ),
};
let currentFence, credential, configured;
const trace = [];
const fixtureMapping = {
  projectId: "fixture-project",
  branchId: "fixture-branch",
  endpointId: "ep-fixture",
  database: "fixture-db",
};
mock.module(new URL("./production-target.ts", import.meta.url), {
  exports: {
    PRODUCTION_TARGET: fixtureMapping,
    PRODUCTION_IDENTITY: Object.values(fixtureMapping).join(":"),
  },
});
mock.module(new URL("./production-authority.ts", import.meta.url), {
  exports: {
    loadProductionAuthority() {
      if (!configured)
        throw new Error("PRODUCTION_EXECUTION_UNAVAILABLE: trusted authority absent");
      return authority;
    },
    loadProductionCredential(target) {
      assert.deepEqual(target, credential.target);
      trace.push("credential");
      return credential.password;
    },
    loadCurrentFence() {
      trace.push("fence-read");
      return currentFence;
    },
  },
});
mock.module(new URL("../../src/lib/neon/blog-release-transaction.ts", import.meta.url), {
  exports: {
    async runBlogRelease(client, target, inputs) {
      trace.push("core");
      assert.equal(client, activeClient);
      assert.equal(target.identity, PRODUCTION_IDENTITY);
      assert.equal(inputs.bundle.sourceRevision, "fixture");
      if (revokeDuringCore) currentFence = undefined;
      return { packetSha256: inputs.packetSha256, writes: 112 };
    },
  },
});
const { executeProductionRelease, PRODUCTION_TARGET, PRODUCTION_IDENTITY } =
  await import("./production-adapter.ts");

const raw = Buffer.from("fixture-certificate-never-used-on-the-network");
const target = {
  ...PRODUCTION_TARGET,
  host: PRODUCTION_TARGET.endpointId + ".fixture.neon.tech",
  port: 5432,
  role: "fixture_release_role",
  systemIdentifier: "123456789",
  serverVersion: 180006,
};
const certificate = { raw, subjectaltname: "DNS:" + target.host };
const artifacts = releaseArtifacts();
function signed(record, kind, key = keys[kind].privateKey) {
  return { record, signature: sign(null, Buffer.from(canonical(record)), key).toString("base64") };
}
function fixture(edit = {}) {
  trace.length = 0;
  configured = true;
  revokeDuringCore = false;
  const now = Date.now();
  const sourceBytes = Buffer.from(JSON.stringify({ sourceRevision: "fixture" }));
  const packet = {
    format: "earnest-blog-release-v1",
    targetIdentity: PRODUCTION_IDENTITY,
    systemIdentifier: target.systemIdentifier,
    sourceSha256: sha(sourceBytes),
    baselineSha256: "a".repeat(64),
    baselineSchemaSha256: "b".repeat(64),
    migratedSchemaSha256: "c".repeat(64),
    ...artifacts,
    ...edit.packet,
  };
  const packetBytes = Buffer.from(JSON.stringify(packet));
  const window = { startsAt: now - 1000, expiresAt: now + 240_000 };
  const mapping = {
    kind: "production-target-v1",
    ...window,
    target,
    certificateSha256: sha(raw),
    ...edit.mapping,
  };
  const recovery = {
    kind: "production-recovery-v1",
    ...window,
    target,
    backupArchiveSha256: "d".repeat(64),
    restoreReceiptSha256: "e".repeat(64),
    backupAt: now - 100_000,
    restoredAt: now - 50_000,
    ...edit.recovery,
  };
  const fence = {
    kind: "production-fence-v1",
    ...window,
    target,
    packetSha256: sha(packetBytes),
    generation: "fixture-generation",
    mode: "external-until-explicit-reopen",
    ...edit.fence,
  };
  const approval = {
    kind: "production-approval-v1",
    ...window,
    packetSha256: sha(packetBytes),
    mappingSha256: seal(mapping),
    recoverySha256: seal(recovery),
    fenceSha256: seal(fence),
    ...edit.approval,
  };
  const request = {
    packetBytes,
    sourceBytes,
    connection: {
      host: target.host,
      port: target.port,
      database: target.database,
      role: target.role,
      tls: "verify-full",
    },
    evidence: {
      mapping: signed(mapping, "mapping"),
      recovery: signed(recovery, "recovery"),
      approval: signed(approval, "approval"),
      fence: signed(fence, "fence"),
    },
  };
  credential = { target, password: "fixture-password" };
  currentFence = structuredClone(request.evidence.fence);
  session = {
    database: target.database,
    currentRole: target.role,
    sessionRole: target.role,
    systemIdentifier: target.systemIdentifier,
    serverVersion: target.serverVersion,
    backendPid: 777,
    tls: true,
    inRecovery: false,
  };
  peer = certificate;
  return request;
}

let session, activeClient, peer, revokeDuringCore;
function stubTransport(t) {
  t.mock.method(pg, "Client", function (options) {
    assert.equal(options.host, target.host);
    assert.equal(options.port, target.port);
    assert.equal(options.database, target.database);
    assert.equal(options.user, target.role);
    assert.equal(options.password, credential.password);
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.servername, target.host);
    assert.equal(options.connectionTimeoutMillis, 5000);
    const stream = new TLSSocket(new Socket());
    Object.defineProperties(stream, {
      authorized: { value: true },
      servername: { value: target.host },
      getPeerCertificate: { value: () => peer },
    });
    activeClient = {
      connection: { stream },
      on() {},
      async connect() {
        trace.push("connect");
        const error = options.ssl.checkServerIdentity(target.host, peer);
        if (error) throw error;
      },
      async query(sql) {
        if (sql.includes("pg_control_system()")) {
          trace.push("session");
          return { rows: [session] };
        }
        trace.push(sql.startsWith("SET LOCAL") ? "timeouts" : sql);
        return { rows: [] };
      },
      async end() {
        trace.push("end");
        stream.destroy();
      },
    };
    return activeClient;
  });
}
test("authenticates independent evidence and consumes the pinned capability on the real entry path", async (t) => {
  const request = fixture();
  stubTransport(t);
  assert.deepEqual(await executeProductionRelease(request), {
    packetSha256: sha(request.packetBytes),
    writes: 112,
  });
  assert.deepEqual(trace, [
    "fence-read",
    "credential",
    "connect",
    "session",
    "BEGIN",
    "timeouts",
    "session",
    "fence-read",
    "core",
    "session",
    "fence-read",
    "COMMIT",
    "end",
  ]);
});
test("absent owner authority fails closed before credential or network use", async (t) => {
  const request = fixture();
  configured = false;
  stubTransport(t);
  await assert.rejects(executeProductionRelease(request), /PRODUCTION_EXECUTION_UNAVAILABLE/);
  assert.deepEqual(trace, []);
});
test("forged evidence and stale fence fail before credential or network use", async (t) => {
  let request = fixture();
  stubTransport(t);
  request.evidence.approval = signed(request.evidence.approval.record, "mapping");
  await assert.rejects(executeProductionRelease(request), /PRODUCTION_EVIDENCE_SIGNATURE/);
  assert.deepEqual(trace, []);
  request = fixture();
  currentFence = signed({ ...currentFence.record, generation: "next-generation" }, "fence");
  await assert.rejects(executeProductionRelease(request), /PRODUCTION_FENCE_CHANGED/);
  assert.deepEqual(trace, ["fence-read"]);
});
test("never commits after fence generation is lost during the transaction", async (t) => {
  const request = fixture();
  revokeDuringCore = true;
  stubTransport(t);
  await assert.rejects(executeProductionRelease(request), /PRODUCTION_FENCE/);
  assert.deepEqual(trace.slice(-4), ["session", "fence-read", "ROLLBACK", "end"]);
});
test("rejects role mismatch and wrong certificate without reaching the core", async (t) => {
  const request = fixture();
  stubTransport(t);
  peer = { ...certificate, raw: Buffer.from("wrong pin") };
  await assert.rejects(executeProductionRelease(request), /PRODUCTION_TLS/);
  assert.ok(!trace.includes("core"));
  const second = fixture();
  session = { ...session, sessionRole: "other" };
  await assert.rejects(executeProductionRelease(second), /RELEASE_SESSION/);
  assert.ok(!trace.includes("BEGIN"));
});

for (const [label, edits, change, error] of [
  [
    "wrong project",
    { mapping: { target: { ...target, projectId: "other" } } },
    null,
    /PRODUCTION_TARGET/,
  ],
  [
    "wrong branch",
    { mapping: { target: { ...target, branchId: "other" } } },
    null,
    /PRODUCTION_TARGET/,
  ],
  [
    "wrong endpoint",
    { mapping: { target: { ...target, endpointId: "other" } } },
    null,
    /PRODUCTION_TARGET/,
  ],
  [
    "wrong database",
    { mapping: { target: { ...target, database: "other" } } },
    null,
    /PRODUCTION_TARGET/,
  ],
  [
    "local descriptor",
    {},
    (r) => {
      r.connection.host = "127.0.0.1";
    },
    /PRODUCTION_TARGET/,
  ],
  [
    "pooler descriptor",
    {},
    (r) => {
      r.connection.host = target.host.replace(".", "-pooler.");
    },
    /PRODUCTION_TARGET/,
  ],
  [
    "role descriptor mismatch",
    {},
    (r) => {
      r.connection.role = "other";
    },
    /PRODUCTION_TARGET/,
  ],
  ["expired approval", { approval: { expiresAt: 1 } }, null, /PRODUCTION_EVIDENCE_WINDOW/],
  ["expired recovery", { recovery: { expiresAt: 1 } }, null, /PRODUCTION_EVIDENCE_WINDOW/],
  ["expired fence", { fence: { expiresAt: 1 } }, null, /PRODUCTION_EVIDENCE_WINDOW/],
  ["restore before backup", { recovery: { restoredAt: 1 } }, null, /PRODUCTION_RECOVERY_WINDOW/],
  [
    "misbound restore receipt",
    { approval: { recoverySha256: "1".repeat(64) } },
    null,
    /PRODUCTION_EVIDENCE_BINDING/,
  ],
  [
    "misbound fence",
    { fence: { packetSha256: "1".repeat(64) } },
    null,
    /PRODUCTION_EVIDENCE_BINDING/,
  ],
  [
    "changed packet",
    {},
    (r) => {
      r.packetBytes = Buffer.concat([r.packetBytes, Buffer.from(" ")]);
    },
    /RELEASE_PACKET/,
  ],
  [
    "owned packet",
    { packet: { targetIdentity: "owned:fixture:postgres" } },
    null,
    /RELEASE_TARGET/,
  ],
  [
    "changed source",
    {},
    (r) => {
      r.sourceBytes = Buffer.concat([r.sourceBytes, Buffer.from(" ")]);
    },
    /RELEASE_SOURCE/,
  ],
  [
    "changed migrations",
    { packet: { migrationSha256: ["1".repeat(64)] } },
    null,
    /RELEASE_MIGRATIONS/,
  ],
  [
    "changed implementation",
    { packet: { implementationSha256: "1".repeat(64) } },
    null,
    /RELEASE_IMPLEMENTATION/,
  ],
  [
    "caller callback",
    {},
    (r) => {
      r.query = () => assert.fail("caller callback");
    },
    /PRODUCTION_REQUEST/,
  ],
  [
    "caller boolean",
    {},
    (r) => {
      r.approved = true;
    },
    /PRODUCTION_REQUEST/,
  ],
]) {
  test("rejects " + label + " before credential or network use", async (t) => {
    const request = fixture(edits);
    stubTransport(t);
    change?.(request);
    await assert.rejects(executeProductionRelease(request), error);
    assert.deepEqual(trace, []);
  });
}

test("refuses inherited connection configuration", async (t) => {
  const request = fixture();
  stubTransport(t);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "fixture-must-never-be-used";
  try {
    await assert.rejects(executeProductionRelease(request), /PRODUCTION_REFUSES_CONNECTION_ENV/);
    assert.deepEqual(trace, []);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
