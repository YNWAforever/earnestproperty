import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest } from "./contracts.mjs";
import { fixtures } from "./fixtures.mjs";
test("synthetic fixtures build bounded requests without labels", () => {
  assert.ok(fixtures.length >= 8);
  for (const f of fixtures) {
    const r = buildRequest(f, "jev-latest");
    assert.equal("expected" in r.state, false);
    assert.equal("id" in r.state, false);
    assert.equal(r.questions.unsupported.type, "noul");
    assert.ok(Buffer.byteLength(JSON.stringify(r.state)) <= 24000);
    for (const e of f.evidence)
      assert.ok(r.questions[`relevance_${e.id}`].instructions.includes(e.id));
  }
});
for (const [name, change] of Object.entries({
  unknown: (f) => ({ ...f, staffEmail: "private" }),
  nested: (f) => ({ ...f, facts: { ...f.facts, secret: "private" } }),
  negative: (f) => ({ ...f, facts: { ...f.facts, price: -1 } }),
  missing: (f) => ({ ...f, id: "" }),
  duplicate: (f) => ({ ...f, evidence: [f.evidence[0], f.evidence[0]] }),
  oversized: (f) => ({ ...f, evidence: [{ id: "e1", text: "x".repeat(2001) }] }),
  unicode: (f) => ({ ...f, draft: { description: "樓".repeat(9000) } }),
  tooMany: (f) => ({
    ...f,
    evidence: Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, text: "a" })),
  }),
}))
  test(`reject ${name}`, () =>
    assert.throws(() => buildRequest(change(fixtures[0]), "jev-latest")));
