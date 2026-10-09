import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { withOwnedPostgres, repoRoot } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS, pendingMigrations } from "../control-plane/migration-versions.js";
import { formatDriftReport } from "../../../scripts/neon/check-migration-drift.mjs";

// FX-06 / B-01: managers read and act on every WhatsApp conversation, company-wide.
// Agents stay limited to their own conversations. Synthetic data, owned loopback
// Postgres only, one container for the whole suite.
const FORWARD = "20261007100000_wa_access_unassigned.sql";
const PREVIOUS = "20260929104000_whatsapp_enquiry_access.sql";
const REVERT_PATH = "neon/reverts/20261007100000_wa_access_unassigned_revert.sql";
// Windows checkouts may carry CRLF; compare the reviewed text, not the platform EOL.
const read = (path) => readFileSync(new URL(path, repoRoot), "utf8").replace(/\r\n/g, "\n");
const functionBlock = (sql, name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `incomplete ${name}`);
  return sql.slice(start, end + 3);
};
const MANAGER_BRANCH_RULE =
  "     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')\n" +
  "       AND a.branch_id IS NOT NULL AND a.branch_id=assignee.branch_id)\n";
const ENQUIRY_MANAGER_BRANCH_RULE =
  "     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')\n" +
  "       AND a.branch_id IS NOT NULL\n" +
  "       AND a.branch_id=COALESCE(owner.branch_id,assignee.branch_id))\n";
const MANAGER_ORG_WIDE_RULE =
  "     OR EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')\n";

const id = (n) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  branchA: id(1),
  branchB: id(2),
  admin: id(10),
  managerNoBranch: id(11),
  managerA: id(12),
  inactiveManager: id(13),
  agentA: id(14),
  agentB: id(15),
  viewer: id(16),
  unassigned: id(20),
  convA: id(21),
  convB: id(22),
  enquiryB: id(30),
  convExplicit: id(23),
  convReference: id(24),
  enquiryExplicit: id(31),
  enquiryReference: id(32),
};

test(
  "managers see and act on every WhatsApp conversation; agents stay own-only",
  { timeout: 180000 },
  async (t) => {
    const previousWakeUrl = process.env.OPS_WAKE_URL;
    process.env.OPS_WAKE_URL = "";
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("Provider/network request forbidden in FX-06 owned acceptance");
    });
    try {
      await withOwnedPostgres(async ({ query, transaction }) => {
        await query(
          "INSERT INTO branches(id,slug,name) VALUES($1,'fx06-a','合成分行甲'),($2,'fx06-b','合成分行乙')",
          [ids.branchA, ids.branchB],
        );
        for (const [staffId, role, active, branch] of [
          [ids.admin, "admin", true, null],
          [ids.managerNoBranch, "manager", true, null],
          [ids.managerA, "manager", true, ids.branchA],
          [ids.inactiveManager, "manager", false, null],
          [ids.agentA, "agent", true, ids.branchA],
          [ids.agentB, "agent", true, ids.branchB],
          [ids.viewer, "viewer", true, ids.branchA],
        ]) {
          await query(
            "INSERT INTO staff_users(id,email,name_zh,active,branch_id) VALUES($1,$2,$3,$4,$5)",
            [staffId, `fx06-${staffId.slice(-4)}@example.invalid`, `合成 ${role}`, active, branch],
          );
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2::staff_role)", [
            staffId,
            role,
          ]);
        }
        await query(
          "INSERT INTO whatsapp_conversations(id,assigned_agent_id) VALUES($1,NULL),($2,$3)",
          [ids.unassigned, ids.convA, ids.agentA],
        );
        await query(
          "INSERT INTO whatsapp_conversations(id,assigned_agent_id,confirmed_staff_id) VALUES($1,$2,$2)",
          [ids.convB, ids.agentB],
        );
        await query(
          "INSERT INTO inquiries(id,source,name,status,conversation_id,association_review,provider_thread_review) VALUES($1,'whatsapp','合成客戶','new',$2,false,false)",
          [ids.enquiryB, ids.convB],
        );
        // Reply-scope fixtures: both conversations belong to agent B (branch B).
        await query(
          "INSERT INTO whatsapp_conversations(id,assigned_agent_id,confirmed_staff_id) VALUES($1,$3,$3),($2,$3,$3)",
          [ids.convExplicit, ids.convReference, ids.agentB],
        );
        await query(
          "INSERT INTO inquiries(id,source,name,status,conversation_id,attribution_method,association_review,provider_thread_review) VALUES($1,'whatsapp','合成明示客戶','new',$2,'explicit_customer_statement',false,false),($3,'whatsapp','合成參考客戶','new',$4,'reference',false,false)",
          [ids.enquiryExplicit, ids.convExplicit, ids.enquiryReference, ids.convReference],
        );
        const canRead = async (actor, conversation) =>
          (
            await query("SELECT wa_can_read_conversation($1::uuid,$2::uuid) AS allowed", [
              actor,
              conversation,
            ])
          )[0].allowed;
        const canReadEnquiry = async (actor, inquiry) =>
          (
            await query("SELECT wa_can_read_enquiry($1::uuid,$2::uuid) AS allowed", [
              actor,
              inquiry,
            ])
          )[0].allowed;
        const canCorrect = async (actor, inquiry) =>
          (
            await query("SELECT wa_can_correct_enquiry($1::uuid,$2::uuid) AS allowed", [
              actor,
              inquiry,
            ])
          )[0].allowed;
        const canReply = async (actor, inquiry) =>
          (
            await query("SELECT wa_can_reply_enquiry($1::uuid,$2::uuid) AS allowed", [
              actor,
              inquiry,
            ])
          )[0].allowed;

        await t.test("manager without branch sees unassigned conversation", async () => {
          assert.equal(await canRead(ids.managerNoBranch, ids.unassigned), true);
          assert.equal(await canRead(ids.managerA, ids.unassigned), true);
          assert.equal(await canRead(ids.admin, ids.unassigned), true);
        });

        await t.test("manager sees other-branch conversation", async () => {
          assert.equal(await canRead(ids.managerA, ids.convB), true);
          assert.equal(await canRead(ids.managerNoBranch, ids.convB), true);
          assert.equal(await canRead(ids.managerA, ids.convA), true);
        });

        await t.test("manager can assign an unassigned conversation", async () => {
          const { requestConversationAssignment } = await import("./assignment.server.ts");
          const ports = { query, transaction };
          const input = { conversationId: ids.unassigned, staffId: ids.agentA, reason: "manager" };
          const forbidden = (error) => error instanceof Response && error.status === 403;
          // Agents gain nothing: a DB agent claiming the manager role is still refused
          // by the same SQL predicate, and so is an inactive manager.
          await assert.rejects(
            requestConversationAssignment(
              input,
              { staffId: ids.agentA, roles: ["manager"] },
              ports,
            ),
            forbidden,
          );
          await assert.rejects(
            requestConversationAssignment(
              input,
              { staffId: ids.inactiveManager, roles: ["manager"] },
              ports,
            ),
            forbidden,
          );
          const result = await requestConversationAssignment(
            input,
            { staffId: ids.managerNoBranch, roles: ["manager"] },
            ports,
          );
          assert.equal(result.ok, true);
          assert.ok(result.assignment.pending_assignment_id);
          const [request] = await query(
            "SELECT desired_staff_id,requested_by,reason,state FROM whatsapp_assignment_requests WHERE conversation_id=$1",
            [ids.unassigned],
          );
          assert.deepEqual(request, {
            desired_staff_id: ids.agentA,
            requested_by: ids.managerNoBranch,
            reason: "manager",
            state: "pending",
          });
        });

        await t.test("agent cannot see unassigned or others'", async () => {
          assert.equal(await canRead(ids.agentA, ids.unassigned), false);
          assert.equal(await canRead(ids.agentA, ids.convB), false);
          assert.equal(await canRead(ids.agentB, ids.convA), false);
          assert.equal(await canRead(ids.agentA, ids.convA), true);
          assert.equal(await canRead(ids.agentB, ids.convB), true);
        });

        await t.test("inactive manager and viewer see nothing", async () => {
          for (const conversation of [ids.unassigned, ids.convA, ids.convB]) {
            assert.equal(await canRead(ids.inactiveManager, conversation), false);
            assert.equal(await canRead(ids.viewer, conversation), false);
          }
        });

        await t.test("reply permission (wa_can_reply_enquiry) unchanged", async () => {
          const forwardStatements = read("neon/migrations/" + FORWARD).replace(/^--.*$/gm, "");
          assert.doesNotMatch(forwardStatements, /wa_can_reply_enquiry/);
          assert.equal(await canReply(ids.managerA, ids.enquiryB), false);
          assert.equal(await canReply(ids.managerNoBranch, ids.enquiryB), false);
          assert.equal(await canReply(ids.agentA, ids.enquiryB), false);
          assert.equal(await canReply(ids.agentB, ids.enquiryB), true);
        });

        await t.test("manager without branch reads any enquiry", async () => {
          for (const inquiry of [ids.enquiryB, ids.enquiryExplicit, ids.enquiryReference])
            assert.equal(await canReadEnquiry(ids.managerNoBranch, inquiry), true);
        });

        await t.test("other-branch manager reads enquiry", async () => {
          assert.equal(await canReadEnquiry(ids.managerA, ids.enquiryB), true);
          assert.equal(await canReadEnquiry(ids.admin, ids.enquiryB), true);
        });

        await t.test("manager still cannot correct other-branch enquiry", async () => {
          const forwardStatements = read("neon/migrations/" + FORWARD).replace(/^--.*$/gm, "");
          assert.doesNotMatch(forwardStatements, /wa_can_correct_enquiry/);
          assert.equal(await canCorrect(ids.managerA, ids.enquiryB), false);
          assert.equal(await canCorrect(ids.managerNoBranch, ids.enquiryB), false);
          assert.equal(await canCorrect(ids.admin, ids.enquiryB), true);
        });

        await t.test("agent unchanged for enquiries", async () => {
          assert.equal(await canReadEnquiry(ids.agentA, ids.enquiryB), false);
          assert.equal(await canReadEnquiry(ids.agentA, ids.enquiryReference), false);
          assert.equal(await canReadEnquiry(ids.agentB, ids.enquiryB), true);
          assert.equal(await canReadEnquiry(ids.inactiveManager, ids.enquiryB), false);
          assert.equal(await canReadEnquiry(ids.viewer, ids.enquiryB), false);
        });

        await t.test(
          "agent and manager assignment context carries no diagnostics; admin's does",
          async () => {
            // FX-17a G-11: the server strips staff ids, the request id, the proposal reason and
            // the provider evidence for every role but admin, before the result leaves it.
            const { readAssignmentContext } = await import("./assignment.server.ts");
            const ports = { query, transaction };
            const requestId = id(40);
            const evidence = { providerStatus: "synthetic_accepted", verified: true };
            // requested_staff_id is fixed at intake, so a second enquiry carries it.
            const requestedEnquiry = id(33);
            try {
              await query(
                "INSERT INTO whatsapp_assignment_requests(id,conversation_id,desired_staff_id,requested_by,version,reason,state,evidence) VALUES($1,$2,$3,$4,99,'fx17a-synthetic','unknown',$5::jsonb)",
                [requestId, ids.convB, ids.agentB, ids.admin, JSON.stringify(evidence)],
              );
              await query(
                "UPDATE whatsapp_conversations SET pending_assignment_id=$1,assignment_lock=true WHERE id=$2",
                [requestId, ids.convB],
              );
              await query(
                "INSERT INTO inquiries(id,source,name,status,conversation_id,requested_staff_id,association_review,provider_thread_review) VALUES($1,'whatsapp','合成指定客戶','new',$2,$3,false,false)",
                [requestedEnquiry, ids.convB, ids.agentB],
              );
              const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
              const staffIds = [
                ids.admin,
                ids.managerNoBranch,
                ids.managerA,
                ids.inactiveManager,
                ids.agentA,
                ids.agentB,
                ids.viewer,
              ];
              for (const [staffId, role] of [
                [ids.agentB, "agent"],
                [ids.managerNoBranch, "manager"],
                [ids.managerA, "manager"],
              ]) {
                const result = await readAssignmentContext(
                  ids.convB,
                  { staffId, roles: [role] },
                  ports,
                );
                const payload = JSON.stringify(result);
                for (const staff of staffIds)
                  assert.ok(!payload.includes(staff), `${role} payload carries staff id ${staff}`);
                assert.ok(!payload.includes(requestId), `${role} payload carries the request id`);
                for (const absent of ["evidence", "proposalReason", "synthetic_accepted", "Lock"])
                  assert.ok(!payload.includes(absent), `${role} payload carries ${absent}`);
                assert.equal(result.diagnostics, null);
                // What the inbox still needs: names, booleans, the state and the enquiry ids.
                assert.equal(result.confirmed, true);
                assert.equal(result.confirmedStaffName, "合成 agent");
                assert.equal(result.desired, true);
                assert.equal(result.desiredStaffName, "合成 agent");
                assert.equal(result.assignmentState, "unknown");
                assert.deepEqual(
                  byId(result.enquiries).map((e) => [e.id, e.requested, e.requestedStaffName]),
                  [
                    [ids.enquiryB, false, null],
                    [requestedEnquiry, true, "合成 agent"],
                  ],
                );
              }
              const admin = await readAssignmentContext(
                ids.convB,
                { staffId: ids.admin, roles: ["admin"] },
                ports,
              );
              assert.equal(admin.diagnostics.requestId, requestId);
              assert.deepEqual(admin.diagnostics.evidence, evidence);
              assert.equal(admin.diagnostics.confirmedStaffId, ids.agentB);
              assert.equal(admin.diagnostics.desiredStaffId, ids.agentB);
              assert.equal(admin.diagnostics.assignedAgentId, ids.agentB);
              assert.equal(admin.diagnostics.assignmentLock, true);
              assert.equal(typeof admin.diagnostics.proposalReason, "string");
              assert.deepEqual(byId(admin.diagnostics.enquiries), [
                { id: ids.enquiryB, requestedStaffId: null },
                { id: requestedEnquiry, requestedStaffId: ids.agentB },
              ]);
            } finally {
              // Restore the seeded state for the subtests that follow: unlink and remove the
              // request, remove the extra enquiry, and prove both are gone.
              await query(
                "UPDATE whatsapp_conversations SET pending_assignment_id=NULL,assignment_lock=false WHERE id=$1",
                [ids.convB],
              );
              await query("DELETE FROM inquiries WHERE id=$1", [requestedEnquiry]);
              await query("DELETE FROM whatsapp_assignment_requests WHERE id=$1", [requestId]);
              const [left] = await query(
                "SELECT (SELECT count(*) FROM inquiries WHERE id=$1)::int AS inquiries,(SELECT count(*) FROM whatsapp_assignment_requests WHERE id=$2)::int AS requests",
                [requestedEnquiry, requestId],
              );
              assert.deepEqual(left, { inquiries: 0, requests: 0 });
            }
          },
        );

        await t.test("no-branch manager reply scope through enqueueOutboundIntent", async () => {
          const { enqueueOutboundIntent } = await import("../woztell/outbound-intent.server.ts");
          let request = 100;
          const send = (conversationId, enquiryId) =>
            enqueueOutboundIntent(
              {
                requestId: id(request++),
                conversationId,
                ...(enquiryId ? { enquiryId } : {}),
                kind: "text",
                payload: { text: "合成回覆" },
              },
              ids.managerNoBranch,
              null,
              query,
            );
          const rejected = (error) => error.code === "OUTBOUND_CONFLICT_OR_NOT_FOUND";
          // (a) no enquiry on the conversation: queued.
          assert.equal((await send(ids.unassigned)).state, "queued");
          // (b) open explicit customer statement without a link-open: still needs
          // wa_can_reply_enquiry (assigned + confirmed), with or without enquiryId.
          await assert.rejects(send(ids.convExplicit), rejected);
          await assert.rejects(send(ids.convExplicit, ids.enquiryExplicit), rejected);
          // (c) open reference enquiry: queued (owner-approved scope).
          assert.equal((await send(ids.convReference)).state, "queued");
          assert.equal((await send(ids.convReference, ids.enquiryReference)).state, "queued");
          const intents = await query(
            "SELECT conversation_id,enquiry_id,state FROM whatsapp_outbound_intents WHERE actor_staff_id=$1 ORDER BY id",
            [ids.managerNoBranch],
          );
          assert.deepEqual(intents, [
            { conversation_id: ids.unassigned, enquiry_id: null, state: "queued" },
            {
              conversation_id: ids.convReference,
              enquiry_id: ids.enquiryReference,
              state: "queued",
            },
            {
              conversation_id: ids.convReference,
              enquiry_id: ids.enquiryReference,
              state: "queued",
            },
          ]);
          // Queued only; nothing reached a provider.
          assert.equal(network.mock.callCount(), 0);
        });

        await t.test("revert restores the branch rule", async () => {
          assert.equal(await canRead(ids.managerA, ids.convB), true);
          try {
            await query(read(REVERT_PATH));
            assert.equal(await canRead(ids.managerA, ids.convB), false);
            assert.equal(await canRead(ids.managerNoBranch, ids.unassigned), false);
            assert.equal(await canRead(ids.managerA, ids.convA), true);
            assert.equal(await canRead(ids.agentA, ids.unassigned), false);
            assert.equal(await canReadEnquiry(ids.managerA, ids.enquiryB), false);
            assert.equal(await canReadEnquiry(ids.managerNoBranch, ids.enquiryB), false);
            assert.equal(await canReadEnquiry(ids.agentB, ids.enquiryB), true);
          } finally {
            await query(read("neon/migrations/" + FORWARD));
          }
          assert.equal(await canRead(ids.managerA, ids.convB), true);
          assert.equal(await canRead(ids.managerNoBranch, ids.unassigned), true);
          assert.equal(await canReadEnquiry(ids.managerA, ids.enquiryB), true);
        });

        await t.test("revert file is ignored by the migration runner and drift check", async () => {
          // The runner applies only `.sql` files directly inside neon/migrations
          // (non-recursive readdirSync), and the drift check reads MIGRATION_VERSIONS.
          const runner = read("scripts/neon/apply-migrations.mjs");
          assert.match(runner, /const migrationsDir = "neon\/migrations";/);
          assert.match(runner, /readdirSync\(migrationsDir\)/);
          assert.doesNotMatch(runner, /recursive|neon\/reverts/);
          const drift = read("scripts/neon/check-migration-drift.mjs");
          assert.match(drift, /MIGRATION_VERSIONS,\s*pendingMigrations,/);
          assert.doesNotMatch(drift, /readdirSync|neon\/reverts/);

          const revertName = REVERT_PATH.split("/").pop();
          const runnerFiles = readdirSync(new URL("neon/migrations/", repoRoot))
            .filter((file) => file.endsWith(".sql"))
            .sort();
          assert.ok(runnerFiles.includes(FORWARD));
          assert.ok(!runnerFiles.includes(revertName));
          assert.ok(MIGRATION_VERSIONS.includes(FORWARD));
          assert.ok(!MIGRATION_VERSIONS.some((version) => version.includes("revert")));
          assert.deepEqual(pendingMigrations(MIGRATION_VERSIONS), []);

          const applied = (await query("SELECT version FROM app_migrations ORDER BY version")).map(
            (row) => row.version,
          );
          assert.ok(applied.includes(FORWARD));
          assert.ok(!applied.some((version) => version.includes("revert")));
          const report = formatDriftReport(pendingMigrations(applied));
          assert.equal(report.ok, true);
          assert.doesNotMatch(report.message, /revert/);
        });

        await t.test(
          "forward and revert bodies differ from the previous body only in the manager rule",
          () => {
            const previousSql = read("neon/migrations/" + PREVIOUS);
            const forwardSql = read("neon/migrations/" + FORWARD);
            const revertSql = read(REVERT_PATH);
            for (const [name, rule] of [
              ["wa_can_read_conversation", MANAGER_BRANCH_RULE],
              ["wa_can_read_enquiry", ENQUIRY_MANAGER_BRANCH_RULE],
            ]) {
              const previous = functionBlock(previousSql, name);
              assert.ok(previous.includes(rule), name);
              assert.equal(
                functionBlock(forwardSql, name),
                previous.replace(rule, MANAGER_ORG_WIDE_RULE),
                name,
              );
              assert.equal(functionBlock(revertSql, name), previous, name);
            }
            for (const [file, sql] of [
              [FORWARD, forwardSql],
              [REVERT_PATH, revertSql],
            ]) {
              assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 2, file);
              assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /wa_can_correct_enquiry/, file);
              assert.doesNotMatch(sql, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i, file);
            }
          },
        );
      });
    } finally {
      network.mock.restore();
      if (previousWakeUrl === undefined) delete process.env.OPS_WAKE_URL;
      else process.env.OPS_WAKE_URL = previousWakeUrl;
    }
  },
);
