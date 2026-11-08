import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// FX-17a G-20: every form that holds half-entered staff work must ask 尚未儲存 before the
// page is left (in-app navigation and tab close both go through useRouteLeaveGuard).
const read = (path) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const has = (source, pattern, message) =>
  assert.ok(typeof pattern === "string" ? source.includes(pattern) : pattern.test(source), message);

/** Source of `function name(` up to the next top-level function declaration. */
function body(source, name) {
  const start = source.indexOf(`
function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function \w+\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

test("TransactionForm mounts the leave guard on real edits and re-baselines (flushed) before onSaved", () => {
  const source = read("src/components/dashboard/TransactionForm.tsx");
  has(source, /useRouteLeaveGuard\(isDirty\)/, "TransactionForm must call useRouteLeaveGuard");
  has(source, /isTransactionFormDirty\(/, "dirty must compare against the loaded form");
  has(source, /\{leaveGuardDialog\}/, "the guard dialog must be rendered");
  const saved = source.indexOf("flushSync(() => setBaseline(form))");
  const onSaved = source.indexOf("onSaved(result.id)");
  assert.ok(saved >= 0 && onSaved > saved, "the re-baseline must be flushed before onSaved(");
  assert.ok(
    !source.includes("setSaved"),
    "no sticky saved flag: later edits must re-arm the guard",
  );
});

for (const [name, closeGuard] of [
  ["CmsVideoDialog", "videoDirty"],
  ["EstateDialog", "isDirty || imageUploading"],
  ["ArticleDialog", "isDirty || imageUploading"],
  ["FaqDialog", "faqDirty"],
]) {
  test(`${name} mounts a leave guard on the same dirty state as its close guard`, () => {
    const source = body(read("src/routes/admin.cms.tsx"), name);
    has(source, "useRouteLeaveGuard(", `${name} must call useRouteLeaveGuard`);
    has(source, "leaveGuard", `${name} must render the leave guard dialog`);
    has(
      source,
      `useRouteLeaveGuard(${closeGuard})`,
      `${name} guard must use the close guard's dirty value`,
    );
    has(source, "{leaveGuard}", `${name} must render {leaveGuard}`);
  });
}

test("the blasts workspace guards unsaved campaign and audience drafts", () => {
  const source = read("src/routes/admin.blasts.tsx");
  has(
    source,
    /useRouteLeaveGuard\(\s*hasUnsavedCampaignChanges \|\| hasUnsavedAudienceChanges,?\s*\)/,
    "blasts must guard campaign and audience edits",
  );
  has(source, "{leaveGuardDialog}", "blasts must render the guard dialog");
});
