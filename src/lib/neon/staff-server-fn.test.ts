import { afterEach, expect, mock, test } from "bun:test";
import { ServerFnResponseError } from "./server-fn-response";

mock.module("@/auth", () => ({
  withStaffAuthHeaders: async (o: Record<string, unknown> = {}) => ({
    ...o,
    headers: new Headers({ authorization: "Bearer fx10a" }),
  }),
}));

const { callStaffServerFn } = await import("./staff-server-fn");

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

test("409 Response → throws with message", async () => {
  const error = await rejection(
    callStaffServerFn(
      async () => new Response("ENDPOINT_PERMISSION_OR_VERSION_CONFLICT", { status: 409 }),
      { data: {} },
    ),
  );
  expect(error).toBeInstanceOf(ServerFnResponseError);
  expect((error as ServerFnResponseError).status).toBe(409);
  expect((error as ServerFnResponseError).message).toBe("ENDPOINT_PERMISSION_OR_VERSION_CONFLICT");
});

test("401 and 403 Responses throw with their status", async () => {
  const unauthorized = await rejection(
    callStaffServerFn(async () => new Response("", { status: 401 }), { data: {} }),
  );
  expect(unauthorized).toBeInstanceOf(ServerFnResponseError);
  expect((unauthorized as ServerFnResponseError).status).toBe(401);
  expect((unauthorized as ServerFnResponseError).message).toBe("HTTP 401");

  const forbidden = await rejection(
    callStaffServerFn(async () => new Response("Forbidden", { status: 403 }), { data: {} }),
  );
  expect(forbidden).toBeInstanceOf(ServerFnResponseError);
  expect((forbidden as ServerFnResponseError).status).toBe(403);
  expect((forbidden as ServerFnResponseError).message).toBe("Forbidden");
});

test("genuine results pass through unchanged, including { ok: false }, null and []", async () => {
  const notOk = { ok: false, error: "COPILOT_FORBIDDEN" };
  expect(await callStaffServerFn(async () => notOk, { data: {} })).toBe(notOk);
  expect(await callStaffServerFn(async () => null, { data: {} })).toBeNull();
  const empty: string[] = [];
  expect(await callStaffServerFn(async () => empty, { data: {} })).toBe(empty);
  expect(await callStaffServerFn(() => 0, { data: {} })).toBe(0);
});

test("the server function receives the caller's data plus the staff bearer header", async () => {
  const seen: { data?: unknown; headers: Headers }[] = [];
  const data = { q: "EP-1", nested: { ids: [1, 2] } };
  await callStaffServerFn(
    async (options: { data: typeof data; headers: Headers }) => {
      seen.push(options);
      return { ok: true };
    },
    { data },
  );
  expect(seen).toHaveLength(1);
  expect(seen[0].data).toEqual(data);
  expect(seen[0].headers.get("authorization")).toBe("Bearer fx10a");
});

test("a stale workspace aborts before the server function runs", async () => {
  let calls = 0;
  const error = await rejection(
    callStaffServerFn(
      async () => {
        calls++;
        return { ok: true };
      },
      { data: {} },
      () => false,
    ),
  );
  expect((error as Error).message).toBe("WORKSPACE_REQUEST_CANCELLED");
  expect(calls).toBe(0);
});

test("never reloads the page", async () => {
  let reloads = 0;
  globalThis.window = {
    location: {
      reload: () => {
        reloads++;
      },
    },
  } as unknown as Window & typeof globalThis;
  const notFound = await rejection(
    callStaffServerFn(async () => new Response("Not found", { status: 404 }), { data: {} }),
  );
  expect((notFound as ServerFnResponseError).status).toBe(404);
  const httpError = await rejection(
    callStaffServerFn(
      async () => {
        throw new TypeError("HTTPError");
      },
      { data: {} },
    ),
  );
  expect(httpError).toBeInstanceOf(TypeError);
  expect(reloads).toBe(0);
});

test("a thrown or rejected Response is normalised like a returned one", async () => {
  const thrown = await rejection(
    callStaffServerFn(
      async () => {
        throw new Response("Forbidden", { status: 403 });
      },
      { data: {} },
    ),
  );
  expect(thrown).toBeInstanceOf(ServerFnResponseError);
  expect((thrown as ServerFnResponseError).status).toBe(403);
  expect((thrown as ServerFnResponseError).message).toBe("Forbidden");

  const rejected = await rejection(
    callStaffServerFn(() => Promise.reject(new Response("", { status: 409 })), { data: {} }),
  );
  expect(rejected).toBeInstanceOf(ServerFnResponseError);
  expect((rejected as ServerFnResponseError).status).toBe(409);
  expect((rejected as ServerFnResponseError).message).toBe("HTTP 409");
});
