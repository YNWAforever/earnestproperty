import { expect, mock, test } from "bun:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { AttemptRecord, Env } from "./container";
import type { WorkflowPayload } from "./workflow";

mock.module("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));
mock.module("@cloudflare/containers", () => ({
  Container: class {},
}));

const { runMlsWorkflow } = await import("./workflow");
const { default: worker } = await import("./index");

const SECRETS = {
  DATABASE_URL_UNPOOLED:
    "postgresql://operator:database-secret@example.invalid/mls",
  BLOB_READ_WRITE_TOKEN: "blob-read-write-secret",
  MLS_R2_ACCESS_KEY_ID: "r2-access-key-secret",
  MLS_R2_SECRET_ACCESS_KEY: "r2-secret-access-secret",
};

function environment(overrides: Record<string, unknown> = {}): Env {
  return {
    MLS_ENVIRONMENT: "production",
    MLS_SCHEDULED_MODE: "shadow",
    MLS_GIT_COMMIT_SHA: "a".repeat(40),
    DATABASE_URL_UNPOOLED: SECRETS.DATABASE_URL_UNPOOLED,
    BLOB_READ_WRITE_TOKEN: SECRETS.BLOB_READ_WRITE_TOKEN,
    MLS_CRAWLER_CONTACT_URL: "https://earnestproperty.com/contact",
    MLS_MEDIA_ALLOWED_HOSTS: "images.example.invalid",
    MLS_PUBLISH_ENABLED: "false",
    MLS_MEDIA_RIGHTS_CONFIRMED: "false",
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    MLS_EVIDENCE_BUCKET: "earnest-mls-evidence",
    MLS_R2_ACCESS_KEY_ID: SECRETS.MLS_R2_ACCESS_KEY_ID,
    MLS_R2_SECRET_ACCESS_KEY: SECRETS.MLS_R2_SECRET_ACCESS_KEY,
    CLOUDFLARE_DEPLOYMENT_ID: "deployment-1",
    ...overrides,
  } as unknown as Env;
}

function asEvent(input: unknown): WorkflowEvent<WorkflowPayload> {
  return input as WorkflowEvent<WorkflowPayload>;
}

function asStep(input: unknown): WorkflowStep {
  return input as WorkflowStep;
}

function asRecord(input: unknown): AttemptRecord {
  return input as AttemptRecord;
}

function scheduledEvent(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "workflow-1",
    workflowName: "earnest-mls-runner",
    timestamp: new Date("2026-08-20T18:00:00.000Z"),
    payload: {},
    schedule: {
      cron: "0 18 * * *",
      scheduledTime: Date.parse("2026-08-20T18:00:00.000Z"),
    },
    ...overrides,
  };
}

function manualEvent(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "workflow-manual-1",
    workflowName: "earnest-mls-runner",
    timestamp: new Date("2026-08-20T18:00:00.000Z"),
    payload: {
      kind: "manual",
      mode: "shadow",
      reason: "operator retry for source evidence",
      suffix: "retry-0001",
      scheduledTime: "2026-08-20T18:00:00.000Z",
    },
    ...overrides,
  };
}

function stepFake() {
  const serialized: string[] = [];
  const sleeps: string[] = [];
  return {
    async do(name: string, configOrCallback: unknown, maybeCallback?: unknown) {
      const callback =
        typeof configOrCallback === "function"
          ? configOrCallback
          : maybeCallback;
      const result = await (callback as () => Promise<unknown>)();
      serialized.push(JSON.stringify(result));
      return result;
    },
    async sleep(name: string) {
      sleeps.push(name);
    },
    serialized,
    sleeps,
  };
}

test("derives one scheduled attempt from Cloudflare scheduledTime", async () => {
  const starts: unknown[] = [];
  const terminal = Object.freeze({
    envelope: { attemptId: "scheduled:production:2026-08-21" },
    state: "succeeded",
  });
  const result = await runMlsWorkflow({
    event: {
      instanceId: "workflow-1",
      workflowName: "earnest-mls-runner",
      timestamp: new Date("2026-08-20T18:00:00.000Z"),
      payload: {},
      schedule: {
        cron: "0 18 * * *",
        scheduledTime: Date.parse("2026-08-20T18:00:00.000Z"),
      },
    },
    step: asStep(stepFake()),
    env: environment(),
    ports: {
      containerFor(attemptId) {
        expect(attemptId).toBe("scheduled:production:2026-08-21");
        return {
          async claimAndStart(input) {
            starts.push(input);
            return asRecord(terminal);
          },
          async readAttempt() {
            throw new Error("terminal claim must not be polled");
          },
          async markUnknown() {
            throw new Error("terminal claim must not be changed");
          },
        };
      },
    },
  });
  expect(result.state).toBe("succeeded");
  expect(starts).toHaveLength(1);
});

test("requires explicit manual reason, suffix, mode, and scheduled time", async () => {
  const requiredFields = ["reason", "suffix", "scheduledTime", "mode"];
  for (const field of requiredFields) {
    const payload = { ...(manualEvent().payload as Record<string, unknown>) };
    delete payload[field];
    await expect(
      runMlsWorkflow({
        event: asEvent(manualEvent({ payload })),
        step: asStep(stepFake()),
        env: environment(),
        ports: {
          containerFor: () => {
            throw new Error("must not claim");
          },
        },
      }),
    ).rejects.toThrow(new RegExp(field, "i"));
  }
});

test("duplicate scheduled workflow delivery claims one child", async () => {
  let claimCount = 0;
  let starts = 0;
  let claimed = false;
  const terminal = {
    envelope: { attemptId: "scheduled:production:2026-08-21" },
    state: "succeeded",
  };
  const port = {
    async claimAndStart() {
      claimCount += 1;
      if (!claimed) {
        claimed = true;
        starts += 1;
      }
      await Promise.resolve();
      return asRecord(terminal);
    },
    async readAttempt() {
      throw new Error("terminal claim must not be polled");
    },
    async markUnknown() {
      throw new Error("terminal claim must not be changed");
    },
  };
  const ports = { containerFor: () => port };
  const [first, second] = await Promise.all([
    runMlsWorkflow({
      event: asEvent(scheduledEvent()),
      step: asStep(stepFake()),
      env: environment(),
      ports,
    }),
    runMlsWorkflow({
      event: asEvent(scheduledEvent({ instanceId: "workflow-2" })),
      step: asStep(stepFake()),
      env: environment(),
      ports,
    }),
  ]);
  expect(first).toEqual(second);
  expect(claimCount).toBe(2);
  expect(starts).toBe(1);
});

test("failed claim result returns without polling", async () => {
  let reads = 0;
  const failed = {
    envelope: { attemptId: "scheduled:production:2026-08-21" },
    state: "failed",
  };
  const result = await runMlsWorkflow({
    event: asEvent(scheduledEvent()),
    step: asStep(stepFake()),
    env: environment(),
    ports: {
      containerFor: () => ({
        async claimAndStart() {
          return asRecord(failed);
        },
        async readAttempt() {
          reads += 1;
          throw new Error("must not poll failed attempt");
        },
        async markUnknown() {
          throw new Error("must not mark failed attempt");
        },
      }),
    },
  });
  expect(result.state).toBe("failed");
  expect(reads).toBe(0);
});

test("unknown claim is terminal and does not resume the same manual suffix", async () => {
  let starts = 0;
  const unknown = {
    envelope: {
      attemptId: "scheduled:production:2026-08-21:manual:retry-0001",
    },
    state: "unknown",
  };
  const result = await runMlsWorkflow({
    event: asEvent(manualEvent()),
    step: asStep(stepFake()),
    env: environment(),
    ports: {
      containerFor: () => ({
        async claimAndStart() {
          starts += 1;
          return asRecord(unknown);
        },
        async readAttempt() {
          throw new Error("unknown claim must not be polled");
        },
        async markUnknown() {
          throw new Error("unknown claim must not be changed");
        },
      }),
    },
  });
  expect(result.state).toBe("unknown");
  expect(starts).toBe(1);
});

test("marks a nonterminal attempt unknown after 240 bounded polls", async () => {
  let reads = 0;
  let marks = 0;
  const running = {
    envelope: { attemptId: "scheduled:production:2026-08-21" },
    state: "running",
  };
  const terminal = { ...running, state: "unknown" };
  const step = stepFake();
  const result = await runMlsWorkflow({
    event: asEvent(scheduledEvent()),
    step: asStep(step),
    env: environment(),
    ports: {
      containerFor: () => ({
        async claimAndStart() {
          return asRecord(running);
        },
        async readAttempt() {
          reads += 1;
          return asRecord(running);
        },
        async markUnknown() {
          marks += 1;
          return asRecord(terminal);
        },
      }),
    },
  });
  expect(result.state).toBe("unknown");
  expect(reads).toBe(240);
  expect(marks).toBe(1);
  expect(step.sleeps).toHaveLength(240);
});

test("status transport error is classified without a second claim", async () => {
  let claims = 0;
  let marks = 0;
  const step = stepFake();
  const result = await runMlsWorkflow({
    event: asEvent(scheduledEvent()),
    step: asStep(step),
    env: environment(),
    ports: {
      containerFor: () => ({
        async claimAndStart() {
          claims += 1;
          return {
            envelope: { attemptId: "scheduled:production:2026-08-21" },
            state: "running",
          } as AttemptRecord;
        },
        async readAttempt() {
          throw new Error("transport failure");
        },
        async markUnknown(_attemptId: string, code: string) {
          expect(code).toBe("workflow_status_unknown");
          marks += 1;
          return {
            envelope: { attemptId: "scheduled:production:2026-08-21" },
            state: "unknown",
          } as AttemptRecord;
        },
      }),
    },
  });
  expect(result.state).toBe("unknown");
  expect(claims).toBe(1);
  expect(marks).toBe(1);
  expect(step.sleeps).toHaveLength(1);
});

test("publish requires both explicit enablement flags", async () => {
  for (const override of [
    { MLS_PUBLISH_ENABLED: "false", MLS_MEDIA_RIGHTS_CONFIRMED: "true" },
    { MLS_PUBLISH_ENABLED: "true", MLS_MEDIA_RIGHTS_CONFIRMED: "false" },
  ]) {
    await expect(
      runMlsWorkflow({
        event: manualEvent({
          payload: { ...manualEvent().payload, mode: "publish" },
        }) as unknown as WorkflowEvent<WorkflowPayload>,
        step: asStep(stepFake()),
        env: environment(override),
        ports: {
          containerFor: () => {
            throw new Error("must not claim");
          },
        },
      }),
    ).rejects.toThrow(/MLS_(PUBLISH_ENABLED|MEDIA_RIGHTS_CONFIRMED)/);
  }
});

test("step outputs and fixed configuration errors never contain secret values", async () => {
  const step = stepFake();
  const result = await runMlsWorkflow({
    event: asEvent(scheduledEvent()),
    step: asStep(step),
    env: environment(),
    ports: {
      containerFor: () => ({
        async claimAndStart() {
          return {
            envelope: { attemptId: "scheduled:production:2026-08-21" },
            state: "succeeded",
          } as AttemptRecord;
        },
        async readAttempt() {
          throw new Error("must not poll");
        },
        async markUnknown() {
          throw new Error("must not mark");
        },
      }),
    },
  });
  expect(result.state).toBe("succeeded");
  const serialized = step.serialized.join("\n");
  for (const value of Object.values(SECRETS))
    expect(serialized).not.toContain(value);
  await expect(
    runMlsWorkflow({
      event: asEvent(scheduledEvent()),
      step: asStep(stepFake()),
      env: environment({ DATABASE_URL_UNPOOLED: "" }),
      ports: {
        containerFor: () => {
          throw new Error("must not claim");
        },
      },
    }),
  ).rejects.toThrow(/DATABASE_URL_UNPOOLED/);
});

test("the Worker has no public run, retry, or status route", async () => {
  const fetcher = worker as unknown as {
    fetch(request: Request): Promise<Response>;
  };
  for (const path of ["/run", "/retry", "/status", "/"]) {
    const response = await fetcher.fetch(
      new Request("https://worker.example.invalid" + path),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});
