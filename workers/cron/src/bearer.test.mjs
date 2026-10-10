import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasBearerSecret } from "./bearer.js";

// Node's WebCrypto has no subtle.timingSafeEqual (a Workers extension), so the
// tests inject node:crypto's equivalent over the same digest bytes.
const equal = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));

function requestWith(authorization) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://cron.example.test/wake/service", { method: "POST", headers });
}

test("hasBearerSecret accepts only the exact Bearer value", async () => {
  assert.equal(await hasBearerSecret(requestWith("Bearer s3cret"), "s3cret", equal), true);
  for (const header of [
    "Bearer  s3cret",
    "bearer s3cret",
    "Bearer s3cre",
    "Bearer s3cretX",
    "s3cret",
    undefined,
  ]) {
    assert.equal(
      await hasBearerSecret(requestWith(header), "s3cret", equal),
      false,
      `header ${header}`,
    );
  }
});

test("hasBearerSecret refuses an empty or missing secret even when the header matches", async () => {
  let calls = 0;
  const counting = (a, b) => {
    calls += 1;
    return equal(a, b);
  };
  for (const secret of ["", undefined, null]) {
    for (const header of ["Bearer ", "Bearer", "Bearer undefined", "Bearer null", undefined]) {
      assert.equal(
        await hasBearerSecret(requestWith(header), secret, counting),
        false,
        `secret ${String(secret)} header ${header}`,
      );
    }
  }
  assert.equal(calls, 0, "an unset secret refuses before any comparison");
});

test("hasBearerSecret compares fixed-length digests", async () => {
  const source = readFileSync(new URL("./bearer.js", import.meta.url), "utf8");
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.doesNotMatch(source, /[!=]==\s*`Bearer/);
  assert.doesNotMatch(source, /`Bearer[^`]*`\s*[!=]==/);
  assert.doesNotMatch(source, /^import /m, "no imports: the worker has no nodejs_compat");

  const seen = [];
  await hasBearerSecret(requestWith("Bearer a-much-longer-wrong-value"), "s3cret", (a, b) => {
    seen.push([a.byteLength, b.byteLength]);
    return equal(a, b);
  });
  assert.deepEqual(seen, [[32, 32]], "both sides are SHA-256 digests of equal length");
});

test("the worker default uses crypto.subtle.timingSafeEqual", () => {
  const source = readFileSync(new URL("./bearer.js", import.meta.url), "utf8");
  assert.match(source, /equal = \(a, b\) => crypto\.subtle\.timingSafeEqual\(a, b\)/);
  const worker = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(worker, /from "\.\/bearer\.js"/);
  assert.match(worker, /if \(!\(await hasBearerSecret\(request, env\.CRON_SECRET\)\)\)/);
  assert.doesNotMatch(worker, /!==\s*`Bearer/);
});
