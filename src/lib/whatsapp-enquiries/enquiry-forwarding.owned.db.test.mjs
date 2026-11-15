import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { ENQUIRY_MANAGERS } from "./enquiry-routing.mjs";
import { persistWebsiteInquiry } from "../neon/website-inquiry.js";

const migration = "20261116000000_enquiry_forwarding.sql";
const versions = MIGRATION_VERSIONS.includes(migration)
  ? MIGRATION_VERSIONS
  : [...MIGRATION_VERSIONS, migration];
const template = {
  name: "owned_staff_enquiry",
  language: "zh_HK",
  params: ["name", "source", "phone", "link"],
};
const envKeys = [
  "VITE_SITE_URL",
  "WOZTELL_CHANNEL_ID",
  "EP_WA_COMPANY_CHANNEL_ID",
  "EP_WA_ENQUIRY_MODE",
  "EP_WA_STAFF_NOTIFICATIONS_ENABLED",
  "EP_WA_STAFF_CORRELATION_VERIFICATION_REF",
  "EP_WA_STAFF_REPLY_CONTEXT_PATH",
];
const recipientKeys = (rows) => rows.map((r) => r.routing_snapshot.recipientKey).sort();

test(
  "owned actual forwarding dispatch preserves one verified phone send per new enquiry recipient",
  { timeout: 120000 },
  async (t) => {
    const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("External requests forbidden in owned forwarding tests");
    });
    Object.assign(process.env, {
      VITE_SITE_URL: "https://owned-earnest.example.invalid",
      EP_WA_ENQUIRY_MODE: "observe",
      EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
      EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "owned-correlation-proof",
      EP_WA_STAFF_REPLY_CONTEXT_PATH: "context.replyTo",
    });
    try {
      await withOwnedPostgres(
        async ({ query, transaction }) => {
          await mockOwnedServerDb(mock, query, transaction);
          mock.module(new URL("../control-plane/job-wake.server.ts", import.meta.url).href, {
            exports: { wakeAfterCommit: () => {}, laneForJob: () => "general" },
          });
          const { createWebsiteInquiry } = await import("../neon/admin-data.server.ts");
          const { dispatchEnquiryForwarding } = await import("./enquiry-forwarding.server.ts");
          const { handleLeadStaffAlert } = await import("./lead-alert.server.ts");
          const { resolveEnquiryForwarding } = await import("./enquiry-routing.server.ts");
          const { isolateSignedStaffEvent } = await import("./staff-event-isolation.server.ts");
          const { observeEpisode } = await import("./episodes.server.ts");
          for (const manager of Object.values(ENQUIRY_MANAGERS))
            await query(
              "INSERT INTO staff_users(id,name_zh,active,show_on_website,phone) VALUES($1,'Owned photographed manager',true,true,$2) ON CONFLICT(id) DO NOTHING",
              [manager.staffId, manager.phone],
            );
          const rolesBefore = (await query("SELECT count(*)::int n FROM staff_roles"))[0].n;
          let serial = 0;
          async function scenario() {
            const n = ++serial,
              channel = `owned-forward-${n}`;
            process.env.WOZTELL_CHANNEL_ID = channel;
            process.env.EP_WA_COMPANY_CHANNEL_ID = channel;
            await query(
              "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,destination_type='recipient_id',destination_reference=phone,verified_at=now(),verification_ref='owned-provider-proof',permission_granted=true,permission_ref='owned-owner-approved-photo' WHERE recipient_key='copy'",
              [channel],
            );
            for (const manager of Object.values(ENQUIRY_MANAGERS))
              await query(
                "UPDATE enquiry_notification_recipients SET staff_id=$2,enabled=true,channel_id=$1,destination_type='recipient_id',destination_reference=phone,verified_at=now(),verification_ref='owned-provider-proof',permission_granted=true,permission_ref='owned-owner-approved-photo' WHERE recipient_key=$3",
                [channel, manager.staffId, manager.key],
              );
            const staff = [];
            for (const position of [1, 2]) {
              const staffId = randomUUID(),
                phone = `85291${String(n * 10 + position).padStart(6, "0")}`;
              await query(
                "INSERT INTO staff_users(id,name_zh,active,show_on_website,phone,whatsapp) VALUES($1,$2,true,true,$3,$3)",
                [staffId, `Owned Sales ${n}-${position}`, phone],
              );
              await query(
                "INSERT INTO enquiry_notification_recipients(recipient_key,kind,staff_id,phone,channel_id,destination_reference,enabled,verified_at,verification_ref,permission_granted,permission_ref) VALUES($1,'sales',$2,$3,$4,$3,true,now(),'owned-provider-proof',true,'owned-notification-permission')",
                [`sales:${staffId}`, staffId, phone, channel],
              );
              staff.push({ id: staffId, phone, position });
            }
            const propertyId = randomUUID(),
              listingNo = `A${800000 + n}`;
            await query(
              "INSERT INTO properties(id,listing_no,canonical_property_no,title_zh,deal_type,status,district_slug) VALUES($1,$2,$2,'Owned forwarding unit','sale','active','sham-tseng')",
              [propertyId, listingNo],
            );
            for (const agent of staff)
              await query(
                "INSERT INTO property_agents(property_id,position,staff_id,source) VALUES($1,$2,$3,'owned-fixture')",
                [propertyId, agent.position, agent.id],
              );
            const runtime = () => ({
              enabled: true,
              generationId: null,
              channelId: channel,
              template,
            });
            let customerSerial = 0;
            const intake = async (patch = {}) => {
              const phone = String(98800000 + n * 10 + ++customerSerial);
              const input = {
                submissionId: randomUUID(),
                name: "Owned customer",
                phone,
                normalizedPhone: `852${phone}`,
                email: null,
                message: "想約睇樓",
                listingNo: null,
                propertyId: null,
                consentWhatsapp: false,
                ...patch,
                property_id: patch.propertyId ?? null,
              };
              const inquiry = await createWebsiteInquiry(input);
              const lead = (
                await query(
                  "SELECT l.* FROM crm_leads l JOIN inquiries i ON i.crm_lead_id=l.id WHERE i.id=$1",
                  [inquiry.id],
                )
              )[0];
              assert.ok(lead, "actual intake retains a linked lead");
              return { source: "website", subjectId: lead.id, input, inquiry, lead };
            };
            const intakeWhatsapp = async () => {
              const contact = (
                await query(
                  "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('Owned inbound customer',$1,$1) RETURNING id",
                  [`852${98700000 + n}`],
                )
              )[0];
              const member = `owned-customer-member-${n}`;
              const conversation = (
                await query(
                  "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,assigned_agent_id,assignment_lock) VALUES($1,$2,$3,$4,true) RETURNING id",
                  [contact.id, channel, member, staff[0].id],
                )
              )[0];
              const external = `owned-inbound-${randomUUID()}`;
              const message = (
                await query(
                  "INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,channel_id,woztell_member_id,external_message_id) VALUES($1,$2,'inbound','text','想問豪景花園兩房租盤',$3,$4,$5) RETURNING id",
                  [conversation.id, contact.id, channel, member, external],
                )
              )[0];
              const event = randomUUID();
              await query(
                "INSERT INTO whatsapp_enquiry_events(id,dedupe_key,origin,app_id,channel_id,member_id,external_message_id,message_id,kind,occurred_at,received_at,timing,identity_quality,capture_mode,effects_eligible) VALUES($1,$2,'live_webhook','owned-app',$3,$4,$5,$6,'customer_message',now(),now(),'fresh','provider_id','observe',false)",
                [event, event.replaceAll("-", "").repeat(2), channel, member, external, message.id],
              );
              const inquiry = await observeEpisode(event, query);
              assert.ok(inquiry, "real observe intake creates a reviewable estate-only enquiry");
              return {
                source: "whatsapp",
                subjectId: inquiry,
                eventId: event,
                messageId: message.id,
                conversationId: conversation.id,
                contactId: contact.id,
              };
            };
            const lease = async (subject, workerId = `owned-worker-${n}`) => {
              const key = `enquiry-forward:${subject.source}:${subject.subjectId}`;
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1 AND job_type='woztell.enquiry.forward'",
                    [key],
                  )
                )[0].n,
                1,
                "actual intake atomically enqueued one forwarding job",
              );
              const result = await transaction([
                {
                  statement: "SELECT set_config('app.wa_worker_capabilities',$1,true)",
                  params: [JSON.stringify(["woztell.enquiry.forward@1"])],
                },
                {
                  statement:
                    "UPDATE ops_jobs SET status='running',lease_owner=$2,lease_expires_at=now()+interval '10 minutes',attempt_count=attempt_count+1 WHERE idempotency_key=$1 AND job_type='woztell.enquiry.forward' RETURNING id",
                  params: [key, workerId],
                },
              ]);
              const [job] = result[1];
              assert.ok(job, "only a worker advertising the exact forwarding capability can claim");
              return {
                jobId: job.id,
                workerId,
                checkpoint: async () => {
                  assert.equal(
                    (
                      await query(
                        "SELECT count(*)::int n FROM ops_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_expires_at>now()",
                        [job.id, workerId],
                      )
                    )[0].n,
                    1,
                  );
                },
              };
            };
            const attempts = (subject) =>
              query(
                `SELECT * FROM staff_notification_attempts WHERE ${subject.source === "website" ? "lead_id" : "forwarding_inquiry_id"}=$1 AND routing_snapshot->>'purpose'='enquiry_forward' ORDER BY id`,
                [subject.subjectId],
              );
            const provider = ({ hook, mode } = {}) => {
              const sends = [],
                preflights = [],
                boundaryErrors = [];
              return {
                sends,
                preflights,
                boundaryErrors,
                transport: {
                  verificationRef: "owned-mock-provider-capability",
                  sendStaffWhatsApp: async () => {
                    throw Error("Phone forwarding must never fabricate a member ID");
                  },
                  sendStaffWhatsAppByPhone: async (scope) => {
                    preflights.push(scope);
                    if (hook) await hook(scope);
                    try {
                      await scope.beforeSend();
                    } catch (error) {
                      boundaryErrors.push(error.message);
                      throw error;
                    }
                    sends.push(scope);
                    if (mode === "throw")
                      throw Error("Owned connection closed after possible provider acceptance");
                    if (mode === "unknown") return { state: "unknown" };
                    if (mode === "refuse" && scope.phone === staff[0].phone)
                      return { state: "failed" };
                    return {
                      state: "accepted",
                      evidenceKind: "provider_accepted",
                      providerOperationId: `owned-operation-${randomUUID()}`,
                    };
                  },
                },
              };
            };
            const dispatch = async (subject, p, context) =>
              dispatchEnquiryForwarding(
                { source: subject.source, subjectId: subject.subjectId },
                context ?? (await lease(subject)),
                { query, transaction, runtime, transport: () => p.transport },
              );
            return {
              n,
              channel,
              staff,
              propertyId,
              listingNo,
              runtime,
              intake,
              intakeWhatsapp,
              lease,
              attempts,
              provider,
              dispatch,
            };
          }
          await t.test(
            "activation never queues or revives an actual website intake created before cutover",
            async () => {
              const inquiry = await persistWebsiteInquiry(query, {
                submissionId: randomUUID(),
                name: "Owned historical customer",
                phone: "98601234",
                normalizedPhone: "85298601234",
                email: null,
                message: "想問豪景花園",
                propertyId: null,
                listingNo: null,
                consentWhatsapp: false,
              });
              const lead = (
                await query("SELECT crm_lead_id FROM inquiries WHERE id=$1", [inquiry.id])
              )[0].crm_lead_id;
              await scenario();
              assert.equal(
                (
                  await query("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
                    `enquiry-forward:website:${lead}`,
                  ])
                )[0].n,
                0,
              );
              assert.equal(
                (await query("SELECT enquiry_enqueue_forward('website',$1) AS job", [lead]))[0].job,
                null,
              );
              assert.equal(
                await resolveEnquiryForwarding(query, { source: "website", subjectId: lead }),
                null,
              );
            },
          );
          await t.test(
            "actual selected and primary property correspondents receive Sales plus copy with no manager or auth role grants",
            async () => {
              const s = await scenario();
              for (const selected of [true, false]) {
                const subject = await s.intake({
                  propertyId: s.propertyId,
                  listingNo: s.listingNo,
                  ...(selected ? { agentId: s.staff[1].id } : {}),
                });
                const p = s.provider(),
                  result = await s.dispatch(subject, p);
                assert.equal(
                  result.summary.accepted,
                  2,
                  JSON.stringify({ summary: result.summary, boundaryErrors: p.boundaryErrors }),
                );
                assert.deepEqual(
                  p.sends.map((x) => x.phone).sort(),
                  [s.staff[selected ? 1 : 0].phone, "85297987774"].sort(),
                );
                const rows = await s.attempts(subject);
                assert.deepEqual(
                  recipientKeys(rows),
                  ["copy", `sales:${s.staff[selected ? 1 : 0].id}`].sort(),
                );
                assert.ok(
                  rows.every(
                    (row) =>
                      row.routing_snapshot.destinationType === "recipient_id" &&
                      row.provider_accepted_at,
                  ),
                );
                const context = await s.lease(subject, "owned-retry");
                assert.equal((await s.dispatch(subject, p, context)).summary.alreadySent, 2);
                assert.equal(p.sends.length, 2);
                const replay = await createWebsiteInquiry(subject.input);
                assert.equal(replay.id, subject.inquiry.id);
                assert.equal(
                  (
                    await query("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
                      `enquiry-forward:website:${subject.subjectId}`,
                    ])
                  )[0].n,
                  1,
                );
              }
              assert.equal(
                (await query("SELECT count(*)::int n FROM staff_roles"))[0].n,
                rolesBefore,
              );
            },
          );
          await t.test(
            "estate-only reaches photographed manager and copy; general and invalid specific never broadcast managers",
            async () => {
              const s = await scenario();
              for (const [patch, expected] of [
                [{ message: "想問春和海景花園兩房租盤" }, ["85291005322", "85297987774"]],
                [{ message: "想問青山公路村屋" }, ["85297987774"]],
                [{ message: "想問豪景花園", propertyId: randomUUID() }, ["85297987774"]],
                [{ message: "想問豪景花園", propertyId: "not-a-property-id" }, ["85297987774"]],
                [{ message: "想問豪景花園", listingNo: "A999999" }, ["85297987774"]],
              ]) {
                const subject = await s.intake(patch),
                  p = s.provider();
                const result = await s.dispatch(subject, p);
                assert.equal(result.summary.accepted, expected.length);
                assert.deepEqual(p.sends.map((x) => x.phone).sort(), expected.sort());
                if (patch.propertyId || patch.listingNo)
                  assert.equal(
                    (await s.attempts(subject))[0].routing_snapshot.routingKind,
                    "review",
                  );
              }
            },
          );
          await t.test(
            "a missing Sales registry leaves visible blocked evidence while the copy still succeeds",
            async () => {
              const s = await scenario();
              await query("DELETE FROM enquiry_notification_recipients WHERE recipient_key=$1", [
                `sales:${s.staff[0].id}`,
              ]);
              const subject = await s.intake({ propertyId: s.propertyId }),
                p = s.provider(),
                result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 1);
              assert.equal(result.summary.blocked, 1);
              const rows = await s.attempts(subject);
              assert.equal(
                rows.find((r) => r.routing_snapshot.recipientKind === "sales").safe_error,
                "recipient_not_configured",
              );
              assert.deepEqual(
                p.sends.map((x) => x.phone),
                ["85297987774"],
              );
            },
          );
          await t.test(
            "one normalized phone shared by Sales and copy receives one frozen send",
            async () => {
              const s = await scenario();
              await query("UPDATE staff_users SET whatsapp='+852 9798 7774' WHERE id=$1", [
                s.staff[0].id,
              ]);
              const subject = await s.intake({ propertyId: s.propertyId }),
                p = s.provider();
              assert.equal((await s.dispatch(subject, p)).summary.accepted, 1);
              assert.deepEqual(
                p.sends.map((x) => x.phone),
                ["85297987774"],
              );
              assert.deepEqual(recipientKeys(await s.attempts(subject)), ["copy"]);
            },
          );
          for (const mode of ["unknown", "throw"])
            await t.test(
              `provider ${mode} is durable unknown and never automatically resent after a new lease`,
              async () => {
                const s = await scenario(),
                  subject = await s.intake(),
                  p = s.provider({ mode });
                assert.equal((await s.dispatch(subject, p)).summary.unknown, 1);
                assert.equal((await s.attempts(subject))[0].dispatch_state, "unknown");
                await s.dispatch(subject, p, await s.lease(subject, "owned-second-worker"));
                assert.equal(p.sends.length, 1);
              },
            );
          await t.test(
            "a crashed dispatch reservation becomes unknown after lease recovery and is never resent",
            async () => {
              const s = await scenario(),
                subject = await s.intake(),
                p = s.provider(),
                context = await s.lease(subject);
              await assert.rejects(() =>
                dispatchEnquiryForwarding(
                  { source: subject.source, subjectId: subject.subjectId },
                  context,
                  {
                    query,
                    transaction,
                    runtime: () => ({ ...s.runtime(), enabled: false }),
                    transport: () => p.transport,
                  },
                ),
              );
              const [attempt] = await s.attempts(subject);
              assert.equal(attempt.dispatch_state, "queued");
              await query(
                "UPDATE staff_notification_attempts SET dispatch_state='dispatching',job_id=$2,claim_id=$3,dispatch_started_at=now()-interval '20 minutes' WHERE id=$1",
                [attempt.id, context.jobId, randomUUID()],
              );
              await query(
                "UPDATE ops_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
                [context.jobId],
              );
              const result = await s.dispatch(
                subject,
                p,
                await s.lease(subject, "owned-recovered-worker"),
              );
              assert.equal(result.summary.unknown, 1);
              assert.equal((await s.attempts(subject))[0].dispatch_state, "unknown");
              assert.equal(p.sends.length, 0);
            },
          );
          await t.test(
            "a queued attempt cannot be claimed by a live lease for a different enquiry payload",
            async () => {
              const s = await scenario(),
                subject = await s.intake(),
                p = s.provider();
              const originalContext = await s.lease(subject);
              await assert.rejects(() =>
                dispatchEnquiryForwarding(
                  { source: subject.source, subjectId: subject.subjectId },
                  originalContext,
                  {
                    query,
                    transaction,
                    runtime: () => ({ ...s.runtime(), enabled: false }),
                    transport: () => p.transport,
                  },
                ),
              );
              assert.equal((await s.attempts(subject))[0].dispatch_state, "queued");
              const other = await s.intake({ message: "另一宗查詢" }),
                wrongContext = await s.lease(other, "owned-wrong-subject-worker");
              const frozenBefore = await s.attempts(subject);
              await assert.rejects(
                () => s.dispatch(subject, p, wrongContext),
                (error) => error.code === "JOB_OWNERSHIP_LOST",
              );
              assert.deepEqual(
                await s.attempts(subject),
                frozenBefore,
                "another enquiry lease cannot mutate the frozen attempt",
              );
              assert.equal(
                p.sends.length,
                0,
                "another enquiry job must not claim this frozen attempt",
              );
            },
          );
          await t.test(
            "a definitive refusal for Sales does not prevent the independent copy",
            async () => {
              const s = await scenario(),
                subject = await s.intake({ propertyId: s.propertyId }),
                p = s.provider({ mode: "refuse" });
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 1);
              assert.equal(result.summary.blocked, 1);
              assert.deepEqual((await s.attempts(subject)).map((r) => r.dispatch_state).sort(), [
                "accepted",
                "failed",
              ]);
            },
          );
          for (const change of ["version", "disable", "phone"])
            await t.test(`beforeSend rechecks ${change} changes after reservation`, async () => {
              const s = await scenario(),
                subject = await s.intake({ propertyId: s.propertyId });
              const p = s.provider({
                hook: async (scope) => {
                  if (scope.phone !== s.staff[0].phone) return;
                  if (change === "version")
                    await query(
                      "UPDATE enquiry_notification_recipients SET verification_ref=verification_ref||'-changed' WHERE recipient_key=$1",
                      [`sales:${s.staff[0].id}`],
                    );
                  if (change === "disable")
                    await query(
                      "UPDATE enquiry_notification_recipients SET enabled=false WHERE recipient_key=$1",
                      [`sales:${s.staff[0].id}`],
                    );
                  if (change === "phone") {
                    const replacement = `85292${String(s.n).padStart(6, "0")}`;
                    await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                      s.staff[0].id,
                      replacement,
                    ]);
                    await query(
                      "UPDATE enquiry_notification_recipients SET phone=$2,destination_reference=$2 WHERE recipient_key=$1",
                      [`sales:${s.staff[0].id}`, replacement],
                    );
                  }
                },
              });
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 1);
              assert.equal(result.summary.blocked, 1);
              assert.deepEqual(
                p.sends.map((x) => x.phone),
                ["85297987774"],
              );
              assert.equal(
                (await s.attempts(subject)).find(
                  (r) => r.routing_snapshot.recipientKind === "sales",
                ).dispatch_state,
                "suppressed",
              );
            });
          await t.test(
            "a route revision changing at the send boundary suppresses the frozen estate batch",
            async () => {
              const s = await scenario(),
                subject = await s.intake({ message: "想問豪景花園" });
              let changed = false;
              const p = s.provider({
                hook: async () => {
                  if (!changed) {
                    changed = true;
                    await query(
                      "UPDATE enquiry_estate_routes SET aliases=array_append(aliases,'Owned approved revision') WHERE label='豪景花園'",
                    );
                  }
                },
              });
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 0);
              assert.equal(result.summary.blocked, 2);
              assert.equal(p.sends.length, 0);
            },
          );
          await t.test(
            "actual fresh observe WhatsApp intake sends manager plus copy while preserving locks, consent and customer effects",
            async () => {
              const s = await scenario(),
                subject = await s.intakeWhatsapp(),
                p = s.provider();
              const result = await s.dispatch(subject, p);
              assert.equal(
                result.summary.accepted,
                2,
                JSON.stringify({ summary: result.summary, boundaryErrors: p.boundaryErrors }),
              );
              assert.deepEqual(p.sends.map((x) => x.phone).sort(), ["85266442444", "85297987774"]);
              const rows = await s.attempts(subject);
              assert.deepEqual(recipientKeys(rows), ["copy", "manager:1"]);
              assert.ok(
                rows.every(
                  (row) => row.forwarding_inquiry_id === subject.subjectId && row.lead_id === null,
                ),
              );
              assert.ok(
                p.sends.every((scope) =>
                  JSON.stringify(scope.template).includes(subject.conversationId),
                ),
              );
              assert.deepEqual(
                (
                  await query(
                    "SELECT assigned_agent_id,assignment_lock FROM whatsapp_conversations WHERE id=$1",
                    [subject.conversationId],
                  )
                )[0],
                { assigned_agent_id: s.staff[0].id, assignment_lock: true },
              );
              assert.equal(
                (
                  await query("SELECT effects_eligible FROM inquiries WHERE id=$1", [
                    subject.subjectId,
                  ])
                )[0].effects_eligible,
                false,
              );
              assert.equal(
                (
                  await query("SELECT opt_in_whatsapp FROM crm_contacts WHERE id=$1", [
                    subject.contactId,
                  ])
                )[0].opt_in_whatsapp,
                false,
              );
              assert.equal(await observeEpisode(subject.eventId, query), subject.subjectId);
              assert.equal(
                (
                  await query("SELECT count(*)::int n FROM ops_jobs WHERE idempotency_key=$1", [
                    `enquiry-forward:whatsapp:${subject.subjectId}`,
                  ])
                )[0].n,
                1,
              );
              await s.dispatch(subject, p, await s.lease(subject, "owned-wa-retry"));
              assert.equal(p.sends.length, 2);
            },
          );
          await t.test(
            "legacy lead-alert markers never duplicate a new-flow phone notification",
            async () => {
              const s = await scenario(),
                subject = await s.intake({ propertyId: s.propertyId }),
                p = s.provider();
              await s.dispatch(subject, p);
              const result = await handleLeadStaffAlert(
                { leadId: subject.subjectId },
                await s.lease(subject),
                { query, transaction, runtime: s.runtime, transport: () => p.transport },
              );
              assert.deepEqual(result.summary, { accepted: 0, unknown: 0, blocked: 0 });
              assert.equal(p.sends.length, 2);
            },
          );
          await t.test(
            "signed phone receipts with opaque member IDs correlate, and known staff replies never create CRM loops",
            async () => {
              const s = await scenario(),
                subject = await s.intake(),
                p = s.provider();
              await s.dispatch(subject, p);
              const attempt = (await s.attempts(subject))[0];
              const counts = async () =>
                (
                  await query(
                    "SELECT (SELECT count(*) FROM crm_contacts)::int contacts,(SELECT count(*) FROM crm_leads)::int leads,(SELECT count(*) FROM inquiries)::int inquiries,(SELECT count(*) FROM whatsapp_enquiry_events)::int events",
                  )
                )[0];
              const before = await counts();
              const receipt = {
                appId: "owned-app",
                channelId: s.channel,
                woztellMemberId: "opaque-woztell-member-1",
                externalMessageId: attempt.provider_operation_id,
                legacyExternalMessageId: null,
                messageType: "DELIVERED",
                fromPhone: null,
                toPhone: null,
                text: null,
                payload: { type: "DELIVERED", timestamp: Math.floor(Date.now() / 1000) },
              };
              assert.equal(await isolateSignedStaffEvent(receipt, transaction), true);
              assert.equal((await s.attempts(subject))[0].dispatch_state, "delivered");
              const reply = {
                ...receipt,
                externalMessageId: `owned-reply-${randomUUID()}`,
                messageType: "TEXT",
                fromPhone: "+852 9798 7774",
                text: "收到",
                payload: { type: "TEXT", timestamp: Math.floor(Date.now() / 1000) },
              };
              assert.equal(await isolateSignedStaffEvent(reply, transaction), true);
              assert.deepEqual(await counts(), before);
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM staff_notification_internal_events WHERE channel_id=$1",
                    [s.channel],
                  )
                )[0].n,
                2,
              );
              await s.dispatch(subject, p, await s.lease(subject, "receipt-retry"));
              assert.equal(p.sends.length, 1);
            },
          );
          await t.test(
            "normalized customer phone and member destinations cannot receive private Sales notifications",
            async () => {
              for (const by of ["phone", "member"]) {
                const s = await scenario();
                const subject = await s.intake({
                  propertyId: s.propertyId,
                  ...(by === "phone"
                    ? { phone: s.staff[0].phone, normalizedPhone: s.staff[0].phone }
                    : {}),
                });
                if (by === "member")
                  await query(
                    "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id) VALUES($1,$2,$3)",
                    [
                      subject.lead.contact_id,
                      s.channel,
                      `+852 ${s.staff[0].phone.slice(3, 7)} ${s.staff[0].phone.slice(7)}`,
                    ],
                  );
                const p = s.provider(),
                  result = await s.dispatch(subject, p);
                assert.equal(result.summary.accepted, 1);
                assert.equal(result.summary.blocked, 1);
                assert.deepEqual(
                  p.sends.map((x) => x.phone),
                  ["85297987774"],
                );
                assert.equal(
                  (await s.attempts(subject)).find(
                    (r) => r.routing_snapshot.recipientKind === "sales",
                  ).safe_error,
                  "destination_is_customer",
                );
              }
            },
          );
          assert.equal(network.mock.calls.length, 0);
          assert.equal((await query("SELECT count(*)::int n FROM staff_roles"))[0].n, rolesBefore);
        },
        { migrationVersions: versions },
      );
    } finally {
      network.mock.restore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
