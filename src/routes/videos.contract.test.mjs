import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/routes/videos.tsx", "utf8");

// listings.tsx established this pattern. fallback() is what makes a stale link
// from WhatsApp render the unfiltered page instead of erroring.
test("search params are Zod-validated with fallbacks", () => {
  assert.match(source, /zodValidator\(searchSchema\)/);
  assert.match(source, /from "@tanstack\/zod-adapter"/);
  assert.match(source, /fallback\(/);
});

// The sort vocabulary is English and decoupled from the Chinese labels, so
// rewording 最新 never invalidates a shared link.
test("sort accepts exactly the three documented values", () => {
  assert.match(source, /z\.enum\(\["newest", "oldest", "featured"\]\)/);
});

test("estate and q are optional free text", () => {
  assert.match(source, /estate:\s*fallback\(/);
  assert.match(source, /q:\s*fallback\(/);
});
