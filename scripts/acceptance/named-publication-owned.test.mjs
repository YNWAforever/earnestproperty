import test from "node:test";
import assert from "node:assert/strict";
import {
  PINNED_IMAGE,
  captureLocalPlatform,
  cleanupOwnedLaunch,
  containerArguments,
  verifyContainerAdmission,
  verifyContainerOwnership,
} from "./named-publication-cleanup.mjs";
import { cleanEnvironment, validateSocketTarget } from "./named-publication-isolation.mjs";
import { guardOwnedPool, validateHelperRun } from "./named-publication-harness.mjs";
import { createLaunchController, parseOptions } from "./named-publication-owned.mjs";

const launch = {
  context: "local-test",
  endpoint: "unix:///var/run/docker.sock",
  daemon: "synthetic-daemon-per-launch",
  image: PINNED_IMAGE,
  imageId: "sha256:" + "b".repeat(64),
  runId: "named-publication-11111111-1111-4111-8111-111111111111",
};
const expected = {
  ...launch,
  name: "earnest-remediation-qa-22222222-2222-4222-8222-222222222222",
  id: "a".repeat(64),
};

function fixture(change = {}, behavior = {}) {
  let alive = true;
  const calls = [],
    mutations = [];
  const metadata = {
    Id: expected.id,
    Name: "/" + expected.name,
    Config: {
      Image: PINNED_IMAGE,
      Labels: {
        "earnest.named-publication.run": launch.runId,
        "earnest.named-publication.scope": "single-target-publisher",
      },
    },
    Image: launch.imageId,
    ...change,
  };
  const docker = (...args) => {
    calls.push(args);
    if (args[0] === "context") return JSON.stringify(launch.endpoint);
    if (args[0] === "info")
      return JSON.stringify(behavior.wrongDaemon ? "another-daemon" : launch.daemon);
    if (args[0] === "inspect") {
      if (behavior.denied || (behavior.readbackDenied && !alive)) throw Error("PERMISSION_DENIED");
      if (!alive || behavior.absent) throw Error("Error: No such object: " + args[1]);
      assert.ok([expected.id, expected.name].includes(args[1]));
      return JSON.stringify([metadata]);
    }
    if (args[0] === "rm") {
      assert.deepEqual(args, ["rm", "--force", expected.id]);
      mutations.push(args);
      if (behavior.removeDenied) throw Error("REMOVE_DENIED");
      alive = false;
      if (behavior.lostAck) throw Error("RM_ACK_LOST");
      return expected.id;
    }
    throw Error("UNEXPECTED_DOCKER_OPERATION");
  };
  return { docker, calls, mutations, alive: () => alive };
}

test("parent removes exactly the owned resource and reads back exact-ID absence", () => {
  const f = fixture();
  const result = cleanupOwnedLaunch(expected, f.docker);
  assert.equal(result.removed, true);
  assert.equal(result.ownershipVerified, true);
  assert.equal(result.existed, true);
  assert.equal(f.alive(), false);
  assert.deepEqual(f.calls.at(-1), ["inspect", expected.id]);
  assert.equal(f.mutations.length, 1);
});

test("missing handoff makes no Docker calls", () => {
  const f = fixture();
  assert.equal(cleanupOwnedLaunch(null, f.docker).status, "NO_OWNERSHIP_HANDOFF");
  assert.equal(f.calls.length, 0);
});

test("already absent is safe but does not prove a resource existed", () => {
  const f = fixture({}, { absent: true });
  const result = cleanupOwnedLaunch(expected, f.docker);
  assert.equal(result.status, "ALREADY_ABSENT");
  assert.equal(result.existed, false);
  assert.equal(f.mutations.length, 0);
});

test("mismatched name, ID, image reference, image ID or either label blocks removal", () => {
  const changes = [
    { Id: "c".repeat(64) },
    { Name: "/unowned" },
    { Image: "sha256:" + "c".repeat(64) },
    { Config: { Image: "other", Labels: {} } },
    {
      Config: {
        Image: PINNED_IMAGE,
        Labels: {
          "earnest.named-publication.run": "other",
          "earnest.named-publication.scope": "single-target-publisher",
        },
      },
    },
    {
      Config: {
        Image: PINNED_IMAGE,
        Labels: {
          "earnest.named-publication.run": launch.runId,
          "earnest.named-publication.scope": "other",
        },
      },
    },
  ];
  for (const change of changes) {
    const f = fixture(change);
    assert.throws(() => cleanupOwnedLaunch(expected, f.docker));
    assert.equal(f.mutations.length, 0);
  }
});

test("daemon mismatch stops before container inspection or removal", () => {
  const f = fixture({}, { wrongDaemon: true });
  assert.throws(() => cleanupOwnedLaunch(expected, f.docker));
  assert.equal(
    f.calls.some(([op]) => op === "inspect"),
    false,
  );
  assert.equal(f.mutations.length, 0);
});

test("permission failure cannot be mistaken for absence", () => {
  const f = fixture({}, { denied: true });
  assert.throws(() => cleanupOwnedLaunch(expected, f.docker), /PERMISSION_DENIED/);
  assert.equal(f.mutations.length, 0);
});

test("pre-ID atomic handoff can remove only the matching name and labels", () => {
  const f = fixture();
  assert.equal(cleanupOwnedLaunch({ ...expected, id: null }, f.docker).removed, true);
  assert.equal(f.mutations.length, 1);
});

test("unknown removal acknowledgement is reconciled without a second rm", () => {
  const f = fixture({}, { lostAck: true });
  const result = cleanupOwnedLaunch(expected, f.docker);
  assert.equal(result.removed, true);
  assert.equal(result.removalAcknowledgementLost, true);
  assert.equal(f.mutations.length, 1);
});

test("failed rm is preserved and never retried", () => {
  const f = fixture({}, { removeDenied: true });
  assert.throws(
    () => cleanupOwnedLaunch(expected, f.docker),
    (error) => {
      assert.match(error.message, /OWNED_CONTAINER_STILL_EXISTS/);
      assert.equal(error.cause.message, "REMOVE_DENIED");
      return true;
    },
  );
  assert.equal(f.alive(), true);
  assert.equal(f.mutations.length, 1);
});

test("unreadable absence readback stays blocked and retains lost rm ACK", () => {
  const f = fixture({}, { lostAck: true, readbackDenied: true });
  assert.throws(
    () => cleanupOwnedLaunch(expected, f.docker),
    (error) => {
      assert.match(error.message, /PERMISSION_DENIED/);
      assert.equal(error.removalError.message, "RM_ACK_LOST");
      return true;
    },
  );
  assert.equal(f.mutations.length, 1);
});

test("a denied inspect mentioning No such object is not an absence ACK", () => {
  const f = fixture();
  assert.throws(() =>
    cleanupOwnedLaunch(expected, (...args) => {
      if (args[0] === "inspect") throw Error("permission denied: No such object: " + expected.id);
      return f.docker(...args);
    }),
  );
  assert.equal(f.mutations.length, 0);
});

test("local platform captures this launch's daemon and image config ID without pulling", () => {
  const calls = [];
  const raw = (...args) => {
    calls.push(args);
    if (args[0] === "context" && args[1] === "show") return launch.context;
    const command = args.slice(2);
    if (command[0] === "context") return JSON.stringify(launch.endpoint);
    if (command[0] === "info") return JSON.stringify(launch.daemon);
    if (command[0] === "image")
      return JSON.stringify({
        Id: launch.imageId,
        RepoDigests: [PINNED_IMAGE],
      });
    throw Error("UNEXPECTED");
  };
  assert.deepEqual(captureLocalPlatform(raw), {
    context: launch.context,
    endpoint: launch.endpoint,
    daemon: launch.daemon,
    image: PINNED_IMAGE,
    imageId: launch.imageId,
  });
  assert.equal(
    calls.some((args) => args.includes("pull")),
    false,
  );
});

test("remote or changed context endpoints block cleanup before mutation", () => {
  for (const endpoint of ["tcp://127.0.0.1:2375", "ssh://host", "unix:///other/socket"]) {
    const f = fixture();
    assert.throws(() =>
      cleanupOwnedLaunch(expected, (...args) =>
        args[0] === "context" ? JSON.stringify(endpoint) : f.docker(...args),
      ),
    );
    assert.equal(f.mutations.length, 0);
  }
});

test("container launch is pinned, no-pull, tmpfs, memory-capped and loopback only", () => {
  const args = containerArguments(expected);
  for (const [flag, value] of [
    ["--pull", "never"],
    ["--memory", "512m"],
    ["--memory-swap", "512m"],
    ["--publish", "127.0.0.1::5432"],
    ["--network", "bridge"],
  ]) {
    assert.equal(args[args.indexOf(flag) + 1], value);
  }
  assert.ok(args.includes(PINNED_IMAGE));
  assert.ok(args.includes("cluster_name=" + launch.runId));
  assert.ok(args.includes("/var/lib/postgresql/data:rw,nosuid,noexec,size=268435456"));
  assert.equal(args.includes("--volume"), false);
  assert.equal(args.includes("--rm"), false);
});

test("only the exact helper launch contract is accepted", () => {
  const args = [
    "run",
    "--rm",
    "--pull",
    "never",
    "--detach",
    "--name",
    expected.name,
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--publish",
    "127.0.0.1::5432",
    PINNED_IMAGE,
  ];
  assert.equal(validateHelperRun(args), expected.name);
  assert.throws(() => validateHelperRun([...args, "extra"]));
  assert.throws(() => validateHelperRun(args.map((arg) => (arg === "never" ? "always" : arg))));
});

test("launcher accepts only normal run or one timeout-proof option", () => {
  assert.equal(parseOptions([]).timeoutProof, false);
  assert.equal(parseOptions(["--timeout-proof"]).timeoutProof, true);
  for (const args of [["--help"], ["--timeout-proof", "extra"], ["--eval", "code"]])
    assert.throws(() => parseOptions(args), /UNSUPPORTED_LAUNCH_OPTION/);
});

test("environment is an allowlist; database, auth, Node and Docker overrides disappear", () => {
  assert.deepEqual(
    cleanEnvironment({
      PATH: "runtime",
      HOME: "/home/test",
      DATABASE_URL: "bad",
      ASTRA_TEST_DATABASE_URL: "bad",
      PGHOST: "bad",
      NODE_OPTIONS: "bad",
      DOCKER_HOST: "bad",
      TOKEN: "bad",
      UNRELATED_SECRET: "bad",
    }),
    { NO_COLOR: "1", PATH: "runtime", HOME: "/home/test" },
  );
});

test("socket gate accepts only the inspected loopback port and rejects paths/hostnames/default hosts", () => {
  validateSocketTarget([{ host: "127.0.0.1", port: 54321 }], 54321);
  validateSocketTarget([54321, "127.0.0.1"], 54321);
  validateSocketTarget([[{ host: "127.0.0.1", port: 54321 }]], 54321);
  for (const args of [
    [{ host: "localhost", port: 54321 }],
    [{ host: "127.0.0.1", port: 54322 }],
    [{ path: "/socket" }],
    [54321],
    [{ host: "example.com", port: 443 }],
  ])
    assert.throws(() => validateSocketTarget(args, 54321));
  assert.throws(() => validateSocketTarget([{ host: "127.0.0.1", port: 54321 }], null));
});

const server = {
  database: "postgres",
  role: "postgres",
  cluster_name: launch.runId,
  data_directory: "/var/lib/postgresql/data",
  version: 170000,
  server_port: 5432,
  system_identifier: "1234567890123456789",
};
test("actual server and exact pg_controldata identifier gate precede any migration/fixture", async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [server] };
    },
    connect: async () => {
      calls.push("connect");
      return {};
    },
  };
  const guarded = guardOwnedPool(pool, {
    runId: launch.runId,
    controlData: () => "Database system identifier: " + server.system_identifier + "\n",
    onVerified: () => calls.push("verified"),
  });
  await guarded.query("CREATE TABLE synthetic_gate(id int)");
  assert.match(calls[0], /pg_control_system/);
  assert.deepEqual(calls.slice(1), ["verified", "CREATE TABLE synthetic_gate(id int)"]);
});

test("identity wrapper preserves pg.Pool internal query-to-connect dispatch", async () => {
  const internalConnect = async () => ({ synthetic: true });
  const pool = {
    connect: internalConnect,
    async query(sql) {
      assert.equal(
        this.connect,
        internalConnect,
        "pg internals must keep their original connect method",
      );
      await this.connect();
      return { rows: sql.includes("pg_control_system") ? [server] : [] };
    },
  };
  const guarded = guardOwnedPool(pool, {
    runId: launch.runId,
    controlData: () => "Database system identifier: " + server.system_identifier,
  });
  await guarded.query("SELECT synthetic");
  assert.equal(pool.connect, internalConnect);
});

test("image-declared data volume is admitted only when actual storage is owned tmpfs", () => {
  const f = fixture();
  const metadata = JSON.parse(f.docker("inspect", expected.id))[0];
  metadata.Config.Volumes = { "/var/lib/postgresql/data": {} };
  metadata.State = { Running: true };
  metadata.HostConfig = {
    Memory: 512 * 1024 * 1024,
    MemorySwap: 512 * 1024 * 1024,
    NetworkMode: "bridge",
    Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,noexec,size=268435456" },
  };
  metadata.Mounts = [{ Type: "tmpfs", Destination: "/var/lib/postgresql/data" }];
  metadata.NetworkSettings = {
    Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
  };
  assert.equal(verifyContainerAdmission(metadata, expected).port, 54321);
  metadata.Mounts = [{ Type: "volume", Destination: "/var/lib/postgresql/data" }];
  assert.throws(() => verifyContainerAdmission(metadata, expected));
});

test("server identity mismatches and substring-only control identifiers block all writes/connect", async () => {
  for (const changed of [
    { cluster_name: "other" },
    { system_identifier: "123" },
    { database: "other" },
    { role: "other" },
    { data_directory: "/other" },
  ]) {
    let writes = 0;
    const guarded = guardOwnedPool(
      {
        query: async (sql) => {
          if (!sql.includes("pg_control_system")) writes++;
          return { rows: [{ ...server, ...changed }] };
        },
        connect: async () => {
          writes++;
        },
      },
      {
        runId: launch.runId,
        controlData: () => "Database system identifier: " + server.system_identifier,
      },
    );
    await assert.rejects(() => guarded.query("CREATE TABLE forbidden(id int)"));
    await assert.rejects(() => guarded.connect());
    assert.equal(writes, 0);
  }
});

function controllerFixture(behavior = {}, timeoutProof = false) {
  const f = fixture({}, behavior);
  const records = new Map([["ownership.json", { ...expected, id: null }]]);
  const events = [];
  const controller = createLaunchController({
    launch: { ...launch, timeoutProof },
    docker: (...args) => {
      if (args[0] === "run") {
        events.push("run");
        return expected.id;
      }
      return f.docker(...args);
    },
    read: (name) => records.get(name) ?? null,
    save: (name, value) => {
      records.set(name, value);
      events.push(name);
    },
    onReady: () => events.push("ready"),
  });
  return { ...f, records, events, controller };
}

test("parent acknowledges creation only after atomic pre-ID ownership and does not retry run", () => {
  const f = controllerFixture();
  f.controller.poll();
  f.controller.poll();
  assert.equal(f.events.filter((event) => event === "run").length, 1);
  assert.equal(f.records.get("ownership.json").id, expected.id);
  assert.equal(f.records.get("container.json").id, expected.id);
});

test("proof requires verified server readiness, a killed child, actual existence and removal", () => {
  const f = controllerFixture({}, true);
  f.controller.poll();
  f.records.set("ready.json", {
    id: expected.id,
    runId: launch.runId,
    serverVerified: true,
  });
  f.controller.poll();
  assert.ok(f.events.includes("ready"));
  const result = f.controller.finish({
    code: null,
    signal: "SIGKILL",
    proofKilled: true,
  });
  assert.equal(result.proofPassed, true);
  assert.equal(result.exitCode, 0);
});

test("timeout or an already-absent resource without verified existence never false-passes proof", () => {
  for (const behavior of [{}, { absent: true }]) {
    const f = controllerFixture(behavior, true);
    f.controller.poll();
    const result = f.controller.finish({
      code: null,
      signal: "SIGKILL",
      proofKilled: true,
    });
    assert.equal(result.proofPassed, false);
    assert.equal(result.exitCode, 1);
  }
});

test("parent cleanup failure preserves the original child exit and does not retry removal", () => {
  const f = controllerFixture({ removeDenied: true });
  f.controller.poll();
  const result = f.controller.finish({ code: 7, signal: null });
  assert.equal(result.childExitCode, 7);
  assert.equal(result.exitCode, 7);
  assert.equal(result.cleanup.status, "CLEANUP_BLOCKED");
  assert.equal(f.mutations.length, 1);
});

test("ownership validation is pure and accepts a captured daemon rather than a laptop constant", () => {
  const f = fixture();
  const metadata = JSON.parse(f.docker("inspect", expected.id))[0];
  assert.equal(verifyContainerOwnership(metadata, expected).id, expected.id);
});
