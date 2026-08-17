import assert from "node:assert/strict";
import { test } from "bun:test";

import type { StaffAccess } from "@/lib/neon/auth.server";

import { createYouTubeSyncHttpHandlers } from "./youtube-http.server";

const actor: StaffAccess = {
  staffId: "11111111-1111-4111-8111-111111111111",
  authUserId: "auth-test",
  email: "manager@example.test",
  name: "Manager",
  roles: ["manager"],
  bootstrap: false,
};

function handlers(overrides: Parameters<typeof createYouTubeSyncHttpHandlers>[0] = {}) {
  return createYouTubeSyncHttpHandlers({
    cronSecret: () => "cron-test-secret",
    requireStaffPermission: async () => actor,
    writeAudit: async () => {},
    createContext: () => ({
      requestId: "22222222-2222-4222-8222-222222222222",
      startedAt: "2026-08-17T00:00:00.000Z",
    }),
    runSync: async ({ mode, trigger }) => ({
      status: "completed",
      summary: {
        mode,
        trigger,
        pages: 1,
        fetched: 2,
        inserted: 1,
        adopted: 1,
        updated: 0,
        restored: 0,
        unavailable: 0,
        elapsedMs: 20,
        period: mode === "full" ? "2026-08-01" : null,
      },
    }),
    ...overrides,
  });
}

test("cron rejects missing or invalid bearer authorization", async () => {
  let calls = 0;
  const subject = handlers({
    runSync: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });
  for (const authorization of [undefined, "Bearer wrong-secret"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await subject.cron(
      new Request("https://example.test/api/youtube-sync", { headers }),
      "incremental",
    );
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test("cron contention returns a successful skip for duplicate delivery", async () => {
  const subject = handlers({
    runSync: async () => ({ status: "skipped", reason: "sync_in_progress" }),
  });
  const response = await subject.cron(
    new Request("https://example.test/api/youtube-sync", {
      headers: { authorization: "Bearer cron-test-secret" },
    }),
    "incremental",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "skipped",
    reason: "sync_in_progress",
  });
});

test("staff POST validates mode and audits a successful aggregate-only result", async () => {
  const audits: Array<Record<string, unknown>> = [];
  let permission = "";
  const subject = handlers({
    requireStaffPermission: async (_request: Request, requested: string) => {
      permission = requested;
      return actor;
    },
    writeAudit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  });
  const response = await subject.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "full" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(permission, "cms.publish");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "youtube.sync.manual");
  assert.equal(audits[0].outcome, "success");
  assert.doesNotMatch(JSON.stringify(audits), /description|apiKey|authorization/i);
});

test("staff contention is 409 and malformed bodies are 400", async () => {
  const contention = handlers({
    runSync: async () => ({ status: "skipped", reason: "sync_in_progress" }),
  });
  const conflict = await contention.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "incremental" }),
    }),
  );
  assert.equal(conflict.status, 409);

  const invalid = await handlers().staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "rss", apiKey: "must-not-echo" }),
    }),
  );
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(await invalid.text(), /must-not-echo/);
});

test("provider failures map to safe non-2xx responses", async () => {
  const { YouTubeSyncError } = await import("./youtube-sync.types");
  const subject = handlers({
    runSync: async () => {
      throw new YouTubeSyncError("youtube_quota_exhausted", "safe", false);
    },
  });
  const response = await subject.cron(
    new Request("https://example.test/api/youtube-sync", {
      headers: { authorization: "Bearer cron-test-secret" },
    }),
    "full",
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /youtube_quota_exhausted/);
});

test("validation audit rejection returns a generic safe internal response", async () => {
  let runs = 0;
  const audits: Array<Record<string, unknown>> = [];
  const subject = handlers({
    runSync: async () => {
      runs += 1;
      throw new Error("must not run");
    },
    writeAudit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
      throw Object.assign(new Error("validation-audit-raw-internal"), {
        description: "validation-audit-description",
        providerUrl: "https://validation-audit.example.test/private",
        stack: "validation-audit-stack",
      });
    },
  });

  const response = await subject.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "rss" }),
    }),
  );
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.match(body, /internal_error/);
  assert.equal(runs, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, "failure");
  assert.doesNotMatch(
    body,
    /validation-audit-raw-internal|validation-audit-description|validation-audit\.example\.test|validation-audit-stack/i,
  );
});

test("success audit rejection runs once without recording a false sync failure", async () => {
  let runs = 0;
  const audits: Array<Record<string, unknown>> = [];
  const subject = handlers({
    runSync: async ({ mode, trigger }) => {
      runs += 1;
      return {
        status: "completed",
        summary: {
          mode,
          trigger,
          pages: 3,
          fetched: 5,
          inserted: 2,
          adopted: 1,
          updated: 1,
          restored: 1,
          unavailable: 0,
          elapsedMs: 40,
          period: null,
        },
      };
    },
    writeAudit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
      throw Object.assign(new Error("success-audit-raw-internal"), {
        description: "success-audit-description",
        providerUrl: "https://success-audit.example.test/private",
        stack: "success-audit-stack",
      });
    },
  });

  const response = await subject.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "incremental" }),
    }),
  );
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.match(body, /internal_error/);
  assert.equal(runs, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, "success");
  assert.doesNotMatch(
    body,
    /success-audit-raw-internal|success-audit-description|success-audit\.example\.test|success-audit-stack/i,
  );
});

test("sync and failure-audit rejection preserve the original safe sync error", async () => {
  const { YouTubeSyncError } = await import("./youtube-sync.types");
  let runs = 0;
  const audits: Array<Record<string, unknown>> = [];
  const subject = handlers({
    runSync: async () => {
      runs += 1;
      throw new YouTubeSyncError(
        "youtube_quota_exhausted",
        "sync-raw-internal https://sync-provider.example.test/private",
        false,
      );
    },
    writeAudit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
      throw Object.assign(new Error("failure-audit-raw-internal"), {
        description: "failure-audit-description",
        providerUrl: "https://failure-audit.example.test/private",
        stack: "failure-audit-stack",
      });
    },
  });

  const response = await subject.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "full" }),
    }),
  );
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.match(body, /youtube_quota_exhausted/);
  assert.equal(runs, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, "failure");
  assert.deepEqual(audits[0].metadata, {
    mode: "full",
    code: "youtube_quota_exhausted",
  });
  assert.doesNotMatch(
    body,
    /sync-raw-internal|sync-provider\.example\.test|failure-audit-raw-internal|failure-audit-description|failure-audit\.example\.test|failure-audit-stack/i,
  );
});

test("unknown sync failures serialize only fixed response and audit fields", async () => {
  const audits: Array<Record<string, unknown>> = [];
  const subject = handlers({
    runSync: async () => {
      throw Object.assign(new Error("unknown-sync-raw-internal"), {
        description: "unknown-sync-description",
        providerUrl: "https://unknown-sync.example.test/private",
        stack: "unknown-sync-stack",
      });
    },
    writeAudit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  });

  const response = await subject.staff(
    new Request("https://example.test/api/youtube-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "incremental" }),
    }),
  );
  const serialized = `${await response.text()} ${JSON.stringify(audits)}`;

  assert.equal(response.status, 500);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].metadata, {
    mode: "incremental",
    code: "internal_error",
  });
  assert.doesNotMatch(
    serialized,
    /unknown-sync-raw-internal|unknown-sync-description|unknown-sync\.example\.test|unknown-sync-stack|providerUrl|description|stack/i,
  );
});
