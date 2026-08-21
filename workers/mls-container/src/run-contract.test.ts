import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildRunEnvelope,
  hongKongDate,
  scheduledAttemptId,
  transitionRunState,
} from "./run-contract";

describe("Cloudflare MLS run identity", () => {
  test("derives the Hong Kong date across the UTC boundary", () => {
    expect(hongKongDate("2026-08-20T17:59:59.999Z")).toBe("2026-08-21");
    expect(hongKongDate("2026-08-20T18:00:00.000Z")).toBe("2026-08-21");
    expect(hongKongDate("2026-08-21T16:00:00.000Z")).toBe("2026-08-22");
  });

  test("uses one deterministic scheduled identity per environment and HK date", () => {
    expect(scheduledAttemptId("production", "2026-08-21")).toBe(
      "scheduled:production:2026-08-21",
    );
  });

  test("requires an explicit reason and suffix for a manual attempt", () => {
    expect(() =>
      buildRunEnvelope({
        environment: "production",
        scheduledTime: "2026-08-20T18:00:00.000Z",
        kind: "manual",
        mode: "shadow",
        manualReason: "",
        manualSuffix: "retry-0001",
        commitSha: "a".repeat(40),
      }),
    ).toThrow(/manual reason/i);
  });

  test("keeps terminal states immutable", () => {
    expect(transitionRunState("pending", "running")).toBe("running");
    expect(transitionRunState("running", "unknown")).toBe("unknown");
    expect(() => transitionRunState("failed", "running")).toThrow(/terminal/i);
  });
});

function config(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../${name}`, import.meta.url).toString()),
      "utf8",
    ),
  );
}

test("base deploy is private, unscheduled, and single-container", () => {
  const value = config("wrangler.jsonc") as any;
  expect(value.workers_dev).toBe(false);
  expect(value.routes).toBeUndefined();
  expect(value.containers).toEqual([
    {
      class_name: "MlsRunContainer",
      image: "./Dockerfile",
      max_instances: 1,
      instance_type: "standard-1",
    },
  ]);
  expect(value.migrations[0].new_sqlite_classes).toEqual(["MlsRunContainer"]);
  expect(value.workflows[0].schedules).toBeUndefined();
});

test("scheduled config differs only by the approved daily Workflow schedule", () => {
  const base = config("wrangler.jsonc") as any;
  const scheduled = config("wrangler.scheduled.jsonc") as any;
  expect(scheduled.workflows[0].schedules).toEqual(["0 18 * * *"]);
  delete scheduled.workflows[0].schedules;
  expect(scheduled).toEqual(base);
  expect(JSON.stringify(base)).not.toMatch(
    /DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|MLS_R2_SECRET_ACCESS_KEY/,
  );
});
