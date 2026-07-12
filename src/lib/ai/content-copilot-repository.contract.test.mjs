import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("proposal migration enforces lifecycle, quota indexes, and staff ownership", () => {
  const sql = readFileSync("neon/migrations/20260712120000_ai_content_proposals.sql", "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_content_proposals/);
  assert.match(sql, /status IN \('generating','generated','partially_applied','applied','rejected','expired','failed'\)/);
  assert.match(sql, /WHERE status = 'generating'/);
  assert.match(sql, /requested_by UUID NOT NULL REFERENCES staff_users\(id\)/);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/);
});

test("repository exposes explicit proposal transitions and AI audit writes", () => {
  const source = readFileSync("src/lib/ai/content-copilot-repository.server.ts", "utf8");
  for (const name of ["startContentProposal", "completeContentProposal", "failContentProposal", "getContentProposal", "decideContentProposal", "writeContentCopilotAudit"]) {
    assert.match(source, new RegExp(`export async function ${name}\\b`));
  }
  assert.match(source, /20[\s\S]*interval '1 hour'/i);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /ai_content_proposals_one_generating_per_staff_idx/);
  assert.match(source, /resource_id =/);
  assert.match(source, /INSERT INTO ai_audit_logs/);
  assert.match(source, /COPILOT_AUDIT_METADATA_INVALID/);
  assert.match(source, /isGeneratingProposalConflict/);
  assert.match(source, /expires_at > now\(\)/);
  assert.match(source, /COPILOT_PROVIDER_UNSUPPORTED/);
});
