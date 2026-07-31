/**
 * Import the FAQ seed and queue the AI knowledge rebuild.
 *
 * Mirrors what /admin/cms?tab=faqs does — parseAdminFaqImport, then one row per
 * pair — except it upserts on (scope, question). The admin panel's saveAdminFaq
 * does a bare INSERT, so before 20260801090000 added that constraint, importing
 * the same file twice silently created duplicates.
 *
 * Usage:
 *   DATABASE_URL="$(neonctl connection-string production \
 *     --project-id dawn-meadow-79190048 --pooled)" node scripts/neon/import-faqs.mjs
 */
import { readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";

import { parseAdminFaqImport } from "../../src/lib/admin/faq-import.ts";

const SOURCE = "docs/faq-seed-import.txt";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. See the usage comment at the top of this file.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const rows = parseAdminFaqImport(readFileSync(SOURCE, "utf8"));

if (!rows.length) {
  console.error(`No FAQs parsed from ${SOURCE}`);
  process.exit(1);
}

const [before] = await sql`SELECT count(*)::int AS n FROM faqs`;

for (const [index, row] of rows.entries()) {
  await sql`
    INSERT INTO faqs (scope, question, answer, sort_order)
    VALUES (${row.scope}, ${row.question}, ${row.answer}, ${index + 1})
    ON CONFLICT (scope, question) DO UPDATE
      SET answer = EXCLUDED.answer, sort_order = EXCLUDED.sort_order
  `;
}

const [after] = await sql`SELECT count(*)::int AS n FROM faqs`;
console.log(`parsed ${rows.length} | faqs ${before.n} -> ${after.n}`);

// The rebuild payload validator requires exactly one key holding a real staff
// UUID, so the job has to be attributed to an actual admin.
const [staff] = await sql`
  SELECT s.id FROM staff_users s
  JOIN staff_roles r ON r.staff_user_id = s.id
  WHERE s.active = true AND r.role = 'admin'
  ORDER BY s.created_at ASC LIMIT 1
`;

if (!staff?.id) {
  console.error("No admin staff row found — cannot attribute the rebuild job.");
  process.exit(1);
}

// Idempotency key is windowed so repeated runs inside five minutes coalesce into
// one job rather than queueing a rebuild per run.
const window = Math.floor(Date.now() / (5 * 60 * 1000));
const [job] = await sql`
  INSERT INTO ops_jobs
    (job_type, payload_version, payload, status, max_attempts, run_after,
     idempotency_key, actor_staff_id)
  VALUES ('ai.knowledge.rebuild', 1,
          ${JSON.stringify({ requestedByStaffId: staff.id })}::jsonb,
          'queued', 5, now(), ${`ai.knowledge.rebuild:${window}`}, ${staff.id})
  ON CONFLICT (idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id, status
`;
console.log(`queued rebuild job ${job.id} (${job.status})`);
