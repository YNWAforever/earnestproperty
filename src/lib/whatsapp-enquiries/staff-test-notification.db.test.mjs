import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  enqueueStaffTestNotification,
  previewStaffTestNotification,
  dispatchStaffTestNotification,
} from "../neon/whatsapp-test-notification.server.ts";

const actorId = "00000000-0000-4000-8000-000000000001";
const staffId = "00000000-0000-4000-8000-000000000002";
const endpointId = "00000000-0000-4000-8000-000000000003";
const actor = { staffId: actorId, roles: ["admin"] };

test("test notification preview is isolated, revoked endpoint blocks, and request/rate identities persist", async () => {
  const db = new PGlite();
  const env = {
    EP_WA_ENQUIRY_MODE: "active",
    EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
    EP_WA_STAFF_WHATSAPP_ALERTS_ENABLED: "true",
    EP_WA_COMPANY_CHANNEL_ID: "company",
    WOZTELL_CHANNEL_ID: "company",
    EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: "synthetic",
    EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "synthetic",
    EP_WA_STAFF_ASSOCIATION_REVIEW_REF: "synthetic",
    EP_WA_STAFF_REPLY_CONTEXT_PATH: "/synthetic",
    EP_WA_INBOX_VERIFICATION_REF: "synthetic",
    WOZTELL_APP_ID: "synthetic",
    EP_WA_INBOX_INTEGRATION_ID: "synthetic",
    EP_WA_INBOX_SIGNATURE: "synthetic",
    EP_WA_INBOX_LIST_THREADS_URL: "https://api.inbox.woztell.sanuker.com/test/threads",
    EP_WA_INBOX_LIST_USERS_URL: "https://api.inbox.woztell.sanuker.com/test/users",
    EP_WA_INBOX_ASSIGN_URL: "https://api.inbox.woztell.sanuker.com/test/assign",
    EP_WA_INBOX_INTERNAL_MESSAGE_URL: "https://api.inbox.woztell.sanuker.com/test/notes",
  };
  const old = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const query = async (statement, params = []) => (await db.query(statement, params)).rows;
  const transaction = async (statements) => {
    await db.exec("BEGIN");
    try {
      const result = [];
      for (const item of statements) result.push(await query(item.statement, item.params ?? []));
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    await db.exec(`
      CREATE TYPE staff_role AS ENUM ('admin','manager','agent','viewer');
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,name_zh text,name_en text);
      CREATE TABLE staff_roles(staff_user_id uuid,role staff_role);
      CREATE TABLE whatsapp_staff_channels(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid,channel_id text,inbox_user_id text,folder_id text,eligible boolean,verification_ref text,verified_at timestamptz,retired_at timestamptz);
      CREATE TABLE staff_notification_endpoints(id uuid PRIMARY KEY,staff_id uuid,channel_id text,transport text,destination_reference text,version integer,enabled boolean,verified_at timestamptz,retired_at timestamptz,permission_granted boolean,permission_ref text,quiet_hours_policy jsonb,last_inbound_at timestamptz,template_name text,template_language text,template_verified_at timestamptz,updated_at timestamptz);
      CREATE TABLE whatsapp_conversations(channel_id text,woztell_member_id text);
      CREATE TABLE ops_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_type text,payload_version integer,payload jsonb,status text,max_attempts integer,idempotency_key text UNIQUE,actor_staff_id uuid,lease_owner text,lease_expires_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE ops_audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_staff_id uuid,permission text,action text,resource_type text,resource_id text,outcome text,request_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());
    `);
    await db.exec(
      readFileSync("neon/migrations/20260927083000_staff_notification_test_attempts.sql", "utf8"),
    );
    await query("INSERT INTO staff_users VALUES($1,true,'管理員',null),($2,true,'合成同事',null)", [
      actorId,
      staffId,
    ]);
    await query("INSERT INTO staff_roles VALUES($1,'admin'),($2,'agent')", [actorId, staffId]);
    await query(
      "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,eligible,verification_ref,verified_at) VALUES($1,'company','inbox-staff','folder',true,'synthetic',now())",
      [staffId],
    );
    await query(
      `INSERT INTO staff_notification_endpoints(id,staff_id,channel_id,transport,destination_reference,version,enabled,verified_at,permission_granted,permission_ref,quiet_hours_policy,last_inbound_at,updated_at)
      VALUES($1,$2,'company','staff_whatsapp','85291234567',3,true,now(),true,'synthetic','{"approved":true,"allowAllHours":true}',now(),now())`,
      [endpointId, staffId],
    );
    const input = { staffId, transport: "staff_whatsapp", endpointVersion: 3 };
    await assert.rejects(
      previewStaffTestNotification(input, { staffId, roles: ["agent"] }, query),
      (error) => error instanceof Response && error.status === 403,
    );
    const preview = await previewStaffTestNotification(input, actor, query);
    assert.equal(preview.ready, true);
    assert.equal(preview.maskedDestination, "••••4567");
    assert.match(preview.message, /\[測試\]/);
    assert.doesNotMatch(JSON.stringify(preview), /85291234567/);
    await query("UPDATE staff_notification_endpoints SET enabled=false WHERE id=$1", [endpointId]);
    await assert.rejects(
      enqueueStaffTestNotification(
        { ...input, previewToken: preview.previewToken, requestId: randomUUID() },
        actor,
        { query, transaction },
      ),
      (error) => error instanceof Response && error.status === 409,
    );
    assert.equal((await query("SELECT count(*)::int AS n FROM ops_jobs"))[0].n, 0);
    await query("UPDATE staff_notification_endpoints SET enabled=true WHERE id=$1", [endpointId]);
    const next = await previewStaffTestNotification(input, actor, query);
    const requestId = randomUUID();
    const first = await enqueueStaffTestNotification(
      { ...input, previewToken: next.previewToken, requestId },
      actor,
      { query, transaction },
    );
    assert.equal(first.state, "queued");
    assert.ok(first.jobId);
    const again = await enqueueStaffTestNotification(
      { ...input, previewToken: next.previewToken, requestId },
      actor,
      { query, transaction },
    );
    assert.equal(again.attemptId, first.attemptId);
    assert.equal(again.jobId, first.jobId);
    await assert.rejects(
      enqueueStaffTestNotification(
        { ...input, previewToken: next.previewToken, requestId: randomUUID() },
        actor,
        { query, transaction },
      ),
      (error) => error instanceof Response && error.status === 409,
    );
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM staff_notification_test_attempts"))[0].n,
      1,
    );
    assert.equal((await query("SELECT count(*)::int AS n FROM ops_jobs"))[0].n, 1);
    assert.equal((await query("SELECT count(*)::int AS n FROM ops_audit_logs"))[0].n, 1);
    assert.equal((await query("SELECT count(*)::int AS n FROM whatsapp_conversations"))[0].n, 0);
    await query(
      "UPDATE ops_jobs SET status='running',lease_owner='synthetic-worker',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
      [first.jobId],
    );
    let providerCalls = 0;
    const inspect = (id) =>
      import("../neon/whatsapp-readiness.server.ts").then((api) =>
        api.inspectWhatsappStaffReadinessForDispatch(id, {
          query,
          runtime: {
            channelId: "company",
            assignmentEnabled: true,
            notificationsEnabled: true,
            staffWhatsAppEnabled: true,
            inboxProviderVerified: true,
            staffTransportVerified: true,
            templateContractVerified: false,
          },
        }),
      );
    const deps = {
      query,
      inspect,
      staff: () => ({
        verificationRef: "synthetic",
        sendStaffWhatsApp: async (scope) => {
          providerCalls++;
          assert.match(scope.message, /\[測試\]/);
          assert.equal(scope.memberId, "85291234567");
          await scope.beforeSend();
          return {
            state: "accepted",
            evidenceKind: "provider_accepted",
            providerOperationId: "synthetic-acceptance",
          };
        },
      }),
    };
    const context = {
      jobId: first.jobId,
      workerId: "synthetic-worker",
      checkpoint: async () => {},
    };
    assert.deepEqual(await dispatchStaffTestNotification(first.attemptId, context, deps), {
      summary: { accepted: 1 },
    });
    assert.equal(providerCalls, 1);
    const saved = (
      await query(
        "SELECT state,evidence_kind,provider_operation_id,accepted_at FROM staff_notification_test_attempts WHERE id=$1",
        [first.attemptId],
      )
    )[0];
    assert.equal(saved.state, "accepted");
    assert.equal(saved.evidence_kind, "provider_accepted");
    assert.ok(saved.accepted_at);
    assert.deepEqual(await dispatchStaffTestNotification(first.attemptId, context, deps), {
      summary: { skipped: 1 },
    });
    assert.equal(providerCalls, 1);
    const [uncertain] = await query(
      `INSERT INTO staff_notification_test_attempts(request_id,preview_id,actor_staff_id,staff_id,transport,endpoint_id,endpoint_version,payload_hash)
      SELECT $1::uuid,preview_id,actor_staff_id,staff_id,transport,endpoint_id,endpoint_version,'synthetic-unknown' FROM staff_notification_test_attempts WHERE id=$2::uuid RETURNING id`,
      [randomUUID(), first.attemptId],
    );
    const [uncertainJob] = await query(
      `INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,idempotency_key,actor_staff_id,lease_owner,lease_expires_at)
      VALUES('woztell.enquiry.staff.test',1,jsonb_build_object('attemptId',$1::uuid),'running',1,$2,$3,'synthetic-worker',now()+interval '5 minutes') RETURNING id`,
      [uncertain.id, `synthetic:${uncertain.id}`, actorId],
    );
    let uncertainCalls = 0;
    const uncertainDeps = {
      ...deps,
      staff: () => ({
        verificationRef: "synthetic",
        sendStaffWhatsApp: async (scope) => {
          uncertainCalls++;
          await scope.beforeSend();
          throw new Error("synthetic timeout after irreversible POST");
        },
      }),
    };
    const uncertainContext = { ...context, jobId: uncertainJob.id };
    assert.deepEqual(
      await dispatchStaffTestNotification(uncertain.id, uncertainContext, uncertainDeps),
      { summary: { unknown: 1 } },
    );
    assert.equal(
      (
        await query("SELECT state,accepted_at FROM staff_notification_test_attempts WHERE id=$1", [
          uncertain.id,
        ])
      )[0].state,
      "unknown",
    );
    assert.deepEqual(
      await dispatchStaffTestNotification(uncertain.id, uncertainContext, uncertainDeps),
      { summary: { skipped: 1 } },
    );
    assert.equal(uncertainCalls, 1);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.close();
  }
});
