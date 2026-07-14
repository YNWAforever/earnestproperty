import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission } from "./permissions.ts";
import { errorResponse, mapControlPlaneError, successResponse } from "./errors.ts";
import { createOperationContext } from "./request-context.ts";
import { sanitizeAuditMetadata } from "./audit.server.ts";

test("permission matrix defaults to deny", () => {
  assert.equal(hasPermission(["agent"], "system.health.read"), true);
  assert.equal(hasPermission(["agent"], "system.jobs.retry"), false);
  assert.equal(hasPermission(["unknown"], "system.health.read"), false);
});

test("structured postgres codes map to stable public errors", () => {
  assert.deepEqual(mapControlPlaneError({ code: "42P01" }), {
    code: "SCHEMA_RELATION_MISSING",
    message: "A required database relation is missing.",
    retryable: false,
  });
  assert.equal(mapControlPlaneError(new Error("password=secret")).code, "INTERNAL_ERROR");
});

test("responses use stable success and error envelopes", async () => {
  const success = await successResponse({ value: 1 }, "request-1").json();
  assert.deepEqual(success, { ok: true, data: { value: 1 }, requestId: "request-1" });

  const error = await errorResponse({ code: "23505" }, "request-2", 409).json();
  assert.deepEqual(error, {
    ok: false,
    error: {
      code: "CONFLICT_DUPLICATE",
      message: "The operation conflicts with existing data.",
      retryable: false,
    },
    requestId: "request-2",
  });
});

test("operation contexts include a UUID request id and ISO timestamp", () => {
  const context = createOperationContext();
  assert.match(context.requestId, /^[0-9a-f-]{36}$/);
  assert.doesNotThrow(() => new Date(context.startedAt).toISOString());
});

test("audit metadata recursively removes sensitive values", () => {
  assert.deepEqual(
    sanitizeAuditMetadata({
      token: "secret",
      phone: "91234567",
      nested: { title: "ok", password: "x" },
    }),
    { token: "[REDACTED]", phone: "[REDACTED]", nested: { title: "ok", password: "[REDACTED]" } },
  );
});

test("audit metadata applies bounded strings, arrays, and nesting", () => {
  const metadata = sanitizeAuditMetadata({
    description: "x".repeat(600),
    items: Array.from({ length: 55 }, (_, index) => index),
    nested: { a: { b: { c: { d: { e: "hidden" } } } } },
    accessToken: "hidden",
  });

  assert.equal(metadata.description.length, 500);
  assert.equal(metadata.items.length, 50);
  assert.equal(metadata.nested.a.b.c.d, "[TRUNCATED]");
  assert.equal(metadata.accessToken, "[REDACTED]");
});
