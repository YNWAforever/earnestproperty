import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasBearerSecret } from "./bearer-secret.ts";

function requestWith(authorization) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://example.test/api/cron", { headers });
}

test("hasBearerSecret accepts only the exact Bearer value", () => {
  assert.equal(hasBearerSecret(requestWith("Bearer s3cret"), "s3cret"), true);
  for (const header of [
    "Bearer  s3cret",
    "bearer s3cret",
    "Bearer s3cre",
    "Bearer s3cretX",
    "s3cret",
    undefined,
  ]) {
    assert.equal(hasBearerSecret(requestWith(header), "s3cret"), false, `header ${header}`);
  }
});

test("hasBearerSecret refuses an empty or missing secret even when the header matches", () => {
  for (const secret of ["", undefined, null]) {
    for (const header of ["Bearer ", "Bearer", "Bearer undefined", "Bearer null", undefined]) {
      assert.equal(
        hasBearerSecret(requestWith(header), secret),
        false,
        `secret ${String(secret)} header ${header}`,
      );
    }
  }
});

test("hasBearerSecret compares fixed-length digests", () => {
  const source = readFileSync(new URL("./bearer-secret.ts", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual\(/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.doesNotMatch(source, /[!=]==\s*`Bearer/);
  assert.doesNotMatch(source, /`Bearer[^`]*`\s*[!=]==/);
  assert.doesNotMatch(source, /(actual|header|authorization)\s*[!=]==/i);
  // node --test imports this file directly, so it may depend on node:crypto only.
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["node:crypto"]);
});
