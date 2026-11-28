import { seedOwnedEnquiryCopy } from "../../../scripts/acceptance/owned-enquiry-copy.mjs";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SOURCE_28HSE } from "../mls/source-contract.mjs";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { ENQUIRY_MANAGERS } from "./enquiry-routing.mjs";
import { persistWebsiteInquiry } from "../neon/website-inquiry.js";
import { deriveEnquiryInfoReadiness } from "./enquiry-info-readiness.js";

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
  "VITE_CONTACT_WHATSAPP_PHONE",
  "WOZTELL_APP_ID",
  "VERCEL_GIT_COMMIT_SHA",
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
      VITE_CONTACT_WHATSAPP_PHONE: "85224962283",
      WOZTELL_APP_ID: "owned-app",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      EP_WA_ENQUIRY_MODE: "observe",
      EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
      EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "owned-correlation-proof",
      EP_WA_STAFF_REPLY_CONTEXT_PATH: "context.replyTo",
    });
    try {
      await withOwnedPostgres(
        async ({ query, transaction, pool }) => {
          await seedOwnedEnquiryCopy(query);
          await mockOwnedServerDb(mock, query, transaction);
          mock.module(new URL("../control-plane/job-wake.server.ts", import.meta.url).href, {
            exports: { wakeAfterCommit: () => {}, laneForJob: () => "general" },
          });
          const { createWebsiteInquiry } = await import("../neon/admin-data.server.ts");
          const { dispatchEnquiryForwarding } = await import("./enquiry-forwarding.server.ts");
          const { loadEnquiryInfoSourceWitness } =
            await import("./enquiry-info-source-witness.server.ts");
          const { getCurrentEnquiryInfoInstallationEvidence } =
            await import("../neon/enquiry-info-installation.server.ts");
          const { buildOwnerEnquiryInfoActivationStatement } =
            await import("../neon/enquiry-info-decisions.server.ts");
          const { handleLeadStaffAlert } = await import("./lead-alert.server.ts");
          const { resolveEnquiryForwarding } = await import("./enquiry-routing.server.ts");
          const { isolateSignedStaffEvent } = await import("./staff-event-isolation.server.ts");
          const { observeEpisode } = await import("./episodes.server.ts");
          const { normalizeWoztellEvent } = await import("../woztell/woztell.server.ts");
          const { storeInboundReceipt, markInboundReceipt } =
            await import("./inbound-receipts.server.ts");
          const { eventForReceiptProjection } = await import("./inbound-identity.ts");
          const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
          for (const manager of Object.values(ENQUIRY_MANAGERS))
            await query(
              "INSERT INTO staff_users(id,name_zh,active,show_on_website,phone) VALUES($1,'Owned photographed manager',true,true,$2) ON CONFLICT(id) DO NOTHING",
              [manager.staffId, manager.phone],
            );
          const rolesBefore = (await query("SELECT count(*)::int n FROM staff_roles"))[0].n;
          let serial = 0;
          async function scenario({ withPrearmReceipt = false, alertTemplate = template } = {}) {
            const template = alertTemplate;
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
            const scope = { appId: "owned-app", channelId: channel };
            let prearm = null;
            if (withPrearmReceipt) {
              const raw = {
                type: "TEXT",
                eventType: "INBOUND",
                app: scope.appId,
                channel,
                member: `owned-customer-member-${n}`,
                from: `852${98700000 + n}`,
                to: "85224962283",
                messageId: `owned-before-arm-${randomUUID()}`,
                timestamp: Math.floor(Date.now() / 1000),
                data: { text: "想問豪景花園兩房租盤" },
              };
              const normalized = normalizeWoztellEvent(raw);
              const receipt = await storeInboundReceipt(
                {
                  tenantKey: `woztell:${scope.appId}`,
                  appId: scope.appId,
                  channelId: channel,
                  event: normalized,
                  eventKind: "customer_message",
                  origin: "live_webhook",
                  bodyDigest: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
                  providerOccurredAt: normalized.timestamp,
                  receivedAt: new Date(),
                  capture: { mode: "observe", activationId: null, effectsEligible: false },
                },
                { query, transaction },
              );
              assert.equal(
                receipt.enquiryForwardingArmId,
                null,
                "registry clocks alone are not a genuine arm witness",
              );
              prearm = { raw, normalized, receipt };
            }
            const [checkedJob] = await query(
              "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) VALUES('woztell.enquiry.forward.readiness',1,'{}','succeeded',2,now(),$1) RETURNING id",
              [`owned-info-readiness:${channel}`],
            );
            await query(
              "INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(NULL,'whatsapp.enquiry_forwarding.check_requested','ops_job',$1,$2::jsonb)",
              [
                checkedJob.id,
                JSON.stringify({
                  source: "approved_deployment_verification",
                  releaseSha: process.env.VERCEL_GIT_COMMIT_SHA,
                }),
              ],
            );
            const installation = await getCurrentEnquiryInfoInstallationEvidence(scope, { query });
            assert.ok(
              installation,
              "actual migrated schema, tested runtime modules and scoped owned release witness are required",
            );
            const providerReport = {
              ready: false,
              capabilities: {
                whatsappVerification: false,
                correlationVerification: false,
                associationReview: false,
                replyContext: false,
              },
              flags: {
                woztellEnabled: true,
                staffNotificationsEnabled: true,
                enquiryMode: "observe",
                botAccessTokenPresent: true,
                openApiTokenPresent: true,
                channelSecretPresent: true,
              },
              channel: {
                appId: scope.appId,
                configuredChannelId: channel,
                connected: true,
                archived: false,
                senderPhone: "85224962283",
                companyPhoneMatches: true,
                senderDifferentFromFixedCopy: true,
                proofHash: "b".repeat(64),
              },
              template: {
                configured: template,
                configuredApproved: true,
                selectionRequired: false,
                validationComplete: true,
                candidates: [
                  {
                    providerTemplateId: "owned-template",
                    name: template.name,
                    language: template.language,
                    paramCount: template.params.length,
                    proofHash: "c".repeat(64),
                  },
                ],
              },
            };
            providerReport.infoForwarding = deriveEnquiryInfoReadiness(
              providerReport,
              installation,
            );
            assert.equal(providerReport.infoForwarding.ready, true);
            assert.equal(
              providerReport.ready,
              false,
              "informational permission does not fabricate legacy action capability",
            );
            const [providerProof] = await query(
              "INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) VALUES(NULL,'whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb) RETURNING id,created_at",
              [checkedJob.id, JSON.stringify(providerReport)],
            );
            const [beforeArmCopy] = await query(
              "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
            );
            const owner = {
              goalId: "owned-enquiry-information-goal",
              sourceReference: "owned-fixture:approved-routing",
              sourceSha256: "d".repeat(64),
              receivedAt: new Date(providerProof.created_at).toISOString(),
              recorderReference: "owned-test-operator",
              statement: "Owned fixture owner approves genuine informational enquiry routing.",
              photoSha256: "e".repeat(64),
            };
            const armResult = await transaction(
              [
                {
                  statement:
                    "UPDATE enquiry_notification_recipients SET verification_ref=$2 WHERE channel_id=$1 AND enabled RETURNING recipient_key,version",
                  params: [channel, `provider-check-audit:${providerProof.id}`],
                },
                buildOwnerEnquiryInfoActivationStatement(
                  {
                    scope,
                    subject: { kind: "policy" },
                    decision: "armed",
                    expectedRevision: 0,
                    evidence: {
                      providerProofAuditId: providerProof.id,
                      copyVersion: Number(beforeArmCopy.version) + 1,
                    },
                  },
                  owner,
                ),
              ],
              { isolationLevel: "ReadCommitted" },
            );
            const armId = armResult[1][0].id;
            assert.ok(armId);
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
              assert.equal(lead.enquiry_routing_context.notificationRoute, "enquiry_forward");
              assert.equal(inquiry.forwardingQueued, true);
              assert.equal(inquiry.leadAlertQueued, false);
              return { source: "website", subjectId: lead.id, input, inquiry, lead };
            };
            const intakeWhatsapp = async ({ pendingReceipt = false, fromPrearm = false } = {}) => {
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
              const raw = fromPrearm
                ? prearm.raw
                : {
                    type: "TEXT",
                    eventType: "INBOUND",
                    app: scope.appId,
                    channel,
                    member,
                    from: `852${98700000 + n}`,
                    to: "85224962283",
                    messageId: `owned-inbound-${randomUUID()}`,
                    timestamp: Math.floor(Date.now() / 1000),
                    data: { text: "想問豪景花園兩房租盤" },
                  };
              const normalized = normalizeWoztellEvent(raw);
              const receipt = fromPrearm
                ? prearm.receipt
                : await storeInboundReceipt(
                    {
                      tenantKey: `woztell:${scope.appId}`,
                      appId: scope.appId,
                      channelId: channel,
                      event: normalized,
                      eventKind: "customer_message",
                      origin: "live_webhook",
                      bodyDigest: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
                      providerOccurredAt: normalized.timestamp,
                      receivedAt: new Date(),
                      capture: { mode: "observe", activationId: null, effectsEligible: false },
                    },
                    { query, transaction },
                  );
              assert.equal(receipt.enquiryForwardingArmId, fromPrearm ? null : armId);
              const external = eventForReceiptProjection(
                normalized,
                receipt.receiptId,
                "customer_message",
                receipt.identityKey,
              ).externalMessageId;
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
              if (!pendingReceipt)
                await markInboundReceipt(receipt.receiptId, "projected", undefined, { query });
              return {
                receiptId: receipt.receiptId,
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
                boundaryErrors = [],
                permitResults = [];
              return {
                sends,
                preflights,
                boundaryErrors,
                permitResults,
                factory: (options) => ({
                  sendTemplateByPhone: async (input) => {
                    const scope = {
                      ...input,
                      phone: input.binding.recipientPhone,
                      channelId: input.binding.channelId,
                    };
                    preflights.push(scope);
                    if (hook) await hook(scope);
                    try {
                      await scope.beforeSend();
                    } catch (error) {
                      boundaryErrors.push(error.message);
                      throw error;
                    }
                    if (mode === "late_disable")
                      await query(
                        "UPDATE enquiry_notification_recipients SET enabled=false WHERE phone=$1 AND channel_id=$2",
                        [scope.phone, scope.channelId],
                      );
                    if (mode === "late_customer" && scope.phone === staff[0].phone)
                      await query(
                        "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('Owned late identity conflict',$1,$1)",
                        [scope.phone],
                      );
                    let permit;
                    try {
                      const permits = await Promise.all([
                        options.resolvePermit(input.binding),
                        ...(mode === "duplicate_permit"
                          ? [options.resolvePermit({ ...input.binding })]
                          : []),
                      ]);
                      permitResults.push(...permits);
                      permit = permits.find(Boolean);
                    } catch {
                      permit = null;
                    }
                    if (!permit)
                      throw Object.assign(Error("STAFF_NOTIFICATION_PREFLIGHT_BLOCKED"), {
                        code: "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
                      });
                    assert.deepEqual(
                      permit,
                      input.binding,
                      "real DB guard must authorize the exact immutable claim",
                    );
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
                }),
              };
            };
            const dispatch = async (subject, p, context) =>
              dispatchEnquiryForwarding(
                { source: subject.source, subjectId: subject.subjectId },
                context ?? (await lease(subject)),
                { query, transaction, runtime, transport: p.factory },
              );
            const rearm = async () => {
              const [current] = await query(
                "SELECT (enquiry_info_head($1,$2,'policy','policy')).revision AS revision,(SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy') AS copy_version",
                [scope.appId, scope.channelId],
              );
              const rearmOwner = {
                ...owner,
                sourceReference: `owned-fixture:rearm-${randomUUID()}`,
              };
              const result = await transaction(
                [
                  {
                    statement:
                      "UPDATE enquiry_notification_recipients SET enabled=true,permission_ref=$1 WHERE recipient_key='copy' RETURNING version",
                    params: [rearmOwner.sourceReference],
                  },
                  buildOwnerEnquiryInfoActivationStatement(
                    {
                      scope,
                      subject: { kind: "policy" },
                      decision: "armed",
                      expectedRevision: Number(current.revision),
                      evidence: {
                        providerProofAuditId: providerProof.id,
                        copyVersion: Number(current.copy_version) + 1,
                      },
                    },
                    rearmOwner,
                  ),
                ],
                { isolationLevel: "ReadCommitted" },
              );
              return result[1][0].id;
            };
            return {
              n,
              channel,
              armId,
              rearm,
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
          // The real final transaction has already finished its last resolver read when
          // this port is entered. Block its first statement in PostgreSQL, prove the
          // advisory-lock wait through pg_blocking_pids, then commit a legitimate edit.
          async function dispatchDuringPolicyWait(s, subject, change, { beforeWait } = {}) {
            const provider = s.provider();
            let waited = false,
              intercepted = false;
            const tx = async (statements, options) => {
              if (
                intercepted ||
                !statements.some(({ statement }) => statement.includes("SET claim_id=$8"))
              )
                return transaction(statements, options);
              intercepted = true;
              assert.equal(options.isolationLevel, "ReadCommitted");
              const holder = await pool.connect();
              let pending;
              try {
                await holder.query("BEGIN");
                await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                  `enq-info:policy:owned-app:${s.channel}`,
                ]);
                if (beforeWait) await beforeWait(context);
                pending = transaction(statements, options);
                // Attach a rejection handler immediately while we observe the wait.
                pending.catch(() => {});
                const deadline = Date.now() + 5000;
                for (;;) {
                  const [row] = await query(
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND $1::int=ANY(pg_blocking_pids(pid))) AS waiting",
                    [holder.processID],
                  );
                  if (row.waiting) {
                    waited = true;
                    break;
                  }
                  assert.ok(Date.now() < deadline, "actual final permit must wait on policy lock");
                  await delay(10);
                }
                await change({ context, blockerPid: holder.processID });
                await holder.query("COMMIT");
                return await pending;
              } finally {
                await holder.query("ROLLBACK");
                holder.release();
                if (pending) await pending.catch(() => {});
              }
            };
            const context = await s.lease(subject);
            const result = await dispatchEnquiryForwarding(
              { source: subject.source, subjectId: subject.subjectId },
              context,
              { query, transaction: tx, runtime: s.runtime, transport: provider.factory },
            );
            assert.equal(waited, true);
            return { provider, result };
          }
          async function addPortalReference(s, subject) {
            const external = String(9000000 + s.n),
              policy = `owned-info-${s.n}`;
            await query(
              "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version) VALUES($1,'agent:540',$2,$2)",
              [SOURCE_28HSE, policy],
            );
            const [run] = await query(
              "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version) VALUES(current_date,'shadow','shadow_healthy',$1) RETURNING id",
              [policy],
            );
            const [receipt] = await query(
              "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response) VALUES($1,'agent:540',$2,$2,clock_timestamp(),repeat('a',64),$3,'{}') RETURNING id",
              [SOURCE_28HSE, policy, run.id],
            );
            const [observation] = await query(
              "INSERT INTO listing_source_observations(run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at) VALUES($1,$2,$3,'sale','https://example.invalid/owned','{}',repeat('a',64),'valid',now(),now()) RETURNING id",
              [run.id, SOURCE_28HSE, external],
            );
            await query(
              "INSERT INTO mls_source_state(source,scope_id,policy_version,external_listing_id,deal_type,observation_id,last_receipt_id,property_id,source_status,first_seen_at,last_accepted_at) VALUES($1,'agent:540',$2,$3,'sale',$4,$5,$6,'active',now(),now())",
              [SOURCE_28HSE, policy, external, observation.id, receipt.id, s.propertyId],
            );
            await query(
              "INSERT INTO whatsapp_portal_source_scopes(channel_id,source,scope_id,staff_namespace,enabled,verified_by,verified_at,verification_ref) VALUES($1,$2,'agent:540','owned-source-scope',true,$3,now()-interval '1 day','owned-reviewed-scope')",
              [s.channel, SOURCE_28HSE, s.staff[0].id],
            );
            const [interpretation] = await query(
              "INSERT INTO whatsapp_portal_interpretations(receipt_id,parser_version,interpretation,resolution) VALUES($1,$2,'{}','[]') RETURNING id",
              [subject.receiptId, policy],
            );
            await query(
              "INSERT INTO whatsapp_enquiry_reference_links(event_id,ref_index,receipt_id,interpretation_id,conversation_id,reference_key,source,scope_id,external_listing_id,deal_type,property_id,inquiry_id,association_review,resolution) VALUES($1,0,$2,$3,$4,repeat('a',64),'28hse','agent:540',$5,'sale',$6,$7,false,'{\"status\":\"resolved\",\"reasons\":[]}')",
              [
                subject.eventId,
                subject.receiptId,
                interpretation.id,
                subject.conversationId,
                external,
                s.propertyId,
                subject.subjectId,
              ],
            );
            await query("UPDATE inquiries SET property_id=$2 WHERE id=$1", [
              subject.subjectId,
              s.propertyId,
            ]);
            const route = await resolveEnquiryForwarding(query, subject);
            assert.equal(route.routingKind, "property");
            assert.deepEqual(
              route.recipients.map((r) => r.phone),
              [s.staff[0].phone, "85297987775"],
            );
            return { external };
          }
          async function assertSourceSuppressed(s, subject, change) {
            const original = await loadEnquiryInfoSourceWitness(subject, query);
            const { provider, result } = await dispatchDuringPolicyWait(s, subject, change);
            const current = await loadEnquiryInfoSourceWitness(subject, query);
            assert.notDeepEqual(
              current,
              original,
              "real source correction must change its witness",
            );
            assert.equal(result.summary.accepted, 0);
            assert.equal(result.summary.unknown, 0);
            assert.equal(provider.sends.length, 0, "no stale recipient or frozen body crosses I/O");
            assert.ok(
              provider.permitResults.includes(null),
              "last permit denied after beforeSend passed",
            );
            const rows = await s.attempts(subject);
            assert.ok(rows.every((r) => r.dispatch_state === "suppressed"));
            assert.ok(rows.some((r) => r.safe_error === "source_witness_mismatch"));
            for (const scope of provider.preflights) {
              const attempt = rows.find((r) => r.id === scope.binding.attemptId);
              assert.equal(
                attempt.claim_id,
                scope.binding.operationId,
                "denied permit never consumes original claim",
              );
              assert.deepEqual(
                attempt.routing_snapshot.sourceWitness,
                original,
                "attempt evidence remains immutable",
              );
              assert.equal(attempt.provider_accepted_at, null);
            }
            assert.equal(network.mock.calls.length, 0);
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
            "the verified copy contact's first plain message after global pause remains internal before any member binding",
            async () => {
              const s = await scenario();
              const [copy] = await query(
                "SELECT staff_id,enabled,verified_at,permission_granted FROM enquiry_notification_recipients WHERE recipient_key='copy'",
              );
              assert.equal(copy.staff_id, "64d5a2d6-e602-4760-9709-63b0414f6a83");
              assert.equal(copy.enabled, true);
              assert.ok(copy.verified_at);
              assert.equal(copy.permission_granted, true);
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM staff_users WHERE enquiry_notification_phone(phone)='85297987775' OR enquiry_notification_phone(whatsapp)='85297987775'",
                  )
                )[0].n,
                1,
                "copy is bound to one staff profile",
              );
              const member = `owned-first-paused-copy-${randomUUID()}`;
              const now = new Date();
              const incoming = normalizeWoztellEvent({
                type: "TEXT",
                app: "owned-paused-copy-app",
                channel: s.channel,
                member,
                from: "85297987775",
                messageId: `owned-first-copy-${randomUUID()}`,
                timestamp: Math.floor(now.getTime() / 1000),
                data: { text: "收到，會跟進。" },
              });
              assert.equal(incoming.woztellMemberId, member);
              assert.equal(incoming.fromPhone, "85297987775");
              assert.equal(incoming.legacyExternalMessageId, null);
              assert.equal(incoming.payload.context, undefined);
              assert.deepEqual(
                (
                  await query(
                    "SELECT (SELECT count(*) FROM staff_notification_attempts WHERE channel_id_snapshot=$1)::int attempts,(SELECT count(*) FROM staff_notification_internal_events WHERE channel_id=$1 AND member_id=$2)::int internal,(SELECT count(*) FROM whatsapp_conversations WHERE channel_id=$1 AND woztell_member_id=$2)::int conversations,(SELECT count(*) FROM crm_contacts WHERE whatsapp_member_id=$2)::int contacts",
                    [s.channel, member],
                  )
                )[0],
                { attempts: 0, internal: 0, conversations: 0, contacts: 0 },
              );
              const [customer] = await query(
                "INSERT INTO crm_contacts(name,phone,normalized_phone,assigned_agent_id,opt_in_whatsapp) VALUES('Owned protected customer',$1,$1,$2,true) RETURNING id",
                [`8529850${String(s.n).padStart(4, "0")}`, s.staff[0].id],
              );
              await query(
                "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,assigned_agent_id,assignment_lock) VALUES($1,$2,$3,$4,true)",
                [customer.id, s.channel, `owned-existing-customer-${randomUUID()}`, s.staff[1].id],
              );
              await query("UPDATE enquiry_notification_recipients SET enabled=false WHERE enabled");
              assert.equal(
                (await query("SELECT enquiry_forwarding_is_enabled($1) AS enabled", [s.channel]))[0]
                  .enabled,
                false,
              );
              const counts = async () =>
                (
                  await query(
                    "SELECT (SELECT count(*) FROM crm_contacts)::int contacts,(SELECT count(*) FROM crm_leads)::int leads,(SELECT count(*) FROM inquiries)::int inquiries,(SELECT count(*) FROM whatsapp_enquiry_events)::int events,(SELECT count(*) FROM ops_jobs)::int jobs,(SELECT count(*) FROM whatsapp_conversations)::int conversations,(SELECT count(*) FROM whatsapp_messages)::int messages,(SELECT count(*) FROM staff_roles)::int roles",
                  )
                )[0];
              const ownership = async () => ({
                contacts: await query(
                  "SELECT id,assigned_agent_id,opt_in_whatsapp,opted_out_whatsapp FROM crm_contacts ORDER BY id",
                ),
                conversations: await query(
                  "SELECT id,contact_id,assigned_agent_id,assignment_lock FROM whatsapp_conversations ORDER BY id",
                ),
              });
              const before = await counts(),
                ownerBefore = await ownership();
              let wakes = 0;
              const outcome = await ingestWoztellEvent(incoming, "live_webhook", transaction, {
                signedEvent: true,
                mode: "observe",
                now,
                wake: () => {
                  wakes++;
                },
              });
              const after = await counts();
              const internal = await query(
                "SELECT association_state,notification_attempt_id,event_kind FROM staff_notification_internal_events WHERE channel_id=$1 AND member_id=$2",
                [s.channel, member],
              );
              assert.equal(
                outcome.skipped,
                "staff-internal",
                JSON.stringify({ outcome, before, after, internal }),
              );
              assert.deepEqual(outcome, {
                contactId: null,
                conversationId: null,
                messageInserted: false,
                skipped: "staff-internal",
                identityReview: false,
              });
              assert.deepEqual(
                after,
                before,
                "paused internal replies cannot create customer, ledger or workflow rows",
              );
              assert.deepEqual(
                await ownership(),
                ownerBefore,
                "customer consent and conversation owners remain intact",
              );
              assert.deepEqual(internal, [
                { association_state: "review", notification_attempt_id: null, event_kind: "TEXT" },
              ]);
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM enquiry_notification_recipients WHERE enabled",
                  )
                )[0].n,
                0,
                "internal classification never re-enables sends",
              );
              assert.equal(
                (await query("SELECT enquiry_forwarding_is_enabled($1) AS enabled", [s.channel]))[0]
                  .enabled,
                false,
              );
              assert.equal(wakes, 0);
              assert.equal(network.mock.calls.length, 0);
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
                  [s.staff[selected ? 1 : 0].phone, "85297987775"].sort(),
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
                assert.equal(replay.forwardingQueued, undefined);
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
                [
                  { estateSlug: "bellagio", message: "想約睇樓" },
                  [ENQUIRY_MANAGERS["manager:3"].phone, "85297987775"],
                ],
                [{ estateSlug: "bellagio", message: "亦想問豪景花園" }, ["85297987775"]],
                [{ message: `請問 ${s.listingNo} 有冇得睇？` }, [s.staff[0].phone, "85297987775"]],
                [{ message: "想問春和海景花園兩房租盤" }, ["85291005322", "85297987775"]],
                [{ message: "想問青山公路村屋" }, ["85297987775"]],
                [{ message: "想問豪景花園", propertyId: randomUUID() }, ["85297987775"]],
                [{ message: "想問豪景花園", propertyId: "not-a-property-id" }, ["85297987775"]],
                [{ message: "想問豪景花園", listingNo: "A999999" }, ["85297987775"]],
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
                ["85297987775"],
              );
            },
          );
          await t.test(
            "one normalized phone shared by Sales and copy receives one frozen send",
            async () => {
              const s = await scenario();
              await query("UPDATE staff_users SET whatsapp='+852 9798 7775' WHERE id=$1", [
                s.staff[0].id,
              ]);
              const subject = await s.intake({ propertyId: s.propertyId }),
                p = s.provider();
              assert.equal((await s.dispatch(subject, p)).summary.accepted, 1);
              assert.deepEqual(
                p.sends.map((x) => x.phone),
                ["85297987775"],
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
                    transport: p.factory,
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
                    transport: p.factory,
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
                ["85297987775"],
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
              const s = await scenario({
                  alertTemplate: {
                    name: "staff_enquiry_followup_context",
                    language: "zh_HK",
                    params: ["name", "source", "phone", "context", "link"],
                  },
                }),
                subject = await s.intakeWhatsapp(),
                p = s.provider();
              const result = await s.dispatch(subject, p);
              for (const send of p.sends)
                assert.equal(
                  send.template.components[0].parameters[3].text,
                  "想問豪景花園兩房租盤",
                );
              assert.equal(
                result.summary.accepted,
                2,
                JSON.stringify({ summary: result.summary, boundaryErrors: p.boundaryErrors }),
              );
              assert.deepEqual(p.sends.map((x) => x.phone).sort(), ["85266442444", "85297987775"]);
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
                { query, transaction, runtime: s.runtime, transport: p.factory },
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
                fromPhone: "+852 9798 7775",
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
            "a committed WhatsApp enquiry can dispatch while its receipt finisher is still pending",
            async () => {
              const s = await scenario(),
                subject = await s.intakeWhatsapp({ pendingReceipt: true }),
                p = s.provider();
              assert.equal(
                (
                  await query(
                    "SELECT projection_state FROM whatsapp_inbound_receipts WHERE id=$1",
                    [subject.receiptId],
                  )
                )[0].projection_state,
                "pending",
              );
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 2);
              assert.equal(p.sends.length, 2);
            },
          );
          await t.test(
            "a pre-arm accepted receipt projected after activation never becomes a new forwarding enquiry",
            async () => {
              const s = await scenario({ withPrearmReceipt: true }),
                subject = await s.intakeWhatsapp({ fromPrearm: true }),
                p = s.provider();
              assert.equal(
                (
                  await query(
                    "SELECT enquiry_forwarding_arm_id FROM whatsapp_inbound_receipts WHERE id=$1",
                    [subject.receiptId],
                  )
                )[0].enquiry_forwarding_arm_id,
                null,
              );
              assert.equal(
                (
                  await query(
                    "SELECT i.created_at>=c.enabled_since AS clocks_would_allow FROM inquiries i CROSS JOIN enquiry_notification_recipients c WHERE i.id=$1 AND c.recipient_key='copy'",
                    [subject.subjectId],
                  )
                )[0].clocks_would_allow,
                true,
              );
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 0);
              assert.equal(p.sends.length, 0);
              assert.ok(
                (await s.attempts(subject)).every(
                  (row) => row.safe_error === "receipt_not_in_current_cutover",
                ),
              );
            },
          );
          await t.test(
            "a previous genuine arm receipt cannot be replayed into a later activation",
            async () => {
              const s = await scenario(),
                subject = await s.intakeWhatsapp(),
                oldArm = s.armId;
              assert.notEqual(await s.rearm(), oldArm);
              const p = s.provider(),
                result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 0);
              assert.equal(p.sends.length, 0);
              assert.ok(
                (await s.attempts(subject)).every(
                  (row) => row.safe_error === "receipt_not_in_current_cutover",
                ),
              );
            },
          );
          await t.test(
            "concurrent use of one dispatch operation has one durable permit winner",
            async () => {
              const s = await scenario(),
                subject = await s.intake(),
                p = s.provider({ mode: "duplicate_permit" });
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 1);
              assert.equal(p.sends.length, 1);
              assert.equal(p.permitResults.length, 2);
              assert.equal(p.permitResults.filter(Boolean).length, 1);
              const [attempt] = await s.attempts(subject);
              assert.notEqual(
                attempt.claim_id,
                p.sends[0].binding.operationId,
                "the original local operation token was consumed before I/O",
              );
              assert.equal(attempt.dispatch_state, "accepted");
            },
          );
          await t.test(
            "permit denial after beforeSend remains suppressed with no provider ambiguity",
            async () => {
              const s = await scenario(),
                subject = await s.intake(),
                p = s.provider({ mode: "late_disable" });
              const result = await s.dispatch(subject, p);
              assert.equal(p.preflights.length, 1);
              assert.equal(p.boundaryErrors.length, 0);
              assert.equal(p.sends.length, 0);
              assert.equal(result.summary.unknown, 0);
              assert.equal((await s.attempts(subject))[0].dispatch_state, "suppressed");
            },
          );
          await t.test(
            "the last DB permit rejects a new customer identity conflict after the routing callback",
            async () => {
              const s = await scenario(),
                subject = await s.intake({ propertyId: s.propertyId }),
                p = s.provider({ mode: "late_customer" });
              const result = await s.dispatch(subject, p);
              assert.equal(result.summary.accepted, 1);
              assert.equal(result.summary.blocked, 1);
              assert.deepEqual(
                p.sends.map((send) => send.phone),
                ["85297987775"],
              );
              assert.equal(
                (await s.attempts(subject)).find(
                  (row) => row.routing_snapshot.recipientKind === "sales",
                ).dispatch_state,
                "suppressed",
              );
            },
          );
          await t.test(
            "a lease that expires during the real policy wait cannot consume a permit using transaction-start time",
            async () => {
              const s = await scenario(),
                subject = await s.intake();
              let beforeExpiry;
              const { result, provider } = await dispatchDuringPolicyWait(
                s,
                subject,
                async ({ context, blockerPid }) => {
                  const [atWait] = await query(
                    "SELECT j.lease_expires_at,a.xact_start,j.lease_expires_at>a.xact_start AS valid_at_begin,j.lease_expires_at>clock_timestamp() AS currently_valid FROM ops_jobs j CROSS JOIN pg_stat_activity a WHERE j.id=$1 AND a.wait_event='advisory' AND $2::int=ANY(pg_blocking_pids(a.pid))",
                    [context.jobId, blockerPid],
                  );
                  assert.equal(
                    atWait.valid_at_begin,
                    true,
                    "actual lease was live at the blocked transaction BEGIN",
                  );
                  assert.equal(
                    atWait.currently_valid,
                    true,
                    "deadline is still in the future after the wait is observed",
                  );
                  beforeExpiry = atWait.lease_expires_at;
                  await query("SELECT pg_sleep(0.6)");
                  const [expired] = await query(
                    "SELECT j.lease_expires_at,j.lease_expires_at>a.xact_start AS stale_now_would_allow,j.lease_expires_at<=clock_timestamp() AS expired FROM ops_jobs j CROSS JOIN pg_stat_activity a WHERE j.id=$1 AND a.wait_event='advisory' AND $2::int=ANY(pg_blocking_pids(a.pid))",
                    [context.jobId, blockerPid],
                  );
                  assert.deepEqual(
                    expired.lease_expires_at,
                    beforeExpiry,
                    "deadline passes naturally without another lease edit",
                  );
                  assert.equal(expired.stale_now_would_allow, true);
                  assert.equal(
                    expired.expired,
                    true,
                    "database wall clock passed the deadline while policy lock stayed held",
                  );
                },
                {
                  beforeWait: async (context) => {
                    await query(
                      "UPDATE ops_jobs SET lease_expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
                      [context.jobId],
                    );
                  },
                },
              );
              assert.deepEqual(result.summary, {
                accepted: 0,
                unknown: 0,
                blocked: 1,
                alreadySent: 0,
              });
              assert.equal(
                provider.boundaryErrors.length,
                0,
                "beforeSend completed while lease was live",
              );
              assert.deepEqual(provider.permitResults, [null]);
              assert.equal(provider.sends.length, 0);
              const [attempt] = await s.attempts(subject);
              assert.equal(attempt.dispatch_state, "suppressed");
              assert.equal(attempt.safe_error, "dispatch_eligibility_changed");
              assert.equal(
                attempt.claim_id,
                provider.preflights[0].binding.operationId,
                "expired lease never consumes claim",
              );
              assert.equal(attempt.provider_accepted_at, null);
              assert.equal(network.mock.calls.length, 0);
            },
          );
          await t.test(
            "a legitimate property correspondent removal during the real policy wait denies the old Sales permit",
            async () => {
              const s = await scenario();
              const subject = await s.intake({ propertyId: s.propertyId });
              await assertSourceSuppressed(s, subject, () =>
                query("DELETE FROM property_agents WHERE property_id=$1 AND position=1", [
                  s.propertyId,
                ]),
              );
              const current = await resolveEnquiryForwarding(query, subject);
              assert.deepEqual(
                current.recipients.map((r) => r.phone),
                ["85297987775"],
              );
              assert.equal(
                (
                  await query(
                    "SELECT active AND show_on_website AS eligible FROM staff_users WHERE id=$1",
                    [s.staff[0].id],
                  )
                )[0].eligible,
                true,
                "former Sales remains an eligible staff recipient globally",
              );
            },
          );
          for (const correction of [
            "message",
            "customer_name",
            "customer_phone",
            "selected_agent",
            "public_winner",
            "property_status",
          ])
            await t.test(
              `atomic source fence rejects website ${correction} correction during policy wait`,
              async () => {
                const s = await scenario();
                const subject = await s.intake({
                  propertyId: s.propertyId,
                  agentId: s.staff[1].id,
                });
                let peer;
                if (correction === "public_winner") {
                  const [row] = await query(
                    "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,status,district_slug,source_updated_at) VALUES($1,$2,'Owned older offering','sale','active','sham-tseng',now()-interval '1 day') RETURNING id",
                    [`B${800000 + s.n}`, s.listingNo],
                  );
                  peer = row.id;
                  // Actual existing public group membership, no parallel ranking algorithm.
                  await query(
                    "UPDATE property_public_members SET public_listing_no=$2 WHERE property_id=$1",
                    [peer, s.listingNo],
                  );
                  await query("UPDATE properties SET source_updated_at=now() WHERE id=$1", [
                    s.propertyId,
                  ]);
                  assert.equal(
                    (await resolveEnquiryForwarding(query, subject)).routingKind,
                    "property",
                  );
                }
                await assertSourceSuppressed(s, subject, async () => {
                  if (correction === "message")
                    await query("UPDATE inquiries SET message='已更正的客戶查詢內容' WHERE id=$1", [
                      subject.inquiry.id,
                    ]);
                  if (correction === "customer_name")
                    await query("UPDATE crm_contacts SET name='已核對的客戶名稱' WHERE id=$1", [
                      subject.lead.contact_id,
                    ]);
                  if (correction === "customer_phone")
                    await query(
                      "UPDATE crm_contacts SET phone='85298761234',normalized_phone='85298761234' WHERE id=$1",
                      [subject.lead.contact_id],
                    );
                  if (correction === "selected_agent")
                    await query(
                      "UPDATE crm_leads SET enquiry_routing_context=jsonb_set(enquiry_routing_context,'{selectedAgentId}',to_jsonb($2::text)) WHERE id=$1",
                      [subject.subjectId, s.staff[0].id],
                    );
                  if (correction === "public_winner")
                    await query("UPDATE properties SET source_authority='28hse' WHERE id=$1", [
                      peer,
                    ]);
                  if (correction === "property_status")
                    await query("UPDATE properties SET status='inactive' WHERE id=$1", [
                      s.propertyId,
                    ]);
                });
              },
            );
          for (const correction of [
            "estate_revision",
            "estate_ambiguity",
            "intake_text",
            "inquiry_closed",
          ])
            await t.test(
              `atomic source fence rejects WhatsApp ${correction} during policy wait`,
              async () => {
                const s = await scenario(),
                  subject = await s.intakeWhatsapp();
                let savedRoute;
                if (correction === "estate_ambiguity")
                  [savedRoute] = await query(
                    "SELECT scope_key,aliases FROM enquiry_estate_routes WHERE label='春和海景花園'",
                  );
                try {
                  await assertSourceSuppressed(s, subject, async () => {
                    if (correction === "estate_revision")
                      await query(
                        "UPDATE enquiry_estate_routes SET aliases=array_append(aliases,$1) WHERE label='豪景花園'",
                        [`owned-revision-${s.n}`],
                      );
                    if (correction === "estate_ambiguity")
                      await query(
                        "UPDATE enquiry_estate_routes SET aliases=array_append(aliases,'豪景花園') WHERE scope_key=$1",
                        [savedRoute.scope_key],
                      );
                    if (correction === "intake_text")
                      await query(
                        "UPDATE whatsapp_messages SET text='已更正的實際客戶來訊' WHERE id=$1",
                        [subject.messageId],
                      );
                    if (correction === "inquiry_closed")
                      await query("UPDATE inquiries SET status='closed' WHERE id=$1", [
                        subject.subjectId,
                      ]);
                  });
                  if (correction === "estate_ambiguity")
                    assert.equal(
                      (await resolveEnquiryForwarding(query, subject)).routingKind,
                      "review",
                    );
                } finally {
                  if (savedRoute)
                    await query("UPDATE enquiry_estate_routes SET aliases=$2 WHERE scope_key=$1", [
                      savedRoute.scope_key,
                      savedRoute.aliases,
                    ]);
                }
              },
            );
          for (const correction of [
            "reference_resolution",
            "portal_scope",
            "mls_source_status",
            "mls_source_freshness",
          ])
            await t.test(
              `atomic source fence rejects current WhatsApp ${correction} during policy wait`,
              async () => {
                const s = await scenario(),
                  subject = await s.intakeWhatsapp();
                const { external } = await addPortalReference(s, subject);
                await assertSourceSuppressed(s, subject, async () => {
                  if (correction === "reference_resolution")
                    await query(
                      'UPDATE whatsapp_enquiry_reference_links SET resolution=\'{"status":"review","reasons":["source_changed"]}\' WHERE event_id=$1',
                      [subject.eventId],
                    );
                  if (correction === "portal_scope")
                    await query(
                      "UPDATE whatsapp_portal_source_scopes SET enabled=false WHERE channel_id=$1 AND source=$2",
                      [s.channel, SOURCE_28HSE],
                    );
                  if (correction === "mls_source_status")
                    await query(
                      "UPDATE mls_source_state SET source_status='delisted' WHERE source=$1 AND external_listing_id=$2",
                      [SOURCE_28HSE, external],
                    );
                  if (correction === "mls_source_freshness")
                    await query(
                      "UPDATE mls_source_state SET first_seen_at=now()-interval '32 days',last_accepted_at=now()-interval '31 days' WHERE source=$1 AND external_listing_id=$2",
                      [SOURCE_28HSE, external],
                    );
                });
                assert.equal(
                  (await resolveEnquiryForwarding(query, subject)).routingKind,
                  "review",
                );
              },
            );
          await t.test(
            "a selected correspondent becoming eligible fences the former primary Sales but preserves the copy",
            async () => {
              const s = await scenario();
              const subject = await s.intake({ propertyId: s.propertyId, agentId: s.staff[1].id });
              await query("UPDATE staff_users SET active=false WHERE id=$1", [s.staff[1].id]);
              assert.equal(
                (await resolveEnquiryForwarding(query, subject)).recipients[0].phone,
                s.staff[0].phone,
              );
              const original = await loadEnquiryInfoSourceWitness(subject, query);
              const { result, provider } = await dispatchDuringPolicyWait(s, subject, () =>
                query("UPDATE staff_users SET active=true WHERE id=$1", [s.staff[1].id]),
              );
              const current = await loadEnquiryInfoSourceWitness(subject, query);
              assert.equal(current.hash, original.hash);
              assert.notEqual(current.salesHash, original.salesHash);
              assert.equal(result.summary.accepted, 1);
              assert.equal(result.summary.unknown, 0);
              assert.deepEqual(
                provider.sends.map((send) => send.phone),
                ["85297987775"],
              );
              assert.equal(
                (await resolveEnquiryForwarding(query, subject)).recipients[0].phone,
                s.staff[1].phone,
              );
              assert.equal(
                (await s.attempts(subject)).find(
                  (row) => row.routing_snapshot.recipientKind === "sales",
                ).dispatch_state,
                "suppressed",
              );
            },
          );
          await t.test(
            "ordinary assignment, open status, consent and unrelated property edits do not invalidate a stable source",
            async () => {
              const s = await scenario(),
                subject = await s.intakeWhatsapp();
              const original = await loadEnquiryInfoSourceWitness(subject, query);
              const { result, provider } = await dispatchDuringPolicyWait(s, subject, async () => {
                await query(
                  "UPDATE whatsapp_conversations SET assigned_agent_id=$2,assignment_lock=false WHERE id=$1",
                  [subject.conversationId, s.staff[1].id],
                );
                await query(
                  "UPDATE crm_contacts SET assigned_agent_id=$2,opt_in_whatsapp=true WHERE id=$1",
                  [subject.contactId, s.staff[1].id],
                );
                await query("UPDATE inquiries SET status='in_progress' WHERE id=$1", [
                  subject.subjectId,
                ]);
                await query("DELETE FROM property_agents WHERE property_id=$1", [s.propertyId]);
              });
              assert.deepEqual(await loadEnquiryInfoSourceWitness(subject, query), original);
              assert.equal(result.summary.accepted, 2);
              assert.equal(provider.sends.length, 2);
              assert.equal(network.mock.calls.length, 0);
            },
          );
          await t.test(
            "a source change inside the actual resolver cannot be blessed by a post-read fingerprint",
            async () => {
              const s = await scenario(),
                subject = await s.intake({ propertyId: s.propertyId });
              const p = s.provider();
              let changed = false;
              const result = await dispatchEnquiryForwarding(
                { source: subject.source, subjectId: subject.subjectId },
                await s.lease(subject),
                {
                  query,
                  transaction,
                  runtime: s.runtime,
                  transport: p.factory,
                  resolve: async (q, payload) => {
                    const route = await resolveEnquiryForwarding(q, payload);
                    if (!changed) {
                      changed = true;
                      await query(
                        "DELETE FROM property_agents WHERE property_id=$1 AND position=1",
                        [s.propertyId],
                      );
                    }
                    return route;
                  },
                },
              );
              assert.equal(result.summary.accepted, 0);
              assert.equal(p.sends.length, 0);
              assert.equal(
                (await s.attempts(subject)).length,
                0,
                "unstable read is rejected before freezing any attempt",
              );
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
                  ["85297987775"],
                );
                assert.equal(
                  (await s.attempts(subject)).find(
                    (r) => r.routing_snapshot.recipientKind === "sales",
                  ).safe_error,
                  "recipient_identity_review_required",
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
