import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync("src/routes/admin.whatsapp.tsx", "utf8");
const parsed = ts.createSourceFile(
  "inbox.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = [
  "outboundStorageKey",
  "stableOutboundRequestId",
  "clearOutboundRequestId",
  "assertNoMutationError",
  "formatReplyError",
  "releaseRejectedOutboundRequest",
];
const snippets = parsed.statements
  .filter((n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text))
  .map((n) => n.getText(parsed))
  .join("\n");
assert.equal(
  parsed.statements.filter((n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text))
    .length,
  names.length,
);
function helpers() {
  const storage = new Map();
  const context = {
    replyErrorLabels: {},
    crypto: { randomUUID },
    sessionStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
  };
  vm.runInNewContext(
    ts.transpile(snippets + "\n globalThis.h={" + names.join(",") + "};", {
      target: ts.ScriptTarget.ES2022,
    }),
    context,
  );
  return context.h;
}
for (const kind of ["text", "template"])
  test(`composer ${kind}: definitive association rejection can be corrected, unknown remains reserved`, () => {
    const h = helpers();
    const original = JSON.stringify(["body", null]),
      corrected = JSON.stringify(["body", "episode"]);
    for (const code of ["ENQUIRY_SELECTION_REQUIRED", "ENQUIRY_ASSOCIATION_INVALID"]) {
      h.stableOutboundRequestId("user", "conversation", kind, original);
      let rejection;
      try {
        h.assertNoMutationError({ ok: false, error: code });
      } catch (e) {
        rejection = e;
      }
      assert.equal(rejection.code, code);
      h.releaseRejectedOutboundRequest(rejection, "user", "conversation", kind);
      assert.doesNotThrow(() => h.stableOutboundRequestId("user", "conversation", kind, corrected));
      h.clearOutboundRequestId("user", "conversation", kind);
    }
    const id = h.stableOutboundRequestId("user", "conversation", kind, original);
    h.releaseRejectedOutboundRequest(
      new Error("OUTBOUND_PERSISTENCE_UNAVAILABLE"),
      "user",
      "conversation",
      kind,
    );
    assert.equal(h.stableOutboundRequestId("user", "conversation", kind, original), id);
    assert.throws(() => h.stableOutboundRequestId("user", "conversation", kind, corrected));
  });
test("both catch paths retire definite rejections even after switching threads", () => {
  for (const kind of ["text", "template"]) {
    const release = source.indexOf(
      `releaseRejectedOutboundRequest(err, user?.id, targetId, "${kind}")`,
    );
    assert.ok(release >= 0);
    assert.match(
      source.slice(release, release + 250),
      /releaseRejectedOutboundRequest[\s\S]*if \(!canApplyConversationDetail/,
    );
  }
});
