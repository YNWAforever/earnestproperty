import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Content Copilot server functions are staff-authenticated and server delegated", () => {
  const source = readFileSync(new URL("./content-copilot-admin.ts", import.meta.url), "utf8");
  assert.match(source, /createServerFn\(\{ method: "POST" \}\)/);
  assert.match(source, /requireStaffAccess\(getRequest\(\), \["admin", "manager", "agent"\]\)/);
  assert.match(source, /generateContentProposal/);
  assert.match(source, /decideContentProposal/);
  assert.match(source, /withStaffAuthHeaders/);
  assert.doesNotMatch(source, /OPENCODE_GO_API_KEY|TAVILY_API_KEY/);
  assert.match(source, /contentCopilotRequestSchema/);
  assert.match(source, /z\.string\(\)\.uuid\(\)/);
});
