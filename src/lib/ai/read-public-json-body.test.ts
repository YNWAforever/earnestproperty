import { expect, test } from "bun:test";
import { readPublicJsonBody } from "./read-public-json-body";

test("public JSON body accepts a normal object", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    body: JSON.stringify({ sessionId: "session", message: "hello" }),
  });
  expect(await readPublicJsonBody(request)).toEqual({ sessionId: "session", message: "hello" });
});

test("public JSON body rejects an oversized streamed request without a length header", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    body: JSON.stringify({ message: "x".repeat(20_000) }),
  });
  request.headers.delete("content-length");
  expect(request.headers.get("content-length")).toBeNull();
  await expect(readPublicJsonBody(request)).rejects.toMatchObject({ status: 413 });
});

test("public JSON body treats malformed JSON and arrays as invalid objects", async () => {
  for (const body of ["{broken", "[1,2,3]"]) {
    const request = new Request("https://example.test/api", { method: "POST", body });
    expect(await readPublicJsonBody(request)).toEqual({});
  }
});
