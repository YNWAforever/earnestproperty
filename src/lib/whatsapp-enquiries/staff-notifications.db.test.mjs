import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { neon, neonConfig } from "@neondatabase/serverless";
function splitSqlStatements(query) {
  const statements = [];
  let current = "",
    single = false,
    double = false,
    dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index],
      next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const url = process.env.ASTRA_TEST_DATABASE_URL;
process.env.VITE_SITE_URL = "https://earnest.example.invalid";
const nativeFetch = globalThis.fetch;
const dbHost = url ? new URL(url).hostname : null;
const driverEndpoint = url
  ? typeof neonConfig.fetchEndpoint === "function"
    ? neonConfig.fetchEndpoint(dbHost, 443, {})
    : neonConfig.fetchEndpoint
  : null;
const httpHost = driverEndpoint ? new URL(driverEndpoint).hostname : null;
globalThis.fetch = async (input, init) => {
  const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (host !== httpHost || headers.get("Neon-Connection-String") !== url)
    throw new Error("UNEXPECTED_PROVIDER_NETWORK");
  return nativeFetch(input, init);
};
after(() => {
  globalThis.fetch = nativeFetch;
});
test("NT-07/08/11/19/23 notification production transactions", { skip: !url }, async (t) => {
  assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
  const db = neon(url),
    schema = "wa_notify_" + randomUUID().replaceAll("-", "");
  const tx = async (statements) =>
    (
      await db.transaction((q) => [
        q.query("SELECT set_config('search_path',$1,true)", [schema]),
        ...statements.map((s) => q.query(s.statement, s.params ?? [])),
      ])
    ).slice(1);
  const query = async (statement, params = []) => (await tx([{ statement, params }]))[0];
  const staff = randomUUID(),
    conv = randomUUID(),
    contact = randomUUID(),
    policy = randomUUID(),
    generation = randomUUID();
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const statement of [
      `CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)`,
      `CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean DEFAULT true,name_zh text,name_en text,auth_user_id text,email text)`,
      `CREATE TABLE staff_roles(staff_user_id uuid,role text)`,
      `CREATE TABLE properties(id uuid PRIMARY KEY,agent_id uuid,deal_type text)`,
      `CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text,opted_out_whatsapp boolean DEFAULT false,whatsapp_member_id text)`,
      `CREATE TABLE crm_leads(id uuid PRIMARY KEY)`,
      `CREATE TABLE crm_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,contact_id uuid,staff_user_id uuid,activity_type text,body text,due_at timestamptz)`,
      `CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,assigned_agent_id uuid,channel_id text,woztell_member_id text,last_inbound_at timestamptz,last_message_at timestamptz,updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid,contact_id uuid,direction text,message_type text,text text,channel_id text,woztell_member_id text,external_message_id text UNIQUE,sent_by uuid,status text,payload jsonb,error text)`,
      `CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text DEFAULT 'website',name text NOT NULL,crm_contact_id uuid,property_id uuid,status text DEFAULT 'new',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE ops_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_type text,payload_version integer,payload jsonb,status text,attempt_count integer DEFAULT 0,max_attempts integer,run_after timestamptz,lease_owner text,lease_expires_at timestamptz,last_error_code text,last_error_summary text,idempotency_key text UNIQUE,actor_staff_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
    ])
      await query(statement);
    for (const file of [
      "20260905130000_outbound_intents.sql",
      "20260912120000_whatsapp_enquiry_events.sql",
      "20260912130000_whatsapp_enquiry_episodes.sql",
      "20260912140000_whatsapp_assignment_evidence.sql",
      "20260912150000_whatsapp_service_workflow.sql",
      "20260912170000_staff_notifications.sql",
      "20260927080000_staff_notification_receipt_times.sql",
    ]) {
      if (file.includes("staff_notifications"))
        await query("INSERT INTO inquiries(source,name) VALUES('website','Synthetic legacy row')");
      let sql = readFileSync("neon/migrations/" + file, "utf8");
      if (file.includes("outbound_intents"))
        sql = sql.slice(0, sql.indexOf("-- Existing duplicates"));
      await tx(splitSqlStatements(sql).map((statement) => ({ statement })));
    }

    await query("INSERT INTO staff_users(id) VALUES($1)", [staff]);
    await query("INSERT INTO staff_roles VALUES($1,'agent')", [staff]);
    await query("INSERT INTO crm_contacts(id,name) VALUES($1,'Synthetic')", [contact]);
    await query(
      "INSERT INTO whatsapp_conversations(id,contact_id,channel_id,woztell_member_id) VALUES($1,$2,'fixture','customer')",
      [conv, contact],
    );
    await query("INSERT INTO whatsapp_service_policies(id,version,rules) VALUES($1,1,'{}')", [
      policy,
    ]);
    await query(
      "INSERT INTO whatsapp_enquiry_activations(id,mode,policy_id,created_by,cutover_at) VALUES($1,'active',$2,$3,now()-interval '1 hour')",
      [generation, policy, staff],
    );
    await query(
      "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at) VALUES($1,'fixture','agent','folder','node',true,'SYNTHETIC',now())",
      [staff],
    );
    async function enquiry(eligible = true, routing = false) {
      const message = randomUUID(),
        event = randomUUID(),
        inquiry = randomUUID();
      await query(
        "INSERT INTO whatsapp_messages(id,conversation_id,contact_id,direction,channel_id,woztell_member_id,external_message_id) VALUES($1::uuid,$2,$3,'inbound','fixture','customer',$1::text)",
        [message, conv, contact],
      );
      await query(
        "INSERT INTO whatsapp_enquiry_events(id,dedupe_key,origin,app_id,channel_id,member_id,external_message_id,message_id,kind,occurred_at,received_at,timing,identity_quality,evidence,capture_mode,effects_eligible,activation_id) VALUES($1::uuid,md5($1::text)||md5($1::text),'live_webhook','fixture-app','fixture','customer',$1::text,$2,'customer_message',now(),now(),'fresh','provider_id',$3::jsonb,'active',true,$4)",
        [
          event,
          message,
          JSON.stringify({ staffNotificationsEligible: eligible, staffRoutingEligible: routing }),
          generation,
        ],
      );
      await query(
        "INSERT INTO inquiries(id,source,name,conversation_id,intake_message_id,requested_staff_id,effects_eligible,activation_id,association_review) VALUES($1,'whatsapp','Synthetic',$2,$3,$4,true,$5,false)",
        [inquiry, conv, message, staff, generation],
      );
      await query("UPDATE whatsapp_enquiry_events SET inquiry_id=$2 WHERE id=$1", [event, inquiry]);
      return { inquiry, event };
    }
    const first = await enquiry();
    assert.equal((await query("SELECT count(*)::int n FROM staff_notification_intents"))[0].n, 0);
    await query(
      "INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,version,reason,state,evidence) VALUES($1,$2,1,'fixture','confirmed',jsonb_build_object('authoritative',true))",
      [conv, staff],
    );
    await tx([
      { statement: "SELECT set_config('app.wa_confirm_assignment','true',true)" },
      {
        statement:
          "UPDATE whatsapp_conversations SET confirmed_staff_id=$2,assigned_agent_id=$2,assignment_version=1,pending_assignment_id=(SELECT id FROM whatsapp_assignment_requests WHERE conversation_id=$1) WHERE id=$1",
        params: [conv, staff],
      },
    ]);
    await t.test("NT-11 ready and intent and validated job commit together", async () => {
      assert.equal((await query("SELECT count(*)::int n FROM staff_notification_intents"))[0].n, 1);
      assert.equal(
        (
          await query(
            "SELECT count(*)::int n FROM ops_jobs WHERE job_type='woztell.enquiry.staff.notify'",
          )
        )[0].n,
        1,
      );
    });
    await t.test(
      "NT-07/08 repeat evidence does not duplicate; second enquiry same assignment does",
      async () => {
        await Promise.all(
          Array.from({ length: 4 }, () =>
            query("SELECT wa_capture_staff_ready($1)", [first.inquiry]),
          ),
        );
        await enquiry();
        assert.equal(
          (await query("SELECT count(*)::int n FROM staff_notification_intents"))[0].n,
          2,
        );
      },
    );
    await t.test("NT-23 off capture never becomes notification backlog", async () => {
      await enquiry(false);
      assert.equal((await query("SELECT count(*)::int n FROM staff_notification_intents"))[0].n, 2);
      await assert.rejects(
        query("UPDATE whatsapp_enquiry_events SET notification_eligible=false WHERE id=$1", [
          first.event,
        ]),
        /IMMUTABLE/,
      );
    });

    await t.test("NT-08/19 concurrent dispatch and unknown outcome never resend", async () => {
      const { dispatchStaffNotification, reconcileStaffNotification } =
        await import("./staff-notifications.server.ts");
      const [n] = await query(
        "SELECT id FROM staff_notification_intents ORDER BY created_at LIMIT 1",
      );
      await query(
        "INSERT INTO staff_notification_endpoints(staff_id,transport,channel_id,destination_reference,verified_at,verification_ref,enabled,permission_granted,permission_ref,quiet_hours_policy) VALUES($1,'inbox_private_note','fixture','agent',now(),'SYNTHETIC',true,true,'SYNTHETIC','{\"approved\":true,\"allowAllHours\":true}')",
        [staff],
      );
      const [job] = await query("SELECT id FROM ops_jobs WHERE payload->>'notificationId'=$1", [
        n.id,
      ]);
      await tx([
        {
          statement:
            "SELECT set_config('app.wa_worker_capabilities','[\"woztell.enquiry.staff.notify@1\"]',true)",
        },
        {
          statement:
            "UPDATE ops_jobs SET status='running',lease_owner='fixture',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
          params: [job.id],
        },
      ]);
      const options = { checkpoint: async () => {}, job: { jobId: job.id, workerId: "fixture" } };
      const runtime = {
        enabled: true,
        generationId: generation,
        channelId: "fixture",
        staffWhatsAppEnabled: false,
        ackEscalationEnabled: false,
      };
      let calls = 0;
      const adapter = {
        verificationRef: "SYNTHETIC",
        postPrivateNote: async () => {
          calls++;
          throw new Error("uncertain");
        },
      };
      await Promise.all(
        Array.from({ length: 4 }, () =>
          dispatchStaffNotification(n.id, options, { query, transaction: tx }, runtime, adapter),
        ),
      );
      assert.equal(calls, 1);
      assert.equal(
        (await query("SELECT dispatch_state FROM staff_notification_attempts"))[0].dispatch_state,
        "unknown",
      );
      await reconcileStaffNotification(n.id, query);
      await dispatchStaffNotification(n.id, options, { query, transaction: tx }, runtime, adapter);
      assert.equal(calls, 1);
    });

    await t.test(
      "NT-14/15/24 actual authenticated API only intended recipient can acknowledge",
      async () => {
        const { listMyStaffNotifications, acknowledgeStaffAssignment, requestStaffAssignmentHelp } =
          await import("../neon/staff-notifications.server.ts");
        const actor = { staffId: staff, roles: ["agent"] };
        const ports = { query, transaction: tx };
        const page = await listMyStaffNotifications({}, actor, query);
        assert.equal(page.items.length, 2);
        const item = page.items[0],
          input = { notificationId: item.id, expectedAssignmentVersion: 1 };
        assert.equal(
          (
            await query(
              "SELECT count(*)::int n FROM staff_notification_intents WHERE acknowledged_at IS NOT NULL",
            )
          )[0].n,
          0,
        );
        const wrong = randomUUID();
        await query("INSERT INTO staff_users(id) VALUES($1)", [wrong]);
        await query("INSERT INTO staff_roles VALUES($1,'manager')", [wrong]);
        await assert.rejects(
          acknowledgeStaffAssignment(input, { staffId: wrong, roles: ["manager"] }, ports),
          (e) => e.status === 409,
        );
        await assert.rejects(
          acknowledgeStaffAssignment(input, { staffId: staff, roles: ["viewer"] }, ports),
          (e) => e.status === 403,
        );
        await assert.rejects(
          acknowledgeStaffAssignment({ ...input, expectedAssignmentVersion: 9 }, actor, ports),
          (e) => e.status === 409,
        );
        const results = await Promise.all(
          Array.from({ length: 4 }, () => acknowledgeStaffAssignment(input, actor, ports)),
        );
        assert.equal(new Set(results.map((x) => x.acknowledgedAt)).size, 1);
        await requestStaffAssignmentHelp({ ...input, reason: "Synthetic help" }, actor, ports);
        assert.equal(
          (
            await query(
              "SELECT count(*)::int n FROM inquiries WHERE first_human_response_at IS NOT NULL",
            )
          )[0].n,
          0,
        );
        assert.equal(
          (await query("SELECT count(*)::int n FROM whatsapp_human_response_evidence"))[0].n,
          0,
        );
        await query("UPDATE staff_users SET active=false WHERE id=$1", [wrong]);
        await assert.rejects(
          listMyStaffNotifications({}, { staffId: wrong, roles: ["manager"] }, query),
          (e) => e.status === 403,
        );
      },
    );
    await t.test(
      "NT-16/26 signed staff receipts/replies are isolated before customer intake",
      async () => {
        const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
        const { normalizeWoztellEvent } = await import("../woztell/woztell.server.ts");
        const { isolateSignedStaffEvent } = await import("./staff-event-isolation.server.ts");
        const [n] = await query("SELECT id FROM staff_notification_intents LIMIT 1");
        const [ep] = await query(
          "INSERT INTO staff_notification_endpoints(staff_id,transport,channel_id,destination_reference) VALUES($1,'staff_whatsapp','fixture','staff-device') RETURNING id",
          [staff],
        );
        await query(
          "INSERT INTO staff_notification_attempts(notification_id,transport,endpoint_id,endpoint_version,attempt_key,dispatch_state,provider_operation_id) VALUES($1,'staff_whatsapp',$2,1,'synthetic-attempt','accepted','staff-operation')",
          [n.id, ep.id],
        );
        const before = (await query("SELECT count(*)::int n FROM inquiries"))[0].n;
        const receipt = normalizeWoztellEvent({
          type: "DELIVERED",
          messageId: "staff-operation",
          channel: "fixture",
          member: "staff-device",
          app: "fixture-app",
          timestamp: Date.now() / 1000,
        });
        assert.equal(
          (
            await ingestWoztellEvent(receipt, "live_webhook", tx, {
              signedEvent: true,
              mode: "off",
            })
          ).skipped,
          "staff-internal",
        );
        const reply = normalizeWoztellEvent({
          type: "TEXT",
          messageId: "staff-reply",
          channel: "fixture",
          member: "staff-device",
          app: "fixture-app",
          timestamp: Date.now() / 1000,
          data: { text: "OK" },
        });
        assert.equal(
          (await ingestWoztellEvent(reply, "live_webhook", tx, { signedEvent: true, mode: "off" }))
            .skipped,
          "staff-internal",
        );
        assert.equal(
          (
            await query(
              "SELECT count(*)::int n FROM staff_notification_internal_events WHERE association_state='review'",
            )
          )[0].n,
          1,
        );
        assert.equal((await query("SELECT count(*)::int n FROM inquiries"))[0].n, before);
        assert.equal(
          (await query("SELECT count(*)::int n FROM whatsapp_human_response_evidence"))[0].n,
          0,
        );
        assert.equal(
          (
            await query(
              "SELECT dispatch_state FROM staff_notification_attempts WHERE attempt_key='synthetic-attempt'",
            )
          )[0].dispatch_state,
          "delivered",
        );
        process.env.EP_WA_STAFF_REPLY_CONTEXT_PATH = "context.replyTo";
        process.env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF = "SYNTHETIC";
        await query(
          "UPDATE staff_notification_endpoints SET enabled=true,verified_at=now(),verification_ref='SYNTHETIC',permission_granted=true,permission_ref='SYNTHETIC' WHERE id=$1",
          [ep.id],
        );
        // Separate current-version attempt for verified inbound-window evidence.
        await query(
          "INSERT INTO staff_notification_attempts(notification_id,transport,endpoint_id,endpoint_version,attempt_generation,attempt_key,dispatch_state,provider_operation_id) SELECT $1,'staff_whatsapp',id,version,2,'window-attempt','accepted','staff-window-operation' FROM staff_notification_endpoints WHERE id=$2",
          [n.id, ep.id],
        );
        reply.externalMessageId = "staff-correlated-reply";
        reply.payload.context = { replyTo: "staff-window-operation" };
        assert.equal(await isolateSignedStaffEvent(reply, tx), true);
        assert.ok(
          (
            await query("SELECT last_inbound_at FROM staff_notification_endpoints WHERE id=$1", [
              ep.id,
            ])
          )[0].last_inbound_at,
        );
        assert.equal(
          (await query("SELECT count(*)::int n FROM whatsapp_human_response_evidence"))[0].n,
          0,
        );

        await query(
          "INSERT INTO whatsapp_messages(id,channel_id,woztell_member_id,direction,external_message_id) VALUES($1,'fixture','staff-device','outbound','customer-context')",
          [randomUUID()],
        );
        reply.payload.context = { replyTo: "customer-context" };
        assert.equal(await isolateSignedStaffEvent(reply, tx), false);
        const prop = randomUUID(),
          link = randomUUID(),
          ref = "R".repeat(32);
        await query("INSERT INTO properties(id) VALUES($1)", [prop]);
        await query(
          "INSERT INTO whatsapp_tracking_links(id,code) VALUES($1,'syntheticlink123456')",
          [link],
        );
        await query(
          "INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type,property_id,public_listing_no,deal_type,enabled,placement_verified_at) VALUES($1,1,'fixture','website','sales',$2,'SYNTHETIC','sale',true,now())",
          [link, prop],
        );
        await query(
          "INSERT INTO whatsapp_link_opens(reference_hash,link_id,link_version,channel_id,context_snapshot) VALUES($1,$2,1,'fixture',$3::jsonb)",
          [
            createHash("sha256").update(ref).digest("hex"),
            link,
            JSON.stringify({ propertyId: prop }),
          ],
        );
        delete reply.payload.context;
        reply.text = "Property enquiry EPWA:" + ref;
        assert.equal(await isolateSignedStaffEvent(reply, tx), false);
        delete process.env.EP_WA_STAFF_REPLY_CONTEXT_PATH;
        delete process.env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF;
      },
    );

    await t.test(
      "NT-12/17/18 current endpoint version and STAFF window are enforced at dispatch",
      async () => {
        const { dispatchStaffNotification } = await import("./staff-notifications.server.ts");
        const x = await enquiry();
        const [n] = await query("SELECT id FROM staff_notification_intents WHERE inquiry_id=$1", [
          x.inquiry,
        ]);
        const [job] = await query("SELECT id FROM ops_jobs WHERE payload->>'notificationId'=$1", [
          n.id,
        ]);
        await tx([
          {
            statement:
              "SELECT set_config('app.wa_worker_capabilities','[\"woztell.enquiry.staff.notify@1\"]',true)",
          },
          {
            statement:
              "UPDATE ops_jobs SET status='running',lease_owner='fixture',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
            params: [job.id],
          },
        ]);
        await query(
          "UPDATE staff_notification_endpoints SET enabled=true,verified_at=now(),verification_ref='SYNTHETIC',permission_granted=true,permission_ref='SYNTHETIC',last_inbound_at=now()-interval '25 hours',quiet_hours_policy='{\"approved\":true,\"allowAllHours\":true}' WHERE transport='staff_whatsapp'",
        );
        const runtime = {
          enabled: true,
          generationId: generation,
          channelId: "fixture",
          staffWhatsAppEnabled: true,
          ackEscalationEnabled: false,
        };
        let sends = 0;
        const adapter = {
          verificationRef: "SYNTHETIC",
          postPrivateNote: async () => ({ state: "accepted", evidenceKind: "private_note_posted" }),
          sendStaffWhatsApp: async () => {
            sends++;
            return { state: "accepted" };
          },
        };
        await dispatchStaffNotification(
          n.id,
          { checkpoint: async () => {}, job: { jobId: job.id, workerId: "fixture" } },
          { query, transaction: tx },
          runtime,
          adapter,
        );
        assert.equal(sends, 0);
        assert.equal(
          (
            await query(
              "SELECT dispatch_state FROM staff_notification_attempts WHERE notification_id=$1 AND transport='staff_whatsapp'",
              [n.id],
            )
          )[0].dispatch_state,
          "suppressed",
        );
        const [ep] = await query(
          "SELECT * FROM staff_notification_endpoints WHERE transport='staff_whatsapp'",
        );
        await query(
          "UPDATE staff_notification_endpoints SET destination_reference='different-staff-device' WHERE id=$1",
          [ep.id],
        );
        assert.equal(
          (await query("SELECT version FROM staff_notification_endpoints WHERE id=$1", [ep.id]))[0]
            .version,
          ep.version + 1,
        );
        const [historic] = await query(
          "SELECT destination_reference_snapshot FROM staff_notification_attempts WHERE attempt_key='synthetic-attempt'",
        );
        assert.equal(historic.destination_reference_snapshot, "staff-device");
      },
    );
    await t.test(
      "NT-24 customer reply resolves work; acknowledgement cannot reopen it",
      async () => {
        const { acknowledgeStaffAssignment } =
          await import("../neon/staff-notifications.server.ts");
        const [n] = await query(
          "SELECT * FROM staff_notification_intents WHERE work_state='pending' LIMIT 1",
        );
        await query("UPDATE inquiries SET first_human_response_at=now() WHERE id=$1", [
          n.inquiry_id,
        ]);
        assert.equal(
          (
            await query("SELECT resolution_reason FROM staff_notification_intents WHERE id=$1", [
              n.id,
            ])
          )[0].resolution_reason,
          "resolved_by_customer_reply",
        );
        await assert.rejects(
          acknowledgeStaffAssignment(
            { notificationId: n.id, expectedAssignmentVersion: 1 },
            { staffId: staff, roles: ["agent"] },
            { query, transaction: tx },
          ),
          (e) => e.status === 409,
        );
      },
    );
    await t.test("NT-09 protected B retains requested A and explicit mismatch reason", async () => {
      const b = randomUUID();
      await query("INSERT INTO staff_users(id) VALUES($1)", [b]);
      await query("INSERT INTO staff_roles VALUES($1,'agent')", [b]);
      await query(
        "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at) VALUES($1,'fixture','agentB','folder','nodeB',true,'SYNTHETIC',now())",
        [b],
      );
      const x = await enquiry();
      const [r] = await query(
        "INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,version,reason,state,evidence) VALUES($1,$2,2,'manager','confirmed',jsonb_build_object('authoritative',true)) RETURNING id",
        [conv, b],
      );
      await tx([
        { statement: "SELECT set_config('app.wa_confirm_assignment','true',true)" },
        {
          statement:
            "UPDATE whatsapp_conversations SET assignment_lock=true,assignment_version=2,pending_assignment_id=$3,confirmed_staff_id=$2,assigned_agent_id=$2 WHERE id=$1",
          params: [conv, b, r.id],
        },
      ]);
      const [n] = await query(
        "SELECT * FROM staff_notification_intents WHERE inquiry_id=$1 AND assignment_version=2",
        [x.inquiry],
      );
      assert.equal(n.recipient_staff_id, b);
      assert.equal(n.requested_staff_id_snapshot, staff);
      assert.equal(n.mismatch_reason, "protected_assignment");
      await assert.rejects(
        query("UPDATE staff_notification_intents SET recipient_staff_id=$2 WHERE id=$1", [
          n.id,
          staff,
        ]),
        /IMMUTABLE/,
      );
    });

    await t.test(
      "NT-12/18/22 endpoint admin enforces manager permission and stale version",
      async () => {
        const { saveStaffEndpoint } = await import("../neon/staff-endpoints.server.ts");
        const manager = randomUUID();
        await query("INSERT INTO staff_users(id) VALUES($1)", [manager]);
        await query("INSERT INTO staff_roles VALUES($1,'manager')", [manager]);
        const actor = { staffId: manager, roles: ["manager"] };
        const ports = { query, transaction: tx };
        const [ep] = await query(
          "SELECT * FROM staff_notification_endpoints WHERE transport='staff_whatsapp'",
        );
        const input = {
          id: ep.id,
          expectedVersion: ep.version,
          staffId: staff,
          transport: "staff_whatsapp",
          channelId: "fixture",
          destinationReference: "verified-device",
          verificationRef: "SYNTHETIC",
          permissionRef: "SYNTHETIC",
          allowAllHours: false,
          enabled: false,
        };
        await query("UPDATE staff_notification_endpoints SET last_inbound_at=now() WHERE id=$1", [
          ep.id,
        ]);
        await assert.rejects(
          saveStaffEndpoint(input, { staffId: staff, roles: ["agent"] }, ports),
          (e) => e.status === 403,
        );
        const result = await saveStaffEndpoint(input, actor, ports);
        assert.equal(result.version, ep.version + 1);
        assert.equal(
          (
            await query("SELECT last_inbound_at FROM staff_notification_endpoints WHERE id=$1", [
              ep.id,
            ])
          )[0].last_inbound_at,
          null,
        );
        await assert.rejects(saveStaffEndpoint(input, actor, ports), (e) => e.status === 409);
      },
    );

    await t.test(
      "NT-14/24 closed enquiries, retired mappings and ended generation reject ack/help",
      async () => {
        const { acknowledgeStaffAssignment, requestStaffAssignmentHelp } =
          await import("../neon/staff-notifications.server.ts");
        const [n] = await query(
          "SELECT n.* FROM staff_notification_intents n JOIN whatsapp_conversations w ON w.id=n.conversation_id WHERE n.assignment_version=w.assignment_version AND n.work_state='pending' LIMIT 1",
        );
        const input = {
            notificationId: n.id,
            expectedAssignmentVersion: Number(n.assignment_version),
          },
          actor = { staffId: n.recipient_staff_id, roles: ["agent"] },
          ports = { query, transaction: tx };
        await query("UPDATE inquiries SET status='spam' WHERE id=$1", [n.inquiry_id]);
        await assert.rejects(
          acknowledgeStaffAssignment(input, actor, ports),
          (e) => e.status === 409,
        );
        await assert.rejects(
          requestStaffAssignmentHelp({ ...input, reason: "Synthetic" }, actor, ports),
          (e) => e.status === 409,
        );
        await query("UPDATE inquiries SET status='new' WHERE id=$1", [n.inquiry_id]);
        await query("UPDATE whatsapp_staff_channels SET eligible=false WHERE staff_id=$1", [
          n.recipient_staff_id,
        ]);
        await assert.rejects(
          acknowledgeStaffAssignment(input, actor, ports),
          (e) => e.status === 409,
        );
        await query("UPDATE whatsapp_staff_channels SET eligible=true WHERE staff_id=$1", [
          n.recipient_staff_id,
        ]);
        await query("UPDATE whatsapp_enquiry_activations SET ended_at=now() WHERE id=$1", [
          generation,
        ]);
        await assert.rejects(
          acknowledgeStaffAssignment(input, actor, ports),
          (e) => e.status === 409,
        );
        await query("UPDATE whatsapp_enquiry_activations SET ended_at=NULL WHERE id=$1", [
          generation,
        ]);
      },
    );
    await t.test(
      "NT-13/14 request handler resolves authenticated session through production SQL",
      async () => {
        const { handleStaffNotificationRequest } =
          await import("../neon/staff-notification-handlers.server.ts");
        const { createStaffAccessResolver } = await import("../neon/auth.server.ts");
        const [n] = await query(
          "SELECT n.* FROM staff_notification_intents n JOIN whatsapp_conversations w ON w.id=n.conversation_id WHERE n.assignment_version=w.assignment_version AND n.work_state='pending' LIMIT 1",
        );
        await query(
          "UPDATE staff_users SET auth_user_id='synthetic-auth',email='staff@example.invalid' WHERE id=$1",
          [n.recipient_staff_id],
        );
        const resolver = createStaffAccessResolver({
          queryRows: query,
          transactionRows: tx,
          getSession: async (request) =>
            request.headers.get("authorization") === "Bearer synthetic-session"
              ? {
                  user: { id: "synthetic-auth", email: "staff@example.invalid", name: "Synthetic" },
                  session: { token: "synthetic-session" },
                }
              : null,
        });
        const deps = { requireStaffAccess: resolver.requireStaffAccess, query, transaction: tx };
        const input = {
          notificationId: n.id,
          expectedAssignmentVersion: Number(n.assignment_version),
        };
        const request = (method, auth = true) =>
          new Request("https://earnest.test/admin/whatsapp", {
            method,
            headers: auth ? { authorization: "Bearer synthetic-session" } : {},
          });
        for (const method of ["GET", "HEAD"])
          await assert.rejects(
            handleStaffNotificationRequest(request(method), "ack", input, deps),
            (e) => e.status === 405,
          );
        await assert.rejects(
          handleStaffNotificationRequest(request("POST", false), "ack", input, deps),
          (e) => e.status === 401,
        );
        await assert.rejects(
          handleStaffNotificationRequest(
            request("POST"),
            "ack",
            { ...input, staffId: staff },
            deps,
          ),
        );
        const list = await handleStaffNotificationRequest(request("GET"), "list", {}, deps);
        assert.ok(list.items.length > 0);
        assert.equal(
          (
            await query("SELECT acknowledged_at FROM staff_notification_intents WHERE id=$1", [
              n.id,
            ])
          )[0].acknowledged_at,
          null,
        );
        const acknowledged = await handleStaffNotificationRequest(
          request("POST"),
          "ack",
          input,
          deps,
        );
        assert.equal(acknowledged.ok, true);
        await query("UPDATE staff_users SET active=false WHERE id=$1", [n.recipient_staff_id]);
        await assert.rejects(
          handleStaffNotificationRequest(request("GET"), "list", {}, deps),
          (e) => e.status === 403,
        );
      },
    );

    await t.test(
      "NT-01/04/11 fresh requested assignment and notification failure roll back confirmation atomically",
      async () => {
        const { executeAssignment, reconcileAssignment } = await import("./assignment.server.ts");
        await tx([
          { statement: "SELECT set_config('app.wa_confirm_assignment','true',true)" },
          {
            statement:
              "UPDATE whatsapp_conversations SET confirmed_staff_id=NULL,assigned_agent_id=NULL,pending_assignment_id=NULL,assignment_lock=false,assignment_version=3 WHERE id=$1",
            params: [conv],
          },
        ]);
        await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff]);
        await query("INSERT INTO staff_roles VALUES($1,'viewer')", [staff]);
        await enquiry(true, true);
        assert.equal(
          (
            await query("SELECT pending_assignment_id FROM whatsapp_conversations WHERE id=$1", [
              conv,
            ])
          )[0].pending_assignment_id,
          null,
        );
        await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff]);
        await query("INSERT INTO staff_roles VALUES($1,'agent')", [staff]);
        const x = await enquiry(true, true);
        const [r] = await query(
          "SELECT r.* FROM whatsapp_assignment_requests r JOIN whatsapp_conversations w ON w.pending_assignment_id=r.id WHERE w.id=$1",
          [conv],
        );
        assert.equal(r.desired_staff_id, staff);
        assert.equal(r.reason, "requested_staff");
        assert.equal(
          (
            await query(
              "SELECT count(*)::int n FROM ops_jobs WHERE job_type='woztell.enquiry.assign' AND payload->>'requestId'=$1",
              [r.id],
            )
          )[0].n,
          1,
        );
        const provider = {
          execute: async () => ({ accepted: true }),
          readAuthoritativeAssignment: async () => ({ inboxUserId: "agent", folderId: "folder" }),
        };
        await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff]);
        assert.equal(
          (await executeAssignment(r.id, provider, { query, transaction: tx })).state,
          "blocked",
        );
        await query("INSERT INTO staff_roles VALUES($1,'agent')", [staff]);
        await executeAssignment(r.id, provider, { query, transaction: tx });
        await query(
          "CREATE FUNCTION synthetic_job_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.job_type='woztell.enquiry.staff.notify' THEN RAISE EXCEPTION 'SYNTHETIC_JOB_FAILURE'; END IF; RETURN NEW; END $$",
        );
        await query(
          "CREATE TRIGGER synthetic_job_failure BEFORE INSERT ON ops_jobs FOR EACH ROW EXECUTE FUNCTION synthetic_job_failure()",
        );
        await assert.rejects(
          reconcileAssignment(r.id, provider, { query, transaction: tx }),
          /SYNTHETIC_JOB_FAILURE/,
        );
        assert.equal(
          (
            await query("SELECT confirmed_staff_id FROM whatsapp_conversations WHERE id=$1", [conv])
          )[0].confirmed_staff_id,
          null,
        );
        assert.equal(
          (await query("SELECT state FROM whatsapp_assignment_requests WHERE id=$1", [r.id]))[0]
            .state,
          "unknown",
        );
        await query("DROP TRIGGER synthetic_job_failure ON ops_jobs");
        assert.equal(
          (await reconcileAssignment(r.id, provider, { query, transaction: tx })).confirmed,
          true,
        );
        const [n] = await query(
          "SELECT * FROM staff_notification_intents WHERE inquiry_id=$1 AND assignment_version=4",
          [x.inquiry],
        );
        assert.equal(n.recipient_staff_id, staff);
      },
    );
    await t.test(
      "NT-25 manager attention/health sees unresolved help and unapproved reminders stay inactive",
      async () => {
        const { listStaffAttention, listStaffEventReview } =
          await import("../neon/staff-endpoints.server.ts");
        const { getStaffNotificationHealth, checkStaffAcknowledgement } =
          await import("./staff-notifications.server.ts");
        const [m] = await query(
          "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.active AND r.role='manager' LIMIT 1",
        );
        const actor = { staffId: m.id, roles: ["manager"] };
        assert.ok(Array.isArray(await listStaffAttention(actor, query)));
        const reviews = await listStaffEventReview(actor, query);
        assert.ok(reviews.some((r) => r.text === "OK"));
        assert.ok(reviews.every((r) => !("protected_payload" in r)));
        await assert.rejects(
          listStaffEventReview({ staffId: staff, roles: ["agent"] }, query),
          (e) => e.status === 403,
        );
        assert.equal((await getStaffNotificationHealth(actor, query)).schemaAvailable, true);
        const [n] = await query(
          "SELECT id FROM staff_notification_intents WHERE work_state='pending' LIMIT 1",
        );
        assert.equal((await checkStaffAcknowledgement(n.id, query)).reminders, 0);
        await assert.rejects(
          listStaffAttention({ staffId: staff, roles: ["agent"] }, query),
          (e) => e.status === 403,
        );
      },
    );

    await t.test(
      "NT-12 forced endpoint edit and attempt conflict never sends cached old destination",
      { timeout: 15000 },
      async () => {
        const { dispatchStaffNotification } = await import("./staff-notifications.server.ts");
        const x = await enquiry();
        const [n] = await query(
          "SELECT id FROM staff_notification_intents WHERE inquiry_id=$1 AND assignment_version=4",
          [x.inquiry],
        );
        const [job] = await query(
          "SELECT id FROM ops_jobs WHERE job_type='woztell.enquiry.staff.notify' AND payload->>'notificationId'=$1",
          [n.id],
        );
        await tx([
          {
            statement:
              "SELECT set_config('app.wa_worker_capabilities','[\"woztell.enquiry.staff.notify@1\"]',true)",
          },
          {
            statement:
              "UPDATE ops_jobs SET status='running',lease_owner='fixture',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
            params: [job.id],
          },
        ]);
        await query(
          "UPDATE staff_notification_endpoints SET destination_reference='race-old',enabled=true,last_inbound_at=now(),quiet_hours_policy='{\"approved\":true,\"allowAllHours\":true}' WHERE transport='staff_whatsapp'",
        );
        const aRead = Promise.withResolvers(),
          aRelease = Promise.withResolvers(),
          bPrepared = Promise.withResolvers(),
          bRelease = Promise.withResolvers();
        let aPaused = false,
          bPaused = false;
        const sent = [];
        const runtime = {
          enabled: true,
          generationId: generation,
          channelId: "fixture",
          staffWhatsAppEnabled: true,
          ackEscalationEnabled: false,
        };
        const options = { checkpoint: async () => {}, job: { jobId: job.id, workerId: "fixture" } };
        const adapter = {
          verificationRef: "SYNTHETIC",
          postPrivateNote: async () => ({ state: "accepted", evidenceKind: "private_note_posted" }),
          sendStaffWhatsApp: async (scope) => {
            sent.push(scope.memberId);
            return { state: "accepted", providerOperationId: "race-operation" };
          },
        };
        const queryA = async (sql, params = []) => {
          const rows = await query(sql, params);
          if (
            !aPaused &&
            sql.startsWith("SELECT * FROM staff_notification_endpoints WHERE staff_id=") &&
            params[2] === "staff_whatsapp"
          ) {
            aPaused = true;
            aRead.resolve();
            await aRelease.promise;
          }
          return rows;
        };
        const queryB = async (sql, params = []) => {
          const rows = await query(sql, params);
          if (
            !bPaused &&
            sql.startsWith("SELECT * FROM staff_notification_attempts WHERE notification_id=") &&
            params[1] === "staff_whatsapp"
          ) {
            bPaused = true;
            bPrepared.resolve();
            await bRelease.promise;
          }
          return rows;
        };
        const workerA = dispatchStaffNotification(
          n.id,
          options,
          { query: queryA, transaction: tx },
          runtime,
          adapter,
        );
        await aRead.promise;
        await query(
          "UPDATE staff_notification_endpoints SET destination_reference='race-new' WHERE transport='staff_whatsapp'",
        );
        const workerB = dispatchStaffNotification(
          n.id,
          options,
          { query: queryB, transaction: tx },
          runtime,
          adapter,
        );
        await bPrepared.promise;
        aRelease.resolve();
        await workerA;
        bRelease.resolve();
        await workerB;
        assert.deepEqual(sent, ["race-new"]);
      },
    );

    await t.test(
      "NT-19 Inbox readback failure before POST is suppressed, not unknown",
      async () => {
        const { dispatchStaffNotification } = await import("./staff-notifications.server.ts");
        const { createInboxApi } = await import("../woztell/inbox-api.server.ts");
        const x = await enquiry();
        const [n] = await query(
          "SELECT id FROM staff_notification_intents WHERE inquiry_id=$1 AND assignment_version=4",
          [x.inquiry],
        );
        const [job] = await query(
          "SELECT id FROM ops_jobs WHERE job_type='woztell.enquiry.staff.notify' AND payload->>'notificationId'=$1",
          [n.id],
        );
        await tx([
          {
            statement:
              "SELECT set_config('app.wa_worker_capabilities','[\"woztell.enquiry.staff.notify@1\"]',true)",
          },
          {
            statement:
              "UPDATE ops_jobs SET status='running',lease_owner='fixture',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
            params: [job.id],
          },
        ]);
        let posts = 0;
        const base = "https://api.inbox.woztell.sanuker.com/v1.0/";
        const adapter = createInboxApi(
          {
            verificationRef: "SYNTHETIC",
            appId: "fixture-app",
            appIntegrationId: "synthetic",
            signature: "synthetic",
            channelId: "fixture",
            listThreadsUrl: base + "api/list-threads",
            listUsersUrl: base + "api/list-users",
            assignUrl: base + "update-thread-agent",
            internalMessageUrl: base + "internal-message",
          },
          async (_url, init) => {
            if (init.method === "POST") posts++;
            return new Response(JSON.stringify({ ok: 1, data: [] }));
          },
        );
        await dispatchStaffNotification(
          n.id,
          { checkpoint: async () => {}, job: { jobId: job.id, workerId: "fixture" } },
          { query, transaction: tx },
          {
            enabled: true,
            generationId: generation,
            channelId: "fixture",
            staffWhatsAppEnabled: false,
            ackEscalationEnabled: false,
          },
          adapter,
        );
        assert.equal(posts, 0);
        assert.equal(
          (
            await query(
              "SELECT dispatch_state FROM staff_notification_attempts WHERE notification_id=$1",
              [n.id],
            )
          )[0].dispatch_state,
          "suppressed",
        );
      },
    );
    await t.test(
      "NT-10 approved fallback retains A request; no fallback is an attended exception",
      async () => {
        const b = randomUUID();
        await query("INSERT INTO staff_users(id) VALUES($1)", [b]);
        await query("INSERT INTO staff_roles VALUES($1,'agent')", [b]);
        await query(
          "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,verification_ref,verified_at) VALUES($1,'fixture','approved-fallback','folder','nodeF',true,'SYNTHETIC',now())",
          [b],
        );
        await query("UPDATE staff_users SET active=false WHERE id=$1", [staff]);
        const x = await enquiry();
        const [r] = await query(
          "INSERT INTO whatsapp_assignment_requests(conversation_id,desired_staff_id,version,reason,state,evidence) VALUES($1,$2,5,'approved_fallback','confirmed',jsonb_build_object('authoritative',true)) RETURNING id",
          [conv, b],
        );
        await tx([
          { statement: "SELECT set_config('app.wa_confirm_assignment','true',true)" },
          {
            statement:
              "UPDATE whatsapp_conversations SET assignment_lock=false,assignment_version=5,pending_assignment_id=$3,confirmed_staff_id=$2,assigned_agent_id=$2 WHERE id=$1",
            params: [conv, b, r.id],
          },
        ]);
        const [n] = await query(
          "SELECT * FROM staff_notification_intents WHERE inquiry_id=$1 AND assignment_version=5",
          [x.inquiry],
        );
        assert.equal(n.recipient_staff_id, b);
        assert.equal(n.requested_staff_id_snapshot, staff);
        assert.equal(n.mismatch_reason, "requested_staff_unavailable");
        await tx([
          { statement: "SELECT set_config('app.wa_confirm_assignment','true',true)" },
          {
            statement:
              "UPDATE whatsapp_conversations SET confirmed_staff_id=NULL,assigned_agent_id=NULL,pending_assignment_id=NULL,assignment_version=6 WHERE id=$1",
            params: [conv],
          },
        ]);
        const missing = await enquiry();
        const [exception] = await query(
          "SELECT * FROM staff_notification_routing_exceptions WHERE inquiry_id=$1",
          [missing.inquiry],
        );
        assert.equal(exception.reason, "handler_unverified");
        assert.equal(exception.attended_staff_id, null);
      },
    );
    await t.test(
      "NT-22/23 additive migration rerun preserves populated synthetic records",
      async () => {
        const before = await query(
          "SELECT id,recipient_staff_id,work_state,acknowledged_at FROM staff_notification_intents ORDER BY id",
        );
        await tx(
          splitSqlStatements(
            readFileSync("neon/migrations/20260912170000_staff_notifications.sql", "utf8"),
          ).map((statement) => ({ statement })),
        );
        assert.deepEqual(
          await query(
            "SELECT id,recipient_staff_id,work_state,acknowledged_at FROM staff_notification_intents ORDER BY id",
          ),
          before,
        );
      },
    );
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
});
