import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { canonicalLink, pageSeo, seo } from "../content/seo.ts";

// Execute the real head callback without importing the route's server reads,
// React tree or live database dependencies.
function routeHead(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let head;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "head")
      head = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(head, `${file} must retain its head callback`);
  const { outputText } = ts.transpileModule(`return (${head.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  return new Function("seo", "pageSeo", "canonicalLink", outputText)(seo, pageSeo, canonicalLink);
}

const noindexed = (head) =>
  head.meta.some((meta) => meta.name === "robots" && meta.content.includes("noindex"));

test("Tsuen Wan always retains noindex", () => {
  const head = routeHead("src/routes/district.tsuen-wan.tsx");
  assert.ok(noindexed(head()));
});

test("empty transaction and estate-review pages retain conditional noindex", () => {
  for (const [file, key] of [
    ["transactions", "transactions"],
    ["estate-reviews", "articles"],
  ]) {
    const head = routeHead(`src/routes/${file}.tsx`);
    assert.ok(noindexed(head({ loaderData: { [key]: [] } })));
    assert.ok(noindexed(head({ loaderData: undefined })));
    assert.equal(noindexed(head({ loaderData: { [key]: [{ id: "synthetic" }] } })), false);
  }
});

test("listings noindexes zero results after the loader runs, preserving populated and pending behavior", () => {
  const head = routeHead("src/routes/listings.tsx");
  assert.ok(noindexed(head({ loaderData: { total: 0 } })));
  assert.equal(noindexed(head({ loaderData: { total: 1 } })), false);
  assert.equal(noindexed(head({ loaderData: undefined })), false);
});
