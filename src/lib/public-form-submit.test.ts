import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { ServerFnResponseError } from "@/lib/neon/server-fn-response";

import { publicFormErrorMessage, submitPublicForm } from "./public-form-submit";

const RATE_LIMITED_COPY = "提交次數太多，請一分鐘後再試，或直接 WhatsApp 我們。";
const VALIDATION_COPY = "資料格式有誤，請檢查你填寫的資料後再試。";
const NETWORK_COPY = "網絡連線出現問題，請檢查網絡後再試，或直接 WhatsApp 我們。";
const SERVER_COPY = "未能提交，請再試一次，或直接 WhatsApp 我們。";
const LOG_TAG = "PUBLIC_FORM_SUBMIT_FAILED";

// Every failure branch logs via console.error. Silence it for the whole file so test output
// stays pristine; the logging describe block below asserts on this spy.
let errorSpy: ReturnType<typeof spyOn<Console, "error">>;
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

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

describe("submitPublicForm: failure diagnostics (never swallow the cause)", () => {
  test("resolved 429 Response logs the tag with code and status exactly once", async () => {
    await submitPublicForm(async () => new Response("Too Many Requests", { status: 429 }));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      LOG_TAG,
      expect.objectContaining({ code: "RATE_LIMITED", status: 429, cause: "Response" }),
    );
  });

  test("thrown TypeError logs the tag with code, name and the thrown value exactly once", async () => {
    const thrown = new TypeError("Failed to fetch");
    await submitPublicForm(async () => {
      throw thrown;
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      LOG_TAG,
      expect.objectContaining({ code: "NETWORK", name: "TypeError", cause: thrown }),
    );
  });

  test("thrown error carrying an HTTP status logs that status", async () => {
    await submitPublicForm(async () => {
      throw new ServerFnResponseError("Too Many Requests", 429);
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      LOG_TAG,
      expect.objectContaining({ code: "RATE_LIMITED", status: 429 }),
    );
  });

  test("id-less resolved value logs a short description, never the value itself", async () => {
    await submitPublicForm(async () => ({ error: "boom", phone: "91234567" }));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [tag, detail] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(tag).toBe(LOG_TAG);
    expect(detail.code).toBe("SERVER");
    expect(detail.cause).toBe("object without a string id");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("91234567");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("boom");
  });

  test("resolved null / undefined log a short typeof description", async () => {
    await submitPublicForm(async () => null);
    await submitPublicForm(async () => undefined);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cause: "null" }));
    expect(errorSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ cause: "undefined" }));
  });

  test("the visitor-facing message is unchanged by logging", async () => {
    const outcome = await submitPublicForm(async () => {
      throw new Error("relation does not exist");
    });
    expect(outcome).toEqual({ status: "error", code: "SERVER", message: SERVER_COPY });
  });

  test("a confirmed save does not log", async () => {
    const outcome = await submitPublicForm(async () => ({ id: "abc" }));
    expect(outcome).toEqual({ status: "success", id: "abc" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
