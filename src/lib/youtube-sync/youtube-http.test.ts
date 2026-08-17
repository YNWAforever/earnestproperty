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
