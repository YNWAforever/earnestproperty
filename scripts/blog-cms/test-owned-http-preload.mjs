// Test-process transport only. The shipped artifact and auth/session resolver are unchanged.
// No external fetch can leave this process. Only the dummy Neon URL reaches the owned bridge.
import assert from "node:assert/strict";
const bridge = new URL(process.env.BLOG_ACCEPTANCE_BRIDGE);
assert.equal(bridge.hostname, "127.0.0.1");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  if (
    url.protocol === "https:" &&
    url.pathname === "/sql" &&
    ["api.invalid", "api.owned.invalid", "owned.invalid"].includes(url.hostname)
  ) {
    assert.equal(
      headers.get("Neon-Connection-String"),
      "postgresql://postgres@owned.invalid/postgres",
    );
    return nativeFetch(bridge, init);
  }
  if (url.origin === "http://127.0.0.1:" + process.env.PORT) return nativeFetch(input, init);
  throw new Error("OWNED_RUNTIME_EXTERNAL_FETCH_DENIED");
};
