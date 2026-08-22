import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer as createNodeServer, request } from "node:http";
import test from "node:test";

import { createSupervisor, createSupervisorServer } from "./server.mjs";

const TERMINAL_FILE = "/tmp/earnest-mls-terminal.json";

function envelope(overrides = {}) {
  return {
    environment: "production",
    hkDate: "2026-08-21",
    attemptId: "scheduled:production:2026-08-21",
    kind: "scheduled",
    mode: "shadow",
    scheduledTime: "2026-08-20T18:00:00.000Z",
    manualReason: null,
    commitSha: "a".repeat(40),
    ...overrides,
  };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal);
    return true;
  }
}

function idleTimers() {
  let nextId = 0;
  const callbacks = new Map();
  const cleared = [];
  return {
    callbacks,
    cleared,
    setTimer(callback, delay) {
      const handle = Object.freeze({ id: (nextId += 1), delay });
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimer(handle) {
      cleared.push(handle);
      callbacks.delete(handle);
    },
    runDelay(delay) {
      const entry = [...callbacks].find(([handle]) => handle.delay === delay);
      assert.ok(entry, `missing timer for ${delay}ms`);
      const [handle, callback] = entry;
      callbacks.delete(handle);
      callback();
      return handle;
    },
  };
}

function terminalRecord(overrides = {}) {
  const runId = "00000000-0000-4000-8000-000000000001";
  const evidencePrefix =
    `mls-sync/production/2026-08-21/${runId}/` +
    "scheduled-production-2026-08-21";
  return {
    attemptId: "scheduled:production:2026-08-21",
    runId,
    neonRunId: runId,
    status: "succeeded",
    exitCode: 0,
    failureCode: null,
    evidencePrefix,
    manifestKey: `${evidencePrefix}/manifest.json`,
    manifestPresent: true,
    ...overrides,
  };
}

test("accepts R2-normalized evidence prefixes for terminal correlation", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const runId = "00000000-0000-4000-8000-000000000001";
  const evidencePrefix =
    `mls-sync/production/2026-08-21/${runId}/` +
    "scheduled-production-2026-08-21";
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () =>
      terminalRecord({
        evidencePrefix,
        manifestKey: `${evidencePrefix}/manifest.json`,
      }),
    now: () => new Date("2026-08-21T02:30:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });

  await supervisor.start(envelope());
  child.emit("exit", 0, null);
  const status = await supervisor.waitForTerminal();

  assert.equal(status.state, "succeeded");
  assert.equal(status.failureCode, null);
  assert.equal(status.evidencePrefix, evidencePrefix);
  assert.equal(status.manifestKey, `${evidencePrefix}/manifest.json`);
});

test("starts one exact CLI child, snapshots metadata, and replays idempotently", async () => {
  const child = new FakeChild();
  const spawns = [];
  const timers = idleTimers();
  const inheritedEnvironment = {
    DATABASE_URL_UNPOOLED: "postgresql://private.invalid/db",
    MLS_SUPERVISOR_TOKEN: "never-pass-this-to-the-child",
    MLS_EVIDENCE_BACKEND: "r2",
  };
  const run = envelope();
  const supervisor = createSupervisor({
    spawnChild(command, args, options) {
      spawns.push({ command, args, options });
      return child;
    },
    readTerminalStatus: async () => {
      throw new Error("terminal status is not read before exit");
    },
    now: () => new Date("2026-08-21T02:30:00.123Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: inheritedEnvironment,
    terminalStatusFile: TERMINAL_FILE,
  });

  const first = supervisor.start(run);
  run.mode = "publish";
  inheritedEnvironment.DATABASE_URL_UNPOOLED =
    "postgresql://mutated.invalid/db";
  const firstStatus = await first;
  const replayStatus = await supervisor.start(envelope());

  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, process.execPath);
  assert.deepEqual(spawns[0].args, ["scripts/mls/sync.mjs", "--mode=shadow"]);
  assert.equal(
    spawns[0].options.env.DATABASE_URL_UNPOOLED,
    "postgresql://private.invalid/db",
  );
  assert.equal(spawns[0].options.env.MLS_SUPERVISOR_TOKEN, undefined);
  assert.equal(spawns[0].options.env.MLS_ENVIRONMENT, "production");
  assert.equal(spawns[0].options.env.MLS_SCHEDULED_FOR, "2026-08-21");
  assert.equal(
    spawns[0].options.env.MLS_ATTEMPT_ID,
    "scheduled:production:2026-08-21",
  );
  assert.equal(spawns[0].options.env.MLS_COMMIT_SHA, "a".repeat(40));
  assert.equal(
    spawns[0].options.env.MLS_ATTEMPT_STARTED_AT,
    "2026-08-21T02:30:00.123Z",
  );
  assert.equal(spawns[0].options.env.MLS_TERMINAL_STATUS_FILE, TERMINAL_FILE);
  assert.deepEqual(replayStatus, firstStatus);
  assert.deepEqual(firstStatus, {
    attemptId: "scheduled:production:2026-08-21",
    state: "running",
    startedAt: "2026-08-21T02:30:00.123Z",
    heartbeatAt: "2026-08-21T02:30:00.123Z",
    completedAt: null,
    exitCode: null,
    failureCode: null,
    runId: null,
    neonRunId: null,
    evidencePrefix: null,
    manifestKey: null,
    manifestPresent: false,
  });
  assert.equal(Object.isFrozen(firstStatus), true);
  assert.notEqual(replayStatus, firstStatus);
});

test("rejects a different second envelope with a fixed conflict", async () => {
  const child = new FakeChild();
  let spawnCount = 0;
  const timers = idleTimers();
  const supervisor = createSupervisor({
    spawnChild() {
      spawnCount += 1;
      return child;
    },
    readTerminalStatus: async () => ({}),
    now: () => new Date("2026-08-21T02:30:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });

  await supervisor.start(envelope());
  await assert.rejects(
    () =>
      supervisor.start(
        envelope({
          attemptId: "scheduled:production:2026-08-21:manual:retry-0001",
          kind: "manual",
          manualReason: "operator approved retry",
        }),
      ),
    { code: "run_conflict" },
  );
  assert.equal(spawnCount, 1);
  assert.equal(supervisor.status().attemptId, envelope().attemptId);
});

test("rejects non-exact or inconsistent envelopes before spawning", async () => {
  let spawnCount = 0;
  const timers = idleTimers();
  const supervisor = createSupervisor({
    spawnChild() {
      spawnCount += 1;
      return new FakeChild();
    },
    readTerminalStatus: async () => ({}),
    now: () => new Date("2026-08-21T02:30:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });

  await assert.rejects(() => supervisor.start({ ...envelope(), extra: true }), {
    code: "invalid_run_envelope",
  });
  await assert.rejects(
    () => supervisor.start(envelope({ hkDate: "2026-08-22" })),
    { code: "invalid_run_envelope" },
  );
  await assert.rejects(
    () => supervisor.start(envelope({ commitSha: "A".repeat(40) })),
    { code: "invalid_run_envelope" },
  );
  const accessor = envelope();
  Object.defineProperty(accessor, "mode", {
    enumerable: true,
    get() {
      throw new Error("envelope getter must not execute");
    },
  });
  await assert.rejects(() => supervisor.start(accessor), {
    code: "invalid_run_envelope",
  });
  assert.equal(spawnCount, 0);
  assert.equal(supervisor.status().state, "pending");
});

test("refreshes heartbeat on the configured cadence", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T02:30:30.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () => terminalRecord(),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  assert.deepEqual(
    [...timers.callbacks.keys()]
      .map((handle) => handle.delay)
      .sort((left, right) => left - right),
    [30_000, 4 * 60 * 60 * 1_000],
  );
  timers.runDelay(30_000);
  assert.equal(supervisor.status().heartbeatAt, "2026-08-21T02:30:30.000Z");
  assert.equal(
    [...timers.callbacks.keys()].filter((handle) => handle.delay === 30_000)
      .length,
    1,
  );
});

test("times out once, waits for exit, and keeps the fixed timeout classification", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T06:30:00.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () =>
      terminalRecord({
        status: "failed",
        exitCode: 143,
        failureCode: "process_interrupted",
      }),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  const timeoutHandle = [...timers.callbacks.keys()].find(
    (handle) => handle.delay === 4 * 60 * 60 * 1_000,
  );
  const timeoutCallback = timers.callbacks.get(timeoutHandle);
  timers.runDelay(4 * 60 * 60 * 1_000);
  timeoutCallback();
  assert.deepEqual(child.kills, ["SIGTERM"]);
  assert.equal(supervisor.status().state, "running");
  child.emit("exit", 143, "SIGTERM");
  const status = await supervisor.waitForTerminal();
  assert.equal(status.state, "failed");
  assert.equal(status.failureCode, "run_timeout");
  assert.equal(status.exitCode, 143);
  assert.equal(status.manifestPresent, true);
  assert.equal(timers.callbacks.size, 0);
});

test("forwards each host signal at most once without making terminal state mutable", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T02:31:00.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () =>
      terminalRecord({
        status: "failed",
        exitCode: 40,
        failureCode: "mls_run_failed",
        manifestKey: null,
        manifestPresent: false,
      }),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  supervisor.forwardSignal("SIGTERM");
  supervisor.forwardSignal("SIGTERM");
  supervisor.forwardSignal("SIGINT");
  supervisor.forwardSignal("SIGINT");
  assert.deepEqual(child.kills, ["SIGTERM", "SIGINT"]);
  child.emit("exit", 40, null);
  const terminal = await supervisor.waitForTerminal();
  child.emit("error", new Error("late secret: postgresql://do-not-leak"));
  child.emit("exit", 0, null);
  assert.deepEqual(supervisor.status(), terminal);
  assert.equal(timers.callbacks.size, 0);
});

test("child error wins before exit, clears timers, and never exposes raw errors", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T02:30:01.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () => terminalRecord(),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  child.emit(
    "error",
    new Error(
      "postgresql://user:password@example.invalid/db BLOB_READ_WRITE_TOKEN=secret",
    ),
  );
  const terminal = await supervisor.waitForTerminal();
  assert.equal(terminal.state, "unknown");
  assert.equal(terminal.failureCode, "child_start_failed");
  assert.equal(JSON.stringify(terminal).includes("password"), false);
  assert.equal(
    JSON.stringify(terminal).includes("BLOB_READ_WRITE_TOKEN"),
    false,
  );
  assert.equal(timers.callbacks.size, 0);
  child.emit("exit", 0, null);
  assert.deepEqual(supervisor.status(), terminal);
});

test("keeps a timeout latched through child error until exit and terminal IPC", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T06:30:00.000Z"),
  ];
  let reads = 0;
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () => {
      reads += 1;
      return terminalRecord({
        status: "failed",
        exitCode: 143,
        failureCode: "process_interrupted",
      });
    },
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  timers.runDelay(4 * 60 * 60 * 1_000);
  child.emit("error", new Error("post-spawn timeout race"));
  assert.equal(supervisor.status().state, "running");
  assert.equal(reads, 0);
  child.emit("exit", 143, "SIGTERM");
  const terminal = await supervisor.waitForTerminal();
  assert.equal(reads, 1);
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.failureCode, "run_timeout");
  assert.equal(terminal.exitCode, 143);
  assert.equal(terminal.manifestPresent, true);
});

test("preserves a timeout when its completion clock is invalid", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [new Date("2026-08-21T02:30:00.000Z"), new Date(Number.NaN)];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () =>
      terminalRecord({
        status: "failed",
        exitCode: 143,
        failureCode: "process_interrupted",
      }),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  timers.runDelay(4 * 60 * 60 * 1_000);
  child.emit("exit", 143, "SIGTERM");
  const terminal = await supervisor.waitForTerminal();
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.failureCode, "run_timeout");
  assert.equal(terminal.completedAt, "2026-08-21T02:30:00.000Z");
  assert.equal(terminal.exitCode, 143);
  assert.equal(Object.isFrozen(terminal), true);
  assert.equal(timers.callbacks.size, 0);
});

test("keeps a supervisor clock failure latched through child error until exit", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date(Number.NaN),
    new Date("2026-08-21T02:31:00.000Z"),
  ];
  let reads = 0;
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () => {
      reads += 1;
      return terminalRecord({
        status: "failed",
        exitCode: 40,
        failureCode: "mls_run_failed",
        manifestKey: null,
        manifestPresent: false,
      });
    },
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  timers.runDelay(30_000);
  child.emit("error", new Error("post-spawn clock race"));
  assert.equal(supervisor.status().state, "running");
  assert.equal(reads, 0);
  child.emit("exit", 40, null);
  const terminal = await supervisor.waitForTerminal();
  assert.equal(reads, 1);
  assert.equal(terminal.state, "unknown");
  assert.equal(terminal.failureCode, "supervisor_clock_failed");
  assert.equal(terminal.exitCode, 40);
});

test("falls back atomically when the completion clock is invalid", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [new Date("2026-08-21T02:30:00.000Z"), new Date(Number.NaN)];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () => terminalRecord(),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  let resolutions = 0;
  const waiting = supervisor.waitForTerminal().then((status) => {
    resolutions += 1;
    return status;
  });
  child.emit("exit", 0, null);
  const outcome = await Promise.race([
    waiting.then((status) => ({ status })),
    new Promise((resolve) => setImmediate(() => resolve({ status: null }))),
  ]);
  assert.notEqual(outcome.status, null);
  assert.equal(outcome.status.state, "unknown");
  assert.equal(outcome.status.failureCode, "supervisor_clock_failed");
  assert.equal(outcome.status.completedAt, "2026-08-21T02:30:00.000Z");
  assert.equal(outcome.status.exitCode, 0);
  assert.equal(Object.isFrozen(outcome.status), true);
  assert.equal(resolutions, 1);
  child.emit("error", new Error("late event"));
  child.emit("exit", 40, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolutions, 1);
  assert.deepEqual(supervisor.status(), outcome.status);
  assert.equal(timers.callbacks.size, 0);
});

test("normalizes synchronous spawn throws and asynchronous spawn rejection", async () => {
  for (const spawnChild of [
    () => {
      throw new Error("spawn threw with credential=secret");
    },
    async () => {
      throw new Error("spawn rejected with credential=secret");
    },
  ]) {
    const timers = idleTimers();
    const times = [
      new Date("2026-08-21T02:30:00.000Z"),
      new Date("2026-08-21T02:30:01.000Z"),
    ];
    const supervisor = createSupervisor({
      spawnChild,
      readTerminalStatus: async () => terminalRecord(),
      now: () => times.shift(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      heartbeatMs: 30_000,
      timeoutMs: 4 * 60 * 60 * 1_000,
      environment: {},
      terminalStatusFile: TERMINAL_FILE,
    });
    const status = await supervisor.start(envelope());
    assert.equal(status.state, "unknown");
    assert.equal(status.failureCode, "child_start_failed");
    assert.equal(timers.callbacks.size, 0);
  }
});

test("preserves child start failure when its completion clock is invalid", async () => {
  const timers = idleTimers();
  const times = [new Date("2026-08-21T02:30:00.000Z"), new Date(Number.NaN)];
  const supervisor = createSupervisor({
    spawnChild() {
      throw new Error("spawn failed with credential=secret");
    },
    readTerminalStatus: async () => terminalRecord(),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  const terminal = await supervisor.start(envelope());
  assert.equal(terminal.state, "unknown");
  assert.equal(terminal.failureCode, "child_start_failed");
  assert.equal(terminal.completedAt, "2026-08-21T02:30:00.000Z");
  assert.equal(terminal.exitCode, null);
  assert.equal(Object.isFrozen(terminal), true);
  assert.deepEqual(await supervisor.waitForTerminal(), terminal);
  assert.equal(timers.callbacks.size, 0);
});

function terminalHarness(readTerminalStatus) {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T02:31:00.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus,
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  return { child, supervisor, timers };
}

async function exitAndWait(harness, code) {
  await harness.supervisor.start(envelope());
  harness.child.emit("exit", code, null);
  return harness.supervisor.waitForTerminal();
}

function fakeTerminalFile(content, { readError = null } = {}) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const calls = { open: 0, read: 0, close: 0 };
  return {
    calls,
    async openTerminalFile(file, flags) {
      calls.open += 1;
      assert.equal(file, TERMINAL_FILE);
      assert.equal(flags, "r");
      return {
        async read(buffer, offset, length, position) {
          calls.read += 1;
          if (readError) throw readError;
          const bytesRead = Math.min(
            length,
            Math.max(0, bytes.length - position),
          );
          bytes.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead, buffer };
        },
        async close() {
          calls.close += 1;
        },
      };
    },
  };
}

function boundedReaderHarness(openTerminalFile) {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date("2026-08-21T02:31:00.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    openTerminalFile,
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  return { child, supervisor, timers };
}

test("the bounded terminal reader rejects an empty file and closes it", async () => {
  const file = fakeTerminalFile(Buffer.alloc(0));
  const status = await exitAndWait(
    boundedReaderHarness(file.openTerminalFile),
    0,
  );
  assert.equal(status.state, "unknown");
  assert.equal(status.failureCode, "terminal_status_missing");
  assert.deepEqual(file.calls, { open: 1, read: 1, close: 1 });
});

test("the bounded terminal reader rejects malformed JSON and closes it", async () => {
  const file = fakeTerminalFile("{");
  const status = await exitAndWait(
    boundedReaderHarness(file.openTerminalFile),
    0,
  );
  assert.equal(status.state, "unknown");
  assert.equal(status.failureCode, "terminal_status_missing");
  assert.equal(file.calls.open, 1);
  assert.equal(file.calls.close, 1);
});

test("the bounded terminal reader contains read errors and closes the file", async () => {
  const file = fakeTerminalFile("ignored", {
    readError: new Error("read failed BLOB_READ_WRITE_TOKEN=secret"),
  });
  const status = await exitAndWait(
    boundedReaderHarness(file.openTerminalFile),
    0,
  );
  assert.equal(status.state, "unknown");
  assert.equal(status.failureCode, "terminal_status_missing");
  assert.deepEqual(file.calls, { open: 1, read: 1, close: 1 });
  assert.equal(JSON.stringify(status).includes("BLOB_READ_WRITE_TOKEN"), false);
});

test("the bounded terminal reader accepts valid JSON at exactly 32 KiB", async () => {
  const serialized = Buffer.from(JSON.stringify(terminalRecord()), "utf8");
  const exact = Buffer.concat([
    serialized,
    Buffer.alloc(32 * 1024 - serialized.byteLength, 0x20),
  ]);
  const file = fakeTerminalFile(exact);
  const status = await exitAndWait(
    boundedReaderHarness(file.openTerminalFile),
    0,
  );
  assert.equal(status.state, "succeeded");
  assert.equal(status.failureCode, null);
  assert.equal(file.calls.open, 1);
  assert.equal(file.calls.close, 1);
});

test("the bounded terminal reader rejects a file over 32 KiB", async () => {
  const file = fakeTerminalFile(Buffer.alloc(32 * 1024 + 1, 0x20));
  const status = await exitAndWait(
    boundedReaderHarness(file.openTerminalFile),
    0,
  );
  assert.equal(status.state, "unknown");
  assert.equal(status.failureCode, "terminal_status_missing");
  assert.deepEqual(file.calls, { open: 1, read: 1, close: 1 });
});

test("accepts the exact successful terminal record and snapshots its correlation", async () => {
  let readArguments;
  const record = terminalRecord();
  const harness = terminalHarness(async (...args) => {
    readArguments = args;
    return record;
  });
  const status = await exitAndWait(harness, 0);
  assert.deepEqual(readArguments, [TERMINAL_FILE, 32 * 1024]);
  assert.equal(status.state, "succeeded");
  assert.equal(status.failureCode, null);
  assert.equal(status.runId, record.runId);
  assert.equal(status.neonRunId, record.neonRunId);
  assert.equal(status.evidencePrefix, record.evidencePrefix);
  assert.equal(status.manifestKey, record.manifestKey);
  assert.equal(status.manifestPresent, true);
  record.runId = "00000000-0000-4000-8000-000000000099";
  record.manifestKey = "malicious/manifest.json";
  assert.equal(harness.supervisor.status().runId, terminalRecord().runId);
  assert.notEqual(harness.supervisor.status().manifestKey, record.manifestKey);
});

test("classifies missing, malformed, and exit-disagreeing terminal IPC as unknown", async () => {
  const cases = [
    async () => {
      const error = new Error("ENOENT token=secret");
      error.code = "ENOENT";
      throw error;
    },
    async () => "{malformed-json",
    async () => terminalRecord({ exitCode: 40 }),
  ];
  for (const readTerminalStatus of cases) {
    const harness = terminalHarness(readTerminalStatus);
    const status = await exitAndWait(harness, 0);
    assert.equal(status.state, "unknown");
    assert.equal(status.failureCode, "terminal_status_missing");
    assert.equal(status.exitCode, 0);
    assert.equal(JSON.stringify(status).includes("secret"), false);
  }
});

test("rejects incomplete or unsafe R2 evidence and never accepts nominal success without a manifest", async () => {
  const invalidRecords = [
    terminalRecord({ manifestKey: null, manifestPresent: false }),
    terminalRecord({ manifestKey: "other-prefix/manifest.json" }),
    terminalRecord({
      evidencePrefix: "../escape",
      manifestKey: "../escape/manifest.json",
    }),
    terminalRecord({
      evidencePrefix: "/absolute",
      manifestKey: "/absolute/manifest.json",
    }),
  ];
  for (const record of invalidRecords) {
    const harness = terminalHarness(async () => record);
    const status = await exitAndWait(harness, 0);
    assert.equal(status.state, "unknown");
    assert.equal(status.failureCode, "terminal_status_missing");
    assert.equal(status.manifestPresent, false);
  }
});

test("rejects mismatched identity and non-exact terminal records without invoking accessors", async () => {
  let accessorCalls = 0;
  const accessor = terminalRecord();
  Object.defineProperty(accessor, "status", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "succeeded";
    },
  });
  const hidden = terminalRecord();
  Object.defineProperty(hidden, "hidden", { enumerable: false, value: true });
  const inherited = Object.assign(
    Object.create({ inherited: true }),
    terminalRecord(),
  );
  const symbol = terminalRecord();
  symbol[Symbol("extra")] = true;
  const records = [
    terminalRecord({ attemptId: "scheduled:production:2026-08-22" }),
    { ...terminalRecord(), extra: true },
    accessor,
    hidden,
    inherited,
    symbol,
  ];
  for (const record of records) {
    const harness = terminalHarness(async () => record);
    const status = await exitAndWait(harness, 0);
    assert.equal(status.state, "unknown");
    assert.equal(status.failureCode, "terminal_status_missing");
  }
  assert.equal(accessorCalls, 0);
});

test("rejects non-primitive terminal statuses without coercion", async () => {
  let coercions = 0;
  let accessorCalls = 0;
  const arrayStatus = ["succeeded"];
  Object.defineProperty(arrayStatus, "toString", {
    value() {
      coercions += 1;
      return "succeeded";
    },
  });
  const coercibleStatus = {
    [Symbol.toPrimitive]() {
      coercions += 1;
      return "succeeded";
    },
  };
  const accessorStatus = {};
  Object.defineProperty(accessorStatus, Symbol.toPrimitive, {
    get() {
      accessorCalls += 1;
      return () => "succeeded";
    },
  });
  for (const statusValue of [
    { nested: "succeeded" },
    arrayStatus,
    coercibleStatus,
    accessorStatus,
  ]) {
    const harness = terminalHarness(async () =>
      terminalRecord({ status: statusValue }),
    );
    const status = await exitAndWait(harness, 0);
    assert.equal(status.state, "unknown");
    assert.equal(status.failureCode, "terminal_status_missing");
  }
  assert.equal(coercions, 0);
  assert.equal(accessorCalls, 0);
});

test("maps valid unknown and other non-success records without losing bounded failure codes", async () => {
  const unknownRecord = terminalRecord({
    status: "unknown",
    exitCode: 40,
    failureCode: "publication_outcome_unknown",
    manifestKey: null,
    manifestPresent: false,
  });
  const unknownHarness = terminalHarness(async () => unknownRecord);
  const unknown = await exitAndWait(unknownHarness, 40);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.failureCode, "publication_outcome_unknown");
  const degradedRecord = terminalRecord({
    status: "degraded",
    exitCode: 2,
    failureCode: "source_degraded",
  });
  const degradedHarness = terminalHarness(async () => degradedRecord);
  const degraded = await exitAndWait(degradedHarness, 2);
  assert.equal(degraded.state, "failed");
  assert.equal(degraded.failureCode, "source_degraded");
});

test("accepts a bounded failure with no evidence while keeping the public projection exact", async () => {
  const failureRecord = terminalRecord({
    runId: null,
    neonRunId: null,
    status: "failed",
    exitCode: 40,
    failureCode: "database_unavailable",
    evidencePrefix: null,
    manifestKey: null,
    manifestPresent: false,
  });
  const harness = terminalHarness(async () => failureRecord);
  const status = await exitAndWait(harness, 40);
  assert.equal(status.state, "failed");
  assert.equal(status.failureCode, "database_unavailable");
  assert.deepEqual(Object.keys(status), [
    "attemptId",
    "state",
    "startedAt",
    "heartbeatAt",
    "completedAt",
    "exitCode",
    "failureCode",
    "runId",
    "neonRunId",
    "evidencePrefix",
    "manifestKey",
    "manifestPresent",
  ]);
});

const CONTROL_TOKEN = "control-token_0123456789-ABCDEFGHIJKLMN";

function statusFixture(overrides = {}) {
  return {
    attemptId: null,
    state: "pending",
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    exitCode: null,
    failureCode: null,
    runId: null,
    neonRunId: null,
    evidencePrefix: null,
    manifestKey: null,
    manifestPresent: false,
    ...overrides,
  };
}

function fakeSupervisor(overrides = {}) {
  const signals = [];
  const supervisor = {
    async start() {
      return statusFixture({ state: "running" });
    },
    status() {
      return statusFixture();
    },
    forwardSignal(signal) {
      signals.push(signal);
      return true;
    },
    ...overrides,
  };
  return { signals, supervisor };
}

async function serve(supervisor, token = CONTROL_TOKEN) {
  const server = createSupervisorServer({
    supervisor,
    token,
    port: 0,
    host: "127.0.0.1",
  });
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

test("validates the URL-safe control token before listening", () => {
  const { supervisor } = fakeSupervisor();
  for (const token of [
    "short",
    "x".repeat(31),
    "x".repeat(161),
    `${"x".repeat(31)}!`,
    null,
  ]) {
    assert.throws(
      () =>
        createSupervisorServer({
          supervisor,
          token,
          port: 0,
          host: "127.0.0.1",
        }),
      { code: "invalid_supervisor_token" },
    );
  }
});

test("serves bounded health and allowlisted status while routing everything else to 404", async (t) => {
  const unsafe = statusFixture();
  unsafe.databaseUrl = "postgresql://user:password@example.invalid/db";
  unsafe.token = CONTROL_TOKEN;
  const { supervisor } = fakeSupervisor({ status: () => unsafe });
  const { server, origin } = await serve(supervisor);
  t.after(() => closeServer(server));
  const health = await responseJson(await fetch(`${origin}/health`));
  assert.deepEqual(health, { status: 200, body: { status: "ok" } });
  assert.ok(JSON.stringify(health.body).length < 128);
  const status = await responseJson(await fetch(`${origin}/status`));
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, statusFixture());
  assert.equal(JSON.stringify(status.body).includes("password"), false);
  assert.equal(JSON.stringify(status.body).includes(CONTROL_TOKEN), false);
  for (const [path, method] of [
    ["/missing", "GET"],
    ["/run", "GET"],
    ["/status", "POST"],
    ["/health", "POST"],
  ]) {
    const response = await responseJson(
      await fetch(`${origin}${path}`, { method }),
    );
    assert.deepEqual(response, { status: 404, body: { error: "not_found" } });
  }
});

test("authenticates POST /run, bounds JSON, and returns only fixed client errors", async (t) => {
  const starts = [];
  const { supervisor } = fakeSupervisor({
    async start(input) {
      starts.push(input);
      return statusFixture({
        attemptId: envelope().attemptId,
        state: "running",
      });
    },
  });
  const { server, origin } = await serve(supervisor);
  t.after(() => closeServer(server));
  const url = `${origin}/run`;
  for (const authorization of [
    undefined,
    `Bearer ${"z".repeat(CONTROL_TOKEN.length)}`,
    `bearer ${CONTROL_TOKEN}`,
    `Bearer  ${CONTROL_TOKEN}`,
  ]) {
    const headers = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;
    const response = await responseJson(
      await fetch(url, { method: "POST", headers, body: "{}" }),
    );
    assert.deepEqual(response, {
      status: 401,
      body: { error: "unauthorized" },
    });
  }
  const wrongMedia = await responseJson(
    await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${CONTROL_TOKEN}` },
      body: "{}",
    }),
  );
  assert.deepEqual(wrongMedia, {
    status: 415,
    body: { error: "unsupported_media_type" },
  });
  const malformed = await responseJson(
    await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CONTROL_TOKEN}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: "{",
    }),
  );
  assert.deepEqual(malformed, { status: 400, body: { error: "invalid_json" } });
  const oversized = await responseJson(
    await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CONTROL_TOKEN}`,
        "content-type": "application/json",
      },
      body: `{"padding":"${"x".repeat(32 * 1024)}"}`,
    }),
  );
  assert.deepEqual(oversized, {
    status: 413,
    body: { error: "body_too_large" },
  });
  const accepted = await responseJson(
    await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${CONTROL_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope()),
    }),
  );
  assert.equal(accepted.status, 202);
  assert.deepEqual(
    accepted.body,
    statusFixture({ attemptId: envelope().attemptId, state: "running" }),
  );
  assert.deepEqual(starts, [envelope()]);
});

test("maps run validation, conflict, and internal failures to fixed machine codes", async (t) => {
  const errors = [
    ["invalid_run_envelope", 400],
    ["run_conflict", 409],
    ["postgresql://user:password@example.invalid/db", 500],
  ];
  for (const [code, expectedStatus] of errors) {
    const { supervisor } = fakeSupervisor({
      async start() {
        const error = new Error(`unsafe ${code}`);
        error.code = code;
        throw error;
      },
    });
    const { server, origin } = await serve(supervisor);
    t.after(() => closeServer(server));
    const response = await responseJson(
      await fetch(`${origin}/run`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${CONTROL_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(envelope()),
      }),
    );
    const expectedError =
      code === "invalid_run_envelope"
        ? "invalid_run_envelope"
        : code === "run_conflict"
          ? "run_conflict"
          : "supervisor_unavailable";
    assert.deepEqual(response, {
      status: expectedStatus,
      body: { error: expectedError },
    });
    assert.equal(JSON.stringify(response.body).includes("password"), false);
  }
});

test("handles an aborted request without starting or leaking an exception", async (t) => {
  let starts = 0;
  const { supervisor } = fakeSupervisor({
    async start() {
      starts += 1;
      return statusFixture();
    },
  });
  const { server } = await serve(supervisor);
  t.after(() => closeServer(server));
  const address = server.address();
  const aborted = request({
    host: "127.0.0.1",
    port: address.port,
    path: "/run",
    method: "POST",
    headers: {
      authorization: `Bearer ${CONTROL_TOKEN}`,
      "content-type": "application/json",
      "transfer-encoding": "chunked",
    },
  });
  aborted.on("error", () => {});
  aborted.write('{"partial":');
  aborted.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 0);
});

test("installs removable signal handlers that close the server and forward once per path", async () => {
  const beforeTerm = process.listeners("SIGTERM");
  const beforeInt = process.listeners("SIGINT");
  const { signals, supervisor } = fakeSupervisor();
  const { server } = await serve(supervisor);
  const term = process
    .listeners("SIGTERM")
    .find((listener) => !beforeTerm.includes(listener));
  const interrupt = process
    .listeners("SIGINT")
    .find((listener) => !beforeInt.includes(listener));
  assert.equal(typeof term, "function");
  assert.equal(typeof interrupt, "function");
  const closed = once(server, "close");
  term();
  term();
  interrupt();
  interrupt();
  await closed;
  assert.deepEqual(signals, ["SIGTERM", "SIGINT"]);
  assert.deepEqual(process.listeners("SIGTERM"), beforeTerm);
  assert.deepEqual(process.listeners("SIGINT"), beforeInt);
});

test("latches a host signal before listening and closes after listen completes", async (t) => {
  const beforeTerm = process.listeners("SIGTERM");
  const beforeInt = process.listeners("SIGINT");
  const { signals, supervisor } = fakeSupervisor();
  const server = createSupervisorServer({
    supervisor,
    token: CONTROL_TOKEN,
    port: 0,
    host: "127.0.0.1",
  });
  t.after(async () => {
    for (const listener of process.listeners("SIGTERM"))
      if (!beforeTerm.includes(listener))
        process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT"))
      if (!beforeInt.includes(listener))
        process.removeListener("SIGINT", listener);
    await closeServer(server);
  });
  assert.equal(server.listening, false);
  const listening = once(server, "listening");
  const closed = once(server, "close");
  const term = process
    .listeners("SIGTERM")
    .find((listener) => !beforeTerm.includes(listener));
  assert.equal(typeof term, "function");
  term();
  await listening;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(server.listening, false);
  await closed;
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.deepEqual(process.listeners("SIGTERM"), beforeTerm);
  assert.deepEqual(process.listeners("SIGINT"), beforeInt);
});

test("direct execution starts exactly one private production supervisor without synchronous exit", () => {
  const source = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  assert.match(source, /pathToFileURL\(process\.argv\[1\]\)/);
  assert.match(source, /token:\s*process\.env\.MLS_SUPERVISOR_TOKEN/);
  assert.match(source, /port:\s*8080/);
  assert.match(source, /host:\s*["']0\.0\.0\.0["']/);
  assert.doesNotMatch(source, /process\.exit\s*\(/);
});

test("Dockerfile is pinned, amd64, non-root, health-checked, and narrowly copied", () => {
  const dockerfile = readFileSync(
    new URL("../Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(
    dockerfile,
    /^FROM --platform=linux\/amd64 node:22\.23\.2-bookworm-slim$/m,
  );
  assert.match(dockerfile, /^ENV NODE_ENV=production$/m);
  assert.match(dockerfile, /^WORKDIR \/app$/m);
  assert.match(dockerfile, /^COPY package\.json package-lock\.json \.\/$/m);
  assert.match(
    dockerfile,
    /^RUN npm ci --omit=dev --ignore-scripts=true && npm cache clean --force$/m,
  );
  assert.match(dockerfile, /^COPY scripts \.\/scripts$/m);
  assert.match(dockerfile, /^COPY src \.\/src$/m);
  assert.match(
    dockerfile,
    /^COPY workers\/mls-container\/container \.\/workers\/mls-container\/container$/m,
  );
  assert.doesNotMatch(dockerfile, /^COPY \. /m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.match(
    dockerfile,
    /HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3[\s\S]*fetch\('http:\/\/127\.0\.0\.1:8080\/health'\)/,
  );
  assert.match(
    dockerfile,
    /^ENTRYPOINT \["node", "workers\/mls-container\/container\/server\.mjs"\]$/m,
  );
  assert.doesNotMatch(
    dockerfile,
    /DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|MLS_R2_SECRET_ACCESS_KEY|^ARG\s/m,
  );
});

test("Dockerfile-specific ignore excludes secrets, tooling, evidence, docs, ops, and the other Worker", () => {
  const dockerignore = readFileSync(
    new URL("../Dockerfile.dockerignore", import.meta.url),
    "utf8",
  );
  for (const token of [
    ".git",
    ".env*",
    "!.env.example",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".output",
    ".vercel",
    "coverage",
    ".wrangler",
    "docs",
    "ops",
    ".superpowers",
    "artifacts",
    "workers/cron",
  ]) {
    assert.match(
      dockerignore,
      new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      token,
    );
  }
  assert.ok(
    dockerignore.indexOf("!.env.example") > dockerignore.indexOf(".env*"),
  );
  assert.doesNotMatch(dockerignore, /workers\/mls-container\/container/);
});

test("queues a host signal that arrives while asynchronous spawn is still pending", async () => {
  const child = new FakeChild();
  let releaseSpawn;
  const pendingSpawn = new Promise((resolve) => {
    releaseSpawn = resolve;
  });
  const timers = idleTimers();
  const supervisor = createSupervisor({
    spawnChild: () => pendingSpawn,
    readTerminalStatus: async () => terminalRecord(),
    now: () => new Date("2026-08-21T02:30:00.000Z"),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  const starting = supervisor.start(envelope());
  supervisor.forwardSignal("SIGTERM");
  supervisor.forwardSignal("SIGTERM");
  releaseSpawn(child);
  await starting;
  assert.deepEqual(child.kills, ["SIGTERM"]);
});

test("rejects non-string envelope scalars and invalid timestamps without coercion", async () => {
  let coercions = 0;
  const coercible = {
    [Symbol.toPrimitive]() {
      coercions += 1;
      return "production";
    },
  };
  for (const invalid of [
    envelope({ environment: coercible }),
    envelope({ kind: new String("scheduled") }),
    envelope({ mode: new String("shadow") }),
    envelope({ scheduledTime: "2026-99-99T99:99:99.999Z" }),
  ]) {
    const timers = idleTimers();
    const supervisor = createSupervisor({
      spawnChild: () => new FakeChild(),
      readTerminalStatus: async () => terminalRecord(),
      now: () => new Date("2026-08-21T02:30:00.000Z"),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      heartbeatMs: 30_000,
      timeoutMs: 4 * 60 * 60 * 1_000,
      environment: {},
      terminalStatusFile: TERMINAL_FILE,
    });
    await assert.rejects(() => supervisor.start(invalid), {
      code: "invalid_run_envelope",
    });
  }
  assert.equal(coercions, 0);
});

test("rejects a terminal Neon ID that is not the run ID", async () => {
  const harness = terminalHarness(async () =>
    terminalRecord({ neonRunId: "00000000-0000-4000-8000-000000000002" }),
  );
  const status = await exitAndWait(harness, 0);
  assert.equal(status.state, "unknown");
  assert.equal(status.failureCode, "terminal_status_missing");
});

test("rejects credential-bearing or nested status fields before JSON serialization", async (t) => {
  const unsafe = statusFixture({
    state: {
      toJSON() {
        return `BLOB_READ_WRITE_TOKEN=${CONTROL_TOKEN}`;
      },
    },
    failureCode: `postgresql://user:${CONTROL_TOKEN}@example.invalid/db`,
  });
  const { supervisor } = fakeSupervisor({ status: () => unsafe });
  const { server, origin } = await serve(supervisor);
  t.after(() => closeServer(server));
  const response = await fetch(`${origin}/status`);
  const body = await response.text();
  assert.equal(response.status, 500);
  assert.equal(body, JSON.stringify({ error: "supervisor_unavailable" }));
  assert.equal(body.includes(CONTROL_TOKEN), false);
});

test("removes signal handlers when listen fails", async (t) => {
  const occupied = createNodeServer();
  occupied.listen({ host: "127.0.0.1", port: 0 });
  await once(occupied, "listening");
  const address = occupied.address();
  assert.ok(address && typeof address === "object");
  const beforeTerm = process.listeners("SIGTERM");
  const beforeInt = process.listeners("SIGINT");
  const { supervisor } = fakeSupervisor();
  const failing = createSupervisorServer({
    supervisor,
    token: CONTROL_TOKEN,
    port: address.port,
    host: "127.0.0.1",
  });
  t.after(async () => {
    for (const listener of process.listeners("SIGTERM"))
      if (!beforeTerm.includes(listener))
        process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT"))
      if (!beforeInt.includes(listener))
        process.removeListener("SIGINT", listener);
    await closeServer(occupied);
  });
  const [error] = await once(failing, "error");
  assert.equal(error.code, "EADDRINUSE");
  assert.deepEqual(process.listeners("SIGTERM"), beforeTerm);
  assert.deepEqual(process.listeners("SIGINT"), beforeInt);
});

test("contains an invalid heartbeat clock, signals the child, and waits for immutable exit", async () => {
  const child = new FakeChild();
  const timers = idleTimers();
  const times = [
    new Date("2026-08-21T02:30:00.000Z"),
    new Date(Number.NaN),
    new Date("2026-08-21T02:31:00.000Z"),
  ];
  const supervisor = createSupervisor({
    spawnChild: () => child,
    readTerminalStatus: async () =>
      terminalRecord({
        status: "failed",
        exitCode: 40,
        failureCode: "mls_run_failed",
      }),
    now: () => times.shift(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    heartbeatMs: 30_000,
    timeoutMs: 4 * 60 * 60 * 1_000,
    environment: {},
    terminalStatusFile: TERMINAL_FILE,
  });
  await supervisor.start(envelope());
  assert.doesNotThrow(() => timers.runDelay(30_000));
  assert.deepEqual(child.kills, ["SIGTERM"]);
  child.emit("exit", 40, null);
  const status = await supervisor.waitForTerminal();
  assert.equal(status.state, "unknown");
  assert.equal(status.failureCode, "supervisor_clock_failed");
  assert.equal(timers.callbacks.size, 0);
});
test("pins both Wrangler container configs to the repository-root build context", () => {
  for (const name of ["wrangler.jsonc", "wrangler.scheduled.jsonc"]) {
    const config = JSON.parse(
      readFileSync(new URL("../" + name, import.meta.url), "utf8"),
    );
    assert.equal(config.containers[0].image, "./Dockerfile");
    assert.equal(config.containers[0].image_build_context, "../..");
  }
});
