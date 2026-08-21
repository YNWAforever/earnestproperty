import { describe, expect, mock, test } from "bun:test";

class FakeContainer {
  protected ctx: unknown;
  protected env: unknown;

  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}

mock.module("@cloudflare/containers", () => ({ Container: FakeContainer }));

import type { AttemptRecord, SupervisorStatus } from "./container";
import { buildRunEnvelope } from "./run-contract";

const { MlsRunContainer, createAttemptCoordinator } =
  await import("./container");

const DATABASE_URL =
  "postgresql://operator:database-secret@example.invalid/mls";
const BLOB_TOKEN = "vercel_blob_rw_secret";
const R2_SECRET = "r2_secret_access_key";
const CONTROL_TOKEN = "control-token-00000000000000000001";

function scheduledEnvelope() {
  return buildRunEnvelope({
    environment: "production",
    scheduledTime: "2026-08-20T18:00:00.000Z",
    kind: "scheduled",
    mode: "shadow",
    commitSha: "a".repeat(40),
  });
}

const RUN_ID = "00000000-0000-4000-8000-000000000001";

function pendingRecord(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    envelope: scheduledEnvelope(),
    state: "pending",
    workflowInstanceId: "workflow-1",
    containerDeploymentId: "deployment-1",
    containerId: "scheduled:production:2026-08-21",
    neonRunId: null,
    evidencePrefix: null,
    manifestPresent: false,
    startedAt: null,
    heartbeatAt: null,
    completedAt: null,
    exitCode: null,
    failureCode: null,
    ...overrides,
  };
}

function succeededStatus(
  overrides: Partial<SupervisorStatus> = {},
): SupervisorStatus {
  const attemptId = scheduledEnvelope().attemptId;
  const evidencePrefix = `mls-sync/production/2026-08-21/${RUN_ID}/${attemptId}`;
  return {
    attemptId,
    state: "succeeded",
    startedAt: "2026-08-20T18:00:01.000Z",
    heartbeatAt: "2026-08-20T18:01:00.000Z",
    completedAt: "2026-08-20T18:02:00.000Z",
    exitCode: 0,
    failureCode: null,
    runId: RUN_ID,
    neonRunId: RUN_ID,
    evidencePrefix,
    manifestKey: `${evidencePrefix}/manifest.json`,
    manifestPresent: true,
    ...overrides,
  };
}

interface HarnessOverrides {
  get?: (key: string) => Promise<unknown>;
  put?: (key: string, value: AttemptRecord) => Promise<void>;
  start?: (input: unknown) => Promise<void>;
  status?: () => Promise<SupervisorStatus>;
  stop?: () => Promise<void>;
  now?: () => string;
}

function coordinatorHarness(overrides: HarnessOverrides = {}) {
  return createAttemptCoordinator({
    store: {
      get: overrides.get ?? (async () => undefined),
      put: overrides.put ?? (async () => {}),
    },
    container: {
      start: overrides.start ?? (async () => {}),
      status: overrides.status ?? (async () => succeededStatus()),
      stop: overrides.stop ?? (async () => {}),
    },
    containerId: "scheduled:production:2026-08-21",
    containerDeploymentId: "deployment-1",
    startEnvironment: () => ({}),
    createToken: () => CONTROL_TOKEN,
    now: overrides.now ?? (() => "2026-08-20T18:00:02.000Z"),
  });
}

const WRAPPER_ENVIRONMENT = {
  DATABASE_URL_UNPOOLED: DATABASE_URL,
  BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
  MLS_CRAWLER_CONTACT_URL: "https://earnestproperty.com/contact",
  MLS_MEDIA_ALLOWED_HOSTS: "images.example.invalid",
  MLS_PUBLISH_ENABLED: "true",
  MLS_MEDIA_RIGHTS_CONFIRMED: "true",
  CLOUDFLARE_ACCOUNT_ID: "account-1",
  MLS_EVIDENCE_BUCKET: "earnest-mls-evidence",
  MLS_R2_ACCESS_KEY_ID: "r2-access-key",
  MLS_R2_SECRET_ACCESS_KEY: R2_SECRET,
  CLOUDFLARE_DEPLOYMENT_ID: "deployment-1",
};

interface WrapperHarnessOptions {
  running?: boolean;
  environment?: Record<string, string>;
  status?: SupervisorStatus;
  initial?: AttemptRecord;
}

function wrapperHarness(options: WrapperHarnessOptions = {}) {
  const values = new Map<string, unknown>();
  if (options.initial) {
    values.set(
      `attempt:${options.initial.envelope.attemptId}`,
      structuredClone(options.initial),
    );
  }
  const events: string[] = [];
  const starts: unknown[] = [];
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const runtime = { running: options.running ?? true };
  const ctx = {
    id: { toString: () => "container-do-1" },
    container: runtime,
    storage: {
      async get(key: string) {
        return values.get(key);
      },
      async put(key: string, value: unknown) {
        events.push(`put:${(value as AttemptRecord).state}`);
        values.set(key, structuredClone(value));
      },
    },
  };
  const environment = options.environment ?? { ...WRAPPER_ENVIRONMENT };
  const instance = new MlsRunContainer(ctx as never, environment as never);
  Object.defineProperty(instance, "startAndWaitForPorts", {
    configurable: true,
    value: async (input: unknown) => {
      events.push("start");
      starts.push(structuredClone(input));
    },
  });
  Object.defineProperty(instance, "containerFetch", {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      events.push(`fetch:${new URL(url).pathname}`);
      fetches.push({ url, init: structuredClone(init) });
      if (new URL(url).pathname === "/run")
        return new Response(null, { status: 202 });
      return Response.json(options.status ?? succeededStatus());
    },
  });
  Object.defineProperty(instance, "stop", {
    configurable: true,
    value: async () => {
      events.push("stop");
    },
  });
  return { instance, values, events, starts, fetches, runtime };
}

describe("attempt coordinator claims", () => {
  test("persists before one start and returns the same duplicate claim", async () => {
    const values = new Map<string, unknown>();
    const events: string[] = [];
    const starts: unknown[] = [];
    const coordinator = createAttemptCoordinator({
      store: {
        async get(key: string) {
          events.push(`get:${key}`);
          return values.get(key);
        },
        async put(key: string, value: unknown) {
          events.push(`put:${key}`);
          values.set(key, structuredClone(value));
        },
      },
      container: {
        async start(input: unknown) {
          events.push("start");
          starts.push(structuredClone(input));
        },
        async status() {
          throw new Error("status is not part of the claim slice");
        },
        async stop() {
          events.push("stop");
        },
      },
      containerId: "scheduled:production:2026-08-21",
      containerDeploymentId: "deployment-1",
      startEnvironment: () => ({
        DATABASE_URL_UNPOOLED: DATABASE_URL,
        BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
        MLS_R2_SECRET_ACCESS_KEY: R2_SECRET,
      }),
      createToken: () => CONTROL_TOKEN,
      now: () => "2026-08-20T18:00:01.000Z",
    });
    const input = {
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    };

    const first = await coordinator.claimAndStart(input);
    const duplicate = await coordinator.claimAndStart(input);

    expect(duplicate).toEqual(first);
    expect(starts).toHaveLength(1);
    expect(events.slice(0, 3)).toEqual([
      "get:attempt:scheduled:production:2026-08-21",
      "put:attempt:scheduled:production:2026-08-21",
      "start",
    ]);
    expect(first).toMatchObject({
      envelope: input.envelope,
      state: "pending",
      workflowInstanceId: "workflow-1",
      containerDeploymentId: "deployment-1",
      containerId: "scheduled:production:2026-08-21",
      neonRunId: null,
      evidencePrefix: null,
      manifestPresent: false,
      startedAt: null,
      heartbeatAt: null,
      completedAt: null,
      exitCode: null,
      failureCode: null,
    });
  });

  test("never persists start credentials or the control token", async () => {
    const writes: unknown[] = [];
    const coordinator = createAttemptCoordinator({
      store: {
        async get() {
          return undefined;
        },
        async put(_key: string, value: unknown) {
          writes.push(structuredClone(value));
        },
      },
      container: {
        async start() {},
        async status() {
          throw new Error("status is not part of the claim slice");
        },
        async stop() {},
      },
      containerId: "scheduled:production:2026-08-21",
      containerDeploymentId: "deployment-1",
      startEnvironment: () => ({
        DATABASE_URL_UNPOOLED: DATABASE_URL,
        BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
        MLS_R2_SECRET_ACCESS_KEY: R2_SECRET,
      }),
      createToken: () => CONTROL_TOKEN,
      now: () => "2026-08-20T18:00:01.000Z",
    });

    await coordinator.claimAndStart({
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    });

    const persisted = JSON.stringify(writes);
    for (const secret of [DATABASE_URL, BLOB_TOKEN, R2_SECRET, CONTROL_TOKEN]) {
      expect(persisted).not.toContain(secret);
    }
  });
});

describe("attempt coordinator adversarial claims", () => {
  test("rejects envelope and workflow conflicts without another start", async () => {
    const values = new Map<string, unknown>();
    let starts = 0;
    const coordinator = coordinatorHarness({
      get: async (key) => values.get(key),
      put: async (key, value) => {
        values.set(key, structuredClone(value));
      },
      start: async () => {
        starts += 1;
      },
    });
    const envelope = scheduledEnvelope();
    await coordinator.claimAndStart({
      envelope,
      workflowInstanceId: "workflow-1",
    });
    await expect(
      coordinator.claimAndStart({
        envelope: { ...envelope, mode: "publish" },
        workflowInstanceId: "workflow-1",
      }),
    ).rejects.toThrow("attempt claim does not match existing record");
    await expect(
      coordinator.claimAndStart({
        envelope,
        workflowInstanceId: "workflow-2",
      }),
    ).rejects.toThrow("attempt claim does not match existing record");
    expect(starts).toBe(1);
  });

  for (const startCase of [
    {
      name: "definite supervisor rejection",
      error: new Error("container supervisor rejected the attempt"),
      state: "failed" as const,
      code: "container_start_failed",
    },
    {
      name: "ambiguous start response",
      error: new Error(`transport reset ${DATABASE_URL}`),
      state: "unknown" as const,
      code: "container_start_outcome_unknown",
    },
  ]) {
    test(`classifies a ${startCase.name} before stopping`, async () => {
      const events: string[] = [];
      const writes: AttemptRecord[] = [];
      const coordinator = coordinatorHarness({
        put: async (_key, value) => {
          writes.push(structuredClone(value));
          events.push(`put:${value.state}`);
        },
        start: async () => {
          events.push("start");
          throw startCase.error;
        },
        stop: async () => {
          events.push("stop");
        },
      });
      const record = await coordinator.claimAndStart({
        envelope: scheduledEnvelope(),
        workflowInstanceId: "workflow-1",
      });
      expect(record).toMatchObject({
        state: startCase.state,
        completedAt: "2026-08-20T18:00:02.000Z",
        failureCode: startCase.code,
      });
      expect(writes.map(({ state }) => state)).toEqual([
        "pending",
        startCase.state,
      ]);
      expect(events).toEqual([
        "put:pending",
        "start",
        `put:${startCase.state}`,
        "stop",
      ]);
      expect(JSON.stringify(writes)).not.toContain(DATABASE_URL);
    });
  }

  test("keeps an existing terminal attempt immutable", async () => {
    const terminal = pendingRecord({
      state: "failed",
      completedAt: "2026-08-20T18:02:00.000Z",
      exitCode: 30,
      failureCode: "configuration_failed",
    });
    const events: string[] = [];
    const coordinator = coordinatorHarness({
      get: async () => structuredClone(terminal),
      put: async () => {
        events.push("put");
      },
      start: async () => {
        events.push("start");
      },
      status: async () => {
        events.push("status");
        return succeededStatus();
      },
      stop: async () => {
        events.push("stop");
      },
    });
    expect(
      await coordinator.claimAndStart({
        envelope: scheduledEnvelope(),
        workflowInstanceId: "workflow-1",
      }),
    ).toEqual(terminal);
    expect(await coordinator.readAttempt(terminal.envelope.attemptId)).toEqual(
      terminal,
    );
    expect(events).toEqual([]);
  });

  test("captures caller input before the first await", async () => {
    let releaseGet: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const starts: unknown[] = [];
    const coordinator = coordinatorHarness({
      get: async () => {
        await gate;
        return undefined;
      },
      start: async (input) => {
        starts.push(structuredClone(input));
      },
    });
    const envelope = { ...scheduledEnvelope() };
    const pending = coordinator.claimAndStart({
      envelope,
      workflowInstanceId: "workflow-1",
    });
    envelope.mode = "publish";
    releaseGet?.();
    const record = await pending;
    expect(record.envelope.mode).toBe("shadow");
    expect(starts[0]).toMatchObject({ envelope: { mode: "shadow" } });
  });

  test("rejects accessor-backed envelope fields without invoking them", async () => {
    let accesses = 0;
    const envelope = { ...scheduledEnvelope() };
    Object.defineProperty(envelope, "attemptId", {
      enumerable: true,
      get() {
        accesses += 1;
        return "scheduled:production:2026-08-21";
      },
    });
    await expect(
      Promise.resolve().then(() =>
        coordinatorHarness().claimAndStart({
          envelope,
          workflowInstanceId: "workflow-1",
        }),
      ),
    ).rejects.toThrow("run envelope is invalid");
    expect(accesses).toBe(0);
  });
});

describe("attempt coordinator status", () => {
  test("rejects extra, accessor-backed, and malformed supervisor fields", async () => {
    let accessorCalls = 0;
    const accessorStatus = Object.defineProperty(
      { ...succeededStatus() },
      "failureCode",
      {
        enumerable: true,
        get() {
          accessorCalls += 1;
          return null;
        },
      },
    );
    const cases = [
      { ...succeededStatus(), diagnostic: "not allowlisted" },
      accessorStatus,
      { ...succeededStatus(), completedAt: "not-a-timestamp" },
    ];
    for (const status of cases) {
      const events: string[] = [];
      const coordinator = coordinatorHarness({
        get: async () => pendingRecord(),
        put: async () => {
          events.push("put");
        },
        status: async () => status as SupervisorStatus,
        stop: async () => {
          events.push("stop");
        },
      });
      await expect(
        coordinator.readAttempt(scheduledEnvelope().attemptId),
      ).rejects.toThrow("supervisor status is invalid");
      expect(events).toEqual([]);
    }
    expect(accessorCalls).toBe(0);
  });

  test("rejects mismatched attempt and Neon run identities", async () => {
    for (const status of [
      succeededStatus({ attemptId: "scheduled:preview:2026-08-21" }),
      succeededStatus({ neonRunId: "00000000-0000-4000-8000-000000000002" }),
    ]) {
      const coordinator = coordinatorHarness({
        get: async () => pendingRecord(),
        status: async () => status,
        put: async () => {
          throw new Error("invalid status persisted");
        },
        stop: async () => {
          throw new Error("invalid status stopped runtime");
        },
      });
      await expect(
        coordinator.readAttempt(scheduledEnvelope().attemptId),
      ).rejects.toThrow("supervisor status is invalid");
    }
  });

  test("persists allowlisted terminal evidence before stopping", async () => {
    const events: string[] = [];
    const writes: AttemptRecord[] = [];
    const status = succeededStatus();
    const coordinator = coordinatorHarness({
      get: async () => pendingRecord(),
      put: async (_key, value) => {
        writes.push(structuredClone(value));
        events.push(`put:${value.state}`);
      },
      status: async () => {
        events.push("status");
        return status;
      },
      stop: async () => {
        events.push("stop");
      },
    });
    const record = await coordinator.readAttempt(scheduledEnvelope().attemptId);
    status.failureCode = "late-caller-mutation";
    expect(record).toMatchObject({
      state: "succeeded",
      neonRunId: RUN_ID,
      evidencePrefix: succeededStatus().evidencePrefix,
      manifestPresent: true,
      startedAt: "2026-08-20T18:00:01.000Z",
      heartbeatAt: "2026-08-20T18:01:00.000Z",
      completedAt: "2026-08-20T18:02:00.000Z",
      exitCode: 0,
      failureCode: null,
    });
    expect(record).not.toHaveProperty("runId");
    expect(record).not.toHaveProperty("manifestKey");
    expect(writes).toEqual([record]);
    expect(events).toEqual(["status", "put:succeeded", "stop"]);
  });

  test("markUnknown persists before stop and cannot rewrite a terminal record", async () => {
    const events: string[] = [];
    let stored: AttemptRecord = pendingRecord({ state: "running" });
    const coordinator = coordinatorHarness({
      get: async () => structuredClone(stored),
      put: async (_key, value) => {
        stored = structuredClone(value);
        events.push(`put:${value.state}`);
      },
      stop: async () => {
        events.push("stop");
      },
    });
    const first = await coordinator.markUnknown(
      scheduledEnvelope().attemptId,
      "workflow_poll_deadline",
    );
    const replay = await coordinator.markUnknown(
      scheduledEnvelope().attemptId,
      "different_code",
    );
    expect(first).toMatchObject({
      state: "unknown",
      completedAt: "2026-08-20T18:00:02.000Z",
      failureCode: "workflow_poll_deadline",
    });
    expect(replay).toEqual(first);
    expect(events).toEqual(["put:unknown", "stop"]);
  });
});

describe("Cloudflare Container wrapper", () => {
  test("starts port 8080 with an allowlisted publish environment and one discarded token", async () => {
    const environment = {
      ...WRAPPER_ENVIRONMENT,
      UNRELATED_SECRET: "must-not-enter-container",
    };
    const harness = wrapperHarness({ environment });
    const envelope = { ...scheduledEnvelope(), mode: "publish" as const };
    const record = await harness.instance.claimAndStart({
      envelope,
      workflowInstanceId: "workflow-1",
    });

    expect(harness.instance.defaultPort).toBe(8080);
    expect(harness.instance.requiredPorts).toEqual([8080]);
    expect(harness.instance.sleepAfter).toBe("5h");
    expect(harness.starts).toHaveLength(1);
    const start = harness.starts[0] as {
      ports: number[];
      startOptions: {
        envVars: Record<string, string>;
        enableInternet: boolean;
      };
      cancellationOptions: { portReadyTimeoutMS: number };
    };
    expect(start).toMatchObject({
      ports: [8080],
      startOptions: { enableInternet: true },
      cancellationOptions: { portReadyTimeoutMS: 60_000 },
    });
    expect(start.startOptions.envVars).toMatchObject({
      DATABASE_URL_UNPOOLED: DATABASE_URL,
      BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
      MLS_CRAWLER_CONTACT_URL: "https://earnestproperty.com/contact",
      MLS_MEDIA_ALLOWED_HOSTS: "images.example.invalid",
      MLS_PUBLISH_ENABLED: "true",
      MLS_MEDIA_RIGHTS_CONFIRMED: "true",
      MLS_EVIDENCE_BACKEND: "r2",
      MLS_ENVIRONMENT: "production",
      MLS_SCHEDULED_FOR: "2026-08-21",
      MLS_ATTEMPT_ID: envelope.attemptId,
      MLS_COMMIT_SHA: "a".repeat(40),
      CLOUDFLARE_DEPLOYMENT_ID: "deployment-1",
      MLS_WORKFLOW_INSTANCE_ID: "workflow-1",
      MLS_CONTAINER_ID: "container-do-1",
      MLS_TERMINAL_STATUS_FILE: "/tmp/earnest-mls-terminal.json",
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      MLS_EVIDENCE_BUCKET: "earnest-mls-evidence",
      MLS_R2_ACCESS_KEY_ID: "r2-access-key",
      MLS_R2_SECRET_ACCESS_KEY: R2_SECRET,
    });
    expect(start.startOptions.envVars.MLS_ATTEMPT_STARTED_AT).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$/,
    );
    expect(start.startOptions.envVars).not.toHaveProperty("UNRELATED_SECRET");
    const token = start.startOptions.envVars.MLS_SUPERVISOR_TOKEN;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,160}$/);
    expect(harness.fetches).toHaveLength(1);
    expect(harness.fetches[0]?.url).toBe("http://localhost/run");
    expect(harness.fetches[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(harness.fetches[0]?.init?.body))).toEqual(
      envelope,
    );
    expect(record.containerId).toBe("container-do-1");
    const persisted = JSON.stringify([...harness.values.entries()]);
    for (const secret of [DATABASE_URL, BLOB_TOKEN, R2_SECRET, token])
      expect(persisted).not.toContain(secret);
  });

  test("omits the Blob token in shadow mode and never reads unrelated accessors", async () => {
    let unrelatedReads = 0;
    const environment = { ...WRAPPER_ENVIRONMENT };
    Object.defineProperty(environment, "UNRELATED_SECRET", {
      enumerable: true,
      get() {
        unrelatedReads += 1;
        return "must-not-be-read";
      },
    });
    const harness = wrapperHarness({ environment });
    await harness.instance.claimAndStart({
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    });
    const start = harness.starts[0] as {
      startOptions: { envVars: Record<string, string> };
    };
    expect(start.startOptions.envVars).not.toHaveProperty(
      "BLOB_READ_WRITE_TOKEN",
    );
    expect(start.startOptions.envVars).not.toHaveProperty("UNRELATED_SECRET");
    expect(unrelatedReads).toBe(0);
  });

  test("fetches status only while the runtime is running", async () => {
    const stopped = wrapperHarness({
      running: false,
      initial: pendingRecord(),
    });
    await expect(
      stopped.instance.readAttempt(scheduledEnvelope().attemptId),
    ).rejects.toThrow("container is not running");
    expect(stopped.fetches).toEqual([]);

    const running = wrapperHarness({
      running: true,
      initial: pendingRecord(),
      status: succeededStatus(),
    });
    const record = await running.instance.readAttempt(
      scheduledEnvelope().attemptId,
    );
    expect(record.state).toBe("succeeded");
    expect(running.fetches.map(({ url }) => url)).toEqual([
      "http://localhost/status",
    ]);
    expect(running.events.slice(-2)).toEqual(["put:succeeded", "stop"]);
  });

  test("records bounded unknown states from stop and runtime error hooks", async () => {
    const stopped = wrapperHarness();
    await stopped.instance.claimAndStart({
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    });
    stopped.events.length = 0;
    await stopped.instance.onStop({ exitCode: 0, reason: "runtime_signal" });
    const stoppedRecord = stopped.values.get(
      `attempt:${scheduledEnvelope().attemptId}`,
    );
    expect(stoppedRecord).toMatchObject({
      state: "unknown",
      failureCode: "container_stopped",
    });
    expect(stopped.events).toEqual(["put:unknown"]);

    const errored = wrapperHarness();
    await errored.instance.claimAndStart({
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    });
    errored.events.length = 0;
    await errored.instance.onError(
      new Error(`runtime exploded ${DATABASE_URL}`),
    );
    const erroredRecord = errored.values.get(
      `attempt:${scheduledEnvelope().attemptId}`,
    );
    expect(erroredRecord).toMatchObject({
      state: "unknown",
      failureCode: "container_runtime_error",
    });
    expect(JSON.stringify(erroredRecord)).not.toContain(DATABASE_URL);
    expect(errored.events).toEqual(["put:unknown"]);
  });
});

describe("attempt coordinator in-flight terminal races", () => {
  test("returns a lifecycle terminal written while start is in flight", async () => {
    const values = new Map<string, unknown>();
    const key = `attempt:${scheduledEnvelope().attemptId}`;
    const coordinator = coordinatorHarness({
      get: async (requestedKey) => values.get(requestedKey),
      put: async (requestedKey, value) => {
        values.set(requestedKey, structuredClone(value));
      },
      start: async () => {
        const pending = values.get(key) as AttemptRecord;
        values.set(key, {
          ...structuredClone(pending),
          state: "unknown",
          completedAt: "2026-08-20T18:00:03.000Z",
          failureCode: "container_stopped",
        });
      },
    });

    const record = await coordinator.claimAndStart({
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    });

    expect(record).toMatchObject({
      state: "unknown",
      failureCode: "container_stopped",
    });
    expect(values.get(key)).toEqual(record);
  });

  test("does not overwrite a terminal written while status is in flight", async () => {
    const key = `attempt:${scheduledEnvelope().attemptId}`;
    const values = new Map<string, unknown>([
      [key, pendingRecord({ state: "running" })],
    ]);
    const writes: string[] = [];
    const coordinator = coordinatorHarness({
      get: async (requestedKey) => values.get(requestedKey),
      put: async (requestedKey, value) => {
        writes.push(value.state);
        values.set(requestedKey, structuredClone(value));
      },
      status: async () => {
        const running = values.get(key) as AttemptRecord;
        values.set(key, {
          ...structuredClone(running),
          state: "unknown",
          completedAt: "2026-08-20T18:00:03.000Z",
          failureCode: "container_runtime_error",
        });
        return succeededStatus();
      },
    });

    const record = await coordinator.readAttempt(scheduledEnvelope().attemptId);

    expect(record).toMatchObject({
      state: "unknown",
      failureCode: "container_runtime_error",
    });
    expect(values.get(key)).toEqual(record);
    expect(writes).toEqual([]);
  });

  test("shares one in-flight claim across concurrent duplicate RPCs", async () => {
    let releaseGet: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let starts = 0;
    const coordinator = coordinatorHarness({
      get: async () => {
        await gate;
        return undefined;
      },
      start: async () => {
        starts += 1;
      },
    });
    const input = {
      envelope: scheduledEnvelope(),
      workflowInstanceId: "workflow-1",
    };
    const first = coordinator.claimAndStart(input);
    const duplicate = coordinator.claimAndStart(input);
    expect(duplicate).toBe(first);
    releaseGet?.();
    expect(await duplicate).toEqual(await first);
    expect(starts).toBe(1);
  });
});
