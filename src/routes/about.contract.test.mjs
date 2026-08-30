import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

// /about's team preview used to read `agent.branch` directly. This suite
// guards against it silently drifting back to that (or to a guessed
// default) now that a real branch_id can be linked -- see
// 20260830160000_branches_entity.sql and CHANGELOG.md:79-87 for the
// documented history of the exact bug class this protects against.
test("/about resolves the team preview's branch label via the shared agentBranchName helper", () => {
  const source = read("src/routes/about.tsx");

  assert.match(source, /import \{ agentBranchName \} from "@\/lib\/agent-directory"/);
  assert.match(source, /agentBranchName\(agent, branches\)/);
  // No route may keep its own copy of the branch_id-preferred/free-text
  // fallback logic -- agents.tsx, agents_.$slug.tsx, PropertyDecisionActions,
  // and this file all delegate to the one implementation in agent-directory.ts.
  assert.doesNotMatch(source, /agent\.branch\b/);
  assert.doesNotMatch(source, /branchName\s*\?\?/);
  assert.doesNotMatch(source, /SITE_BRANCHES\s*\[\s*0\s*\]/);
  assert.match(
    source,
    /\{branchName \? \(/,
    "the team preview must render the branch label conditionally, never unconditionally",
  );
});

test("/about's loader fetches branches alongside the team roster, both degrading gracefully on failure", () => {
  const source = read("src/routes/about.tsx");

  assert.match(
    source,
    /fetchNeonPublicAgentProfiles\(\)\.catch\(\(\) => \[\] as NeonPublicAgentProfile\[\]\)/,
  );
  assert.match(source, /fetchNeonBranches\(\)\.catch\(\(\) => \[\] as NeonBranchRecord\[\]\)/);
});
