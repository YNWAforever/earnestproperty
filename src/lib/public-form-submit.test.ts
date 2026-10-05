import { describe, expect, test } from "bun:test";

import { ServerFnResponseError } from "@/lib/neon/server-fn-response";

import { publicFormErrorMessage, submitPublicForm } from "./public-form-submit";

const RATE_LIMITED_COPY = "提交次數太多，請一分鐘後再試，或直接 WhatsApp 我們。";
const VALIDATION_COPY = "資料格式有誤，請檢查姓名及電話後再試。";
const NETWORK_COPY = "網絡連線出現問題，請檢查網絡後再試，或直接 WhatsApp 我們。";
const SERVER_COPY = "未能提交，請再試一次，或直接 WhatsApp 我們。";

describe("submitPublicForm: resolved Response (TanStack resolves rejected server fns)", () => {
  test("resolved 429 Response -> RATE_LIMITED with exact copy", async () => {
    const outcome = await submitPublicForm(
      async () => new Response("Too Many Requests", { status: 429 }),
    );
    expect(outcome).toEqual({
      status: "error",
      code: "RATE_LIMITED",
      message: RATE_LIMITED_COPY,
    });
  });

  test("resolved 400 Response -> VALIDATION", async () => {
    const outcome = await submitPublicForm(
      async () => new Response("Bad Request", { status: 400 }),
    );
    expect(outcome).toEqual({ status: "error", code: "VALIDATION", message: VALIDATION_COPY });
  });

  test("resolved 422 Response -> VALIDATION", async () => {
    const outcome = await submitPublicForm(
      async () => new Response("Unprocessable", { status: 422 }),
    );
    expect(outcome).toEqual({ status: "error", code: "VALIDATION", message: VALIDATION_COPY });
  });

  test("resolved 500 Response -> SERVER", async () => {
    const outcome = await submitPublicForm(async () => new Response("boom", { status: 500 }));
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("resolved 200 Response -> SERVER (a Response is never a confirmed save)", async () => {
    const outcome = await submitPublicForm(async () => new Response("ok", { status: 200 }));
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });
});

describe("submitPublicForm: resolved values", () => {
  test("resolved { id: 'abc' } -> success with the id", async () => {
    const outcome = await submitPublicForm(async () => ({ id: "abc" }));
    expect(outcome).toEqual({ status: "success", id: "abc" });
  });

  test("resolved {} -> SERVER", async () => {
    const outcome = await submitPublicForm(async () => ({}));
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("resolved { id: '' } -> SERVER", async () => {
    const outcome = await submitPublicForm(async () => ({ id: "" }));
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("resolved { id: 123 } (non-string id) -> SERVER", async () => {
    const outcome = await submitPublicForm(async () => ({ id: 123 }));
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("resolved null / undefined -> SERVER", async () => {
    expect(await submitPublicForm(async () => null)).toEqual({
      status: "error",
      code: "SERVER",
      message: SERVER_COPY,
    });
    expect(await submitPublicForm(async () => undefined)).toEqual({
      status: "error",
      code: "SERVER",
      message: SERVER_COPY,
    });
  });

  test("resolved { error: 'boom' } -> SERVER and the message never carries the returned text", async () => {
    const outcome = await submitPublicForm(async () => ({ error: "boom" }));
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.code).toBe("SERVER");
      expect(outcome.message).not.toContain("boom");
      expect(outcome.message).toBe(SERVER_COPY);
    }
  });
});

describe("submitPublicForm: thrown errors", () => {
  test("thrown TypeError('Failed to fetch') -> NETWORK", async () => {
    const outcome = await submitPublicForm(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(outcome).toEqual({ status: "error", code: "NETWORK", message: NETWORK_COPY });
  });

  test("thrown ServerFnResponseError with status 429 -> RATE_LIMITED", async () => {
    const outcome = await submitPublicForm(async () => {
      throw new ServerFnResponseError("Too Many Requests", 429);
    });
    expect(outcome).toEqual({
      status: "error",
      code: "RATE_LIMITED",
      message: RATE_LIMITED_COPY,
    });
  });

  test("thrown error with status 400 / 422 -> VALIDATION, other status -> SERVER", async () => {
    for (const status of [400, 422]) {
      const outcome = await submitPublicForm(async () => {
        throw new ServerFnResponseError("nope", status);
      });
      expect(outcome).toEqual({ status: "error", code: "VALIDATION", message: VALIDATION_COPY });
    }
    const server = await submitPublicForm(async () => {
      throw new ServerFnResponseError("nope", 503);
    });
    expect(server).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("thrown Error whose message is a serialized zod issue list -> VALIDATION", async () => {
    const outcome = await submitPublicForm(async () => {
      throw new Error(JSON.stringify([{ code: "too_small", path: ["phone"], message: "x" }]));
    });
    expect(outcome).toEqual({ status: "error", code: "VALIDATION", message: VALIDATION_COPY });
  });

  test("thrown error named ZodError -> VALIDATION", async () => {
    const outcome = await submitPublicForm(async () => {
      const err = new Error("whatever");
      err.name = "ZodError";
      throw err;
    });
    expect(outcome).toEqual({ status: "error", code: "VALIDATION", message: VALIDATION_COPY });
  });

  test("thrown Error with a JSON array that is not a zod issue list -> SERVER", async () => {
    const outcome = await submitPublicForm(async () => {
      throw new Error(JSON.stringify([{ foo: "bar" }]));
    });
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("thrown Error('relation does not exist') -> SERVER and the message excludes the raw text", async () => {
    const outcome = await submitPublicForm(async () => {
      throw new Error("relation does not exist");
    });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.code).toBe("SERVER");
      expect(outcome.message).not.toContain("relation");
      expect(outcome.message).toBe(SERVER_COPY);
    }
  });

  test("thrown non-Error values -> SERVER", async () => {
    const outcome = await submitPublicForm(async () => {
      throw "just a string";
    });
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });
});

describe("publicFormErrorMessage", () => {
  test("returns the exact zh-HK copy for all four codes", () => {
    expect(publicFormErrorMessage("RATE_LIMITED")).toBe(RATE_LIMITED_COPY);
    expect(publicFormErrorMessage("VALIDATION")).toBe(VALIDATION_COPY);
    expect(publicFormErrorMessage("NETWORK")).toBe(NETWORK_COPY);
    expect(publicFormErrorMessage("SERVER")).toBe(SERVER_COPY);
  });
});
