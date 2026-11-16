import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { migrationStatements } from "../../../scripts/acceptance/migrated-schema.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
const VERSION = "20261116010000_enquiry_information_scope.sql";
const scope = { appId: "owned_intake_app", channelId: "owned_intake_channel" };
const SECRET = "owned-intake-hmac-fixture";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const owner = {
  goalId: "owned-intake-business-goal",
  sourceReference: "owned:current-controller",
  sourceSha256: hash("owned controller instruction"),
  receivedAt: "2026-01-01T00:00:00Z",
  recorderReference: "owned:fixture-recorder",
  statement: "Owned current business phone controller approval only.",
};

test(
  "causal signed receipt intake and explicit neutral sender review on owned ordered Postgres",
  { timeout: 180000 },
  async (t) => {
    const saved = {
      EP_WA_ENQUIRY_MODE: process.env.EP_WA_ENQUIRY_MODE,
      WOZTELL_APP_ID: process.env.WOZTELL_APP_ID,
      WOZTELL_CHANNEL_ID: process.env.WOZTELL_CHANNEL_ID,
      EP_WA_COMPANY_CHANNEL_ID: process.env.EP_WA_COMPANY_CHANNEL_ID,
    };
    Object.assign(process.env, {
      EP_WA_ENQUIRY_MODE: "observe",
      WOZTELL_APP_ID: scope.appId,
      WOZTELL_CHANNEL_ID: scope.channelId,
      EP_WA_COMPANY_CHANNEL_ID: scope.channelId,
    });
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("Owned intake forbids external network");
    });
    try {
      await withOwnedPostgres(
        async ({ query, transaction, pool }) => {
          await mockOwnedServerDb(mock, query, transaction);
          const receipts = await import("./inbound-receipts.server.ts");
          const { handleWoztellWebhook } = await import("./webhook.server.ts");
          const { normalizeWoztellEvent } = await import("../woztell/woztell.server.ts");
          const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
          const { eventForReceiptProjection } = await import("./inbound-identity.ts");
          const decisions = await import("../neon/enquiry-info-decisions.server.ts");
          const { resolveEnquiryInfoHeldReceipt } = await import("./enquiry-info-intake.server.ts");
          const ports = { query, transaction };
          let ingestions = 0;
          const payload = ({
            member = `owned_member_${randomUUID()}`,
            from,
            to = "85224962283",
            messageId = `owned_message_${randomUUID()}`,
            text = "請提供更多資料",
            channel = scope.channelId,
            app = scope.appId,
          } = {}) => ({
            type: "TEXT",
            eventType: "INBOUND",
            messageId,
            member,
            app,
            channel,
            timestamp: Math.floor(Date.now() / 1000),
            ...(from ? { from } : {}),
            to,
            data: { text },
          });
          function verified(body) {
            const event = normalizeWoztellEvent(body);
            return {
              tenantKey: `woztell:${body.app}`,
              appId: body.app,
              channelId: body.channel,
              event,
              eventKind: "customer_message",
              origin: "live_webhook",
              bodyDigest: hash(JSON.stringify(body)),
              providerOccurredAt: event.timestamp,
              receivedAt: new Date(),
              capture: { mode: "observe", activationId: null, effectsEligible: false },
            };
          }
          async function receive(body, ingestTransaction = transaction, webhookScope = scope) {
            const raw = JSON.stringify(body);
            let projectionError;
            const response = await handleWoztellWebhook(
              new Request("https://owned.invalid/api/woztell/webhook", {
                method: "POST",
                body: raw,
                headers: {
                  "x-woztell-signature": createHmac("sha256", SECRET).update(raw).digest("base64"),
                },
              }),
              {
                config: {
                  enabled: true,
                  channelSecret: SECRET,
                  channelId: webhookScope.channelId,
                  appId: webhookScope.appId,
                },
                storeReceipt: (input) => receipts.storeInboundReceipt(input, ports),
                markReceipt: (id, state, reason) =>
                  receipts.markInboundReceipt(id, state, reason, { query }),
                ingest: async (event, origin, _unused, options) => {
                  ingestions++;
                  try {
                    return await ingestWoztellEvent(event, origin, ingestTransaction, {
                      ...options,
                      schemaAvailable: async () => true,
                      wake: () => {},
                    });
                  } catch (error) {
                    projectionError = error;
                    throw error;
                  }
                },
              },
            );
            if (projectionError) throw projectionError;
            return response;
          }
          async function effects() {
            return (
              await query(
                `SELECT jsonb_build_object('contacts',(SELECT count(*) FROM crm_contacts),'conversations',(SELECT count(*) FROM whatsapp_conversations),'messages',(SELECT count(*) FROM whatsapp_messages),'enquiries',(SELECT count(*) FROM whatsapp_enquiry_events),'jobs',(SELECT count(*) FROM ops_jobs),'internal',(SELECT count(*) FROM staff_notification_internal_events)) value`,
              )
            )[0].value;
          }
          async function staff(role, number = null) {
            const id = randomUUID();
            await query(
              "INSERT INTO staff_users(id,auth_user_id,name_zh,active,show_on_website,phone,whatsapp) VALUES($1,$2,'Owned intake colleague',true,$3,$4,$4)",
              [id, `owned_auth_${id}`, !!number, number],
            );
            if (role)
              await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [id, role]);
            return { staffId: id, roles: role ? [role] : [] };
          }
          const manager = await staff("manager"),
            agent = await staff("agent");
          let beforeArm;
          await t.test(
            "optional schema absence and pre-arm receipts retain ordinary no-phone intake",
            async () => {
              const first = await receive(payload({ member: "owned_before_schema" }));
              assert.equal(first.status, 200);
              assert.equal((await first.json()).projection, undefined);
              assert.ok(
                (
                  await query(
                    "SELECT id FROM crm_contacts WHERE whatsapp_member_id='owned_before_schema'",
                  )
                )[0],
              );
              await transaction(migrationStatements(VERSION).map((statement) => ({ statement })));
              await query("INSERT INTO app_migrations(version) VALUES($1)", [VERSION]);
              const second = await receive(payload({ member: "owned_unarmed_customer" }));
              assert.equal(second.status, 200);
              beforeArm = await receipts.storeInboundReceipt(
                verified(payload({ member: "owned_waiting_prearm" })),
                ports,
              );
              assert.equal(beforeArm.enquiryForwardingArmId, null);
            },
          );
          let arm;
          await t.test(
            "receipt admission waits for actual atomic arm and reads a fresh snapshot after the lock",
            async () => {
              const [proof] = await query(
                "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb) RETURNING id",
                [
                  randomUUID(),
                  JSON.stringify({
                    channel: { configuredChannelId: scope.channelId },
                    infoForwarding: { ready: true, purpose: "enq_forward_info", ...scope },
                  }),
                ],
              );
              const [copy] = await query(
                "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
              );
              const statement = decisions.buildEnquiryInfoDecisionStatement(
                {
                  scope,
                  subject: { kind: "policy" },
                  decision: "armed",
                  expectedRevision: 0,
                  evidence: { providerProofAuditId: proof.id, copyVersion: copy.version + 1 },
                },
                manager,
              );
              const client = await pool.connect();
              let releaseStart;
              const started = new Promise((resolve) => {
                releaseStart = resolve;
              });
              try {
                await client.query("BEGIN");
                await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                  decisions.enquiryInfoPolicyLockKey(scope),
                ]);
                const admission = receipts.storeInboundReceipt(
                  verified(payload({ member: "owned_admission_race" })),
                  {
                    query,
                    transaction: async (statements, options) => {
                      releaseStart();
                      return transaction(statements, options);
                    },
                  },
                );
                await started;
                await client.query(
                  "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,destination_reference=phone,verified_at=now(),verification_ref='owned-info-proof',permission_granted=true,permission_ref='owned-business-goal' WHERE recipient_key='copy'",
                  [scope.channelId],
                );
                arm = (await client.query(statement.statement, statement.params)).rows[0];
                await client.query("COMMIT");
                assert.equal((await admission).enquiryForwardingArmId, arm.id);
              } finally {
                await client.query("ROLLBACK").catch(() => {});
                client.release();
              }
              const [old] = await query("SELECT * FROM whatsapp_inbound_receipts WHERE id=$1", [
                beforeArm.receiptId,
              ]);
              assert.equal(old.enquiry_forwarding_arm_id, null);
              const event = eventForReceiptProjection(
                old.normalized_event,
                old.id,
                old.event_kind,
                old.identity_key,
              );
              assert.equal(
                (
                  await ingestWoztellEvent(event, "live_webhook", transaction, {
                    signedEvent: true,
                    mode: "off",
                    receiptContext: { receiptId: old.id },
                  })
                ).skipped,
                null,
              );
            },
          );
          let unresolved, unknown;
          await t.test(
            "unknown opaque no-phone sender is durably held before every customer effect",
            async () => {
              unknown = payload({ member: "owned_unknown_first", text: "STOP" });
              const prior = await effects();
              const response = await receive(unknown);
              assert.equal(response.status, 200);
              assert.equal((await response.json()).projection, "review_required");
              assert.deepEqual(await effects(), prior);
              unresolved = (
                await query("SELECT * FROM whatsapp_inbound_receipts WHERE member_id=$1", [
                  unknown.member,
                ])
              )[0];
              assert.equal(unresolved.enquiry_forwarding_arm_id, arm.id);
              assert.equal(unresolved.projection_state, "failed");
              assert.equal(unresolved.block_reason, "REVIEW_REQUIRED");
              assert.equal(unresolved.normalized_event.text, "STOP");
              const head = await decisions.getEnquiryInfoDecisionHead(
                scope,
                { kind: "receipt", receiptId: unresolved.id },
                query,
              );
              assert.equal(head.decision, "held");
              assert.equal(head.authorityKind, "system_policy");
              assert.equal(head.actorStaffId, null);
            },
          );
          await t.test(
            "duplicate ACK, delayed final writers, repair and manual retry cannot release a held receipt",
            async () => {
              const prior = await effects(),
                calls = ingestions;
              assert.equal((await (await receive(unknown)).json()).projection, "review_required");
              assert.equal(ingestions, calls);
              await receipts.markInboundReceipt(unresolved.id, "projected", null, { query });
              await receipts.markInboundReceipt(unresolved.id, "failed", "PROJECTION_FAILED", {
                query,
              });
              await query(
                "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '2 hours' WHERE id=$1",
                [unresolved.id],
              );
              const recovered = await receipts.recoverPendingInboundReceipts({
                query,
                project: async (event, mode, receiptContext) =>
                  ingestWoztellEvent(event, "live_webhook", transaction, {
                    signedEvent: true,
                    mode,
                    receiptContext,
                    wake: () => {},
                  }),
              });
              assert.equal(recovered.projected, 0);
              assert.equal(
                await receipts.retryInboundReceipt(
                  unresolved.id,
                  manager,
                  { requestId: randomUUID() },
                  { query },
                ),
                null,
              );
              assert.equal(
                (
                  await query("SELECT block_reason FROM whatsapp_inbound_receipts WHERE id=$1", [
                    unresolved.id,
                  ])
                )[0].block_reason,
                "REVIEW_REQUIRED",
              );
              assert.deepEqual(await effects(), prior);
            },
          );
          await t.test(
            "claimed-receipt projection propagates the same typed neutral hold",
            async () => {
              const stored = await receipts.storeInboundReceipt(
                verified(payload({ member: "owned_repair_unknown" })),
                ports,
              );
              await query(
                "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '10 minutes' WHERE id=$1",
                [stored.receiptId],
              );
              const prior = await effects();
              const result = await receipts.recoverPendingInboundReceipts({
                query,
                project: (event, mode, receiptContext) =>
                  ingestWoztellEvent(event, "live_webhook", transaction, {
                    signedEvent: true,
                    mode,
                    receiptContext,
                    wake: () => {},
                  }),
              });
              assert.equal(result.review, 1);
              assert.deepEqual(await effects(), prior);
            },
          );
          await t.test("pause preserves causal admission and the neutral hold", async () => {
            await decisions.appendEnquiryInfoDecision(
              { scope, subject: { kind: "policy" }, decision: "paused", expectedRevision: 1 },
              manager,
              ports,
            );
            await query(
              "UPDATE enquiry_notification_recipients SET enabled=false WHERE recipient_key='copy'",
            );
            const response = await receive(payload({ member: "owned_paused_unknown" }));
            assert.equal((await response.json()).projection, "review_required");
            assert.equal(
              (
                await query(
                  "SELECT enquiry_forwarding_arm_id FROM whatsapp_inbound_receipts WHERE member_id='owned_paused_unknown'",
                )
              )[0].enquiry_forwarding_arm_id,
              arm.id,
            );
          });
          await t.test(
            "clear ordinary no-phone context and full-phone new customers keep normal intake",
            async () => {
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp) VALUES('Owned ordinary','85255550601','owned_clear_customer',true) RETURNING *",
              );
              const [conversation] = await query(
                "INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id) VALUES($1,'owned_clear_customer',$2) RETURNING *",
                [contact.id, scope.channelId],
              );
              assert.equal(
                (await (await receive(payload({ member: "owned_clear_customer" }))).json())
                  .projection,
                undefined,
              );
              assert.equal(
                (
                  await query("SELECT contact_id FROM whatsapp_conversations WHERE id=$1", [
                    conversation.id,
                  ])
                )[0].contact_id,
                contact.id,
              );
              assert.equal(
                (
                  await query("SELECT opt_in_whatsapp FROM crm_contacts WHERE id=$1", [contact.id])
                )[0].opt_in_whatsapp,
                true,
              );
              assert.equal(
                (
                  await (
                    await receive(payload({ member: "owned_new_fullphone", from: "85255550602" }))
                  ).json()
                ).projection,
                undefined,
              );
              assert.ok(
                (
                  await query(
                    "SELECT id FROM crm_contacts WHERE whatsapp_member_id='owned_new_fullphone'",
                  )
                )[0],
              );
            },
          );
          await t.test(
            "a phone-looking opaque id and staff-looking toPhone cannot classify an ordinary customer as staff",
            async () => {
              await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id) VALUES('Owned numeric opaque','85255550603','85297987774')",
              );
              const prior = (await effects()).internal;
              const response = await receive(payload({ member: "85297987774", to: "85297987774" }));
              assert.equal((await response.json()).projection, undefined);
              assert.equal((await effects()).internal, prior);
              assert.ok(
                (
                  await query(
                    "SELECT id FROM whatsapp_messages WHERE woztell_member_id='85297987774'",
                  )
                )[0],
              );
            },
          );
          async function approvePhone(number, staffId) {
            const current = await decisions.getEnquiryInfoPhoneSnapshot(scope, number, query);
            return decisions.importOwnerEnquiryInfoDecision(
              {
                scope,
                subject: { kind: "recipient_phone", phone: number },
                decision: "approved",
                expectedRevision: 0,
                staffId,
                expectedProfileHash: current.profileHash,
                expectedConflictHash: current.conflictHash,
              },
              owner,
              ports,
            );
          }
          await t.test(
            "Owner phone authority with unproved old CRM member is neutral and never relabels the customer",
            async () => {
              const employee = await staff(null, "85255550501");
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp) VALUES('Owned old contact','85255550501','owned_unproved_old_member',true) RETURNING *",
              );
              const [conversation] = await query(
                "INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id) VALUES($1,'owned_unproved_old_member',$2) RETURNING *",
                [contact.id, scope.channelId],
              );
              await approvePhone("85255550501", employee.staffId);
              const prior = await effects();
              assert.equal(
                (await (await receive(payload({ member: "owned_unproved_old_member" }))).json())
                  .projection,
                "review_required",
              );
              assert.deepEqual(await effects(), prior);
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [contact.id]))[0],
                contact,
              );
              assert.deepEqual(
                (
                  await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [conversation.id])
                )[0],
                conversation,
              );
            },
          );
          let knownStaff, knownStaffHeldReceipt;
          await t.test(
            "genuine reviewed fromPhone derives its opaque binding and staff wins over old dual-role CRM",
            async () => {
              const employee = await staff(null, "85255550502");
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp) VALUES('Owned dual role','85255550502','owned_genuine_staff',true) RETURNING *",
              );
              await query(
                "INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id) VALUES($1,'owned_genuine_staff',$2)",
                [contact.id, scope.channelId],
              );
              await approvePhone("85255550502", employee.staffId);
              assert.equal(
                (await (await receive(payload({ member: "owned_genuine_staff" }))).json())
                  .projection,
                "review_required",
              );
              knownStaffHeldReceipt = (
                await query(
                  "SELECT * FROM whatsapp_inbound_receipts WHERE member_id='owned_genuine_staff' AND block_reason='REVIEW_REQUIRED'",
                )
              )[0];
              const prior = await effects();
              assert.equal(
                (
                  await (
                    await receive(payload({ member: "owned_genuine_staff", from: "85255550502" }))
                  ).json()
                ).skipped,
                "staff-internal",
              );
              knownStaff = await decisions.getEnquiryInfoDecisionHead(
                scope,
                { kind: "sender_member", memberId: "owned_genuine_staff" },
                query,
              );
              assert.equal(knownStaff.decision, "staff_bound");
              assert.equal(knownStaff.evidence.memberEvidence.kind, "accepted_ingress");
              assert.equal(
                (
                  await (
                    await receive(
                      payload({
                        member: "owned_genuine_staff",
                        text: "STOP EPWA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                      }),
                      async (statements, options) => {
                        assert.equal(
                          statements.some((s) =>
                            s.statement.includes("FROM whatsapp_link_opens o"),
                          ),
                          false,
                          "reviewed staff must isolate before customer reference lookup",
                        );
                        return transaction(statements, options);
                      },
                    )
                  ).json()
                ).skipped,
                "staff-internal",
              );
              const after = await effects();
              assert.equal(after.internal, prior.internal + 2);
              assert.equal(after.messages, prior.messages);
              assert.equal(after.jobs, prior.jobs);
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [contact.id]))[0],
                contact,
              );
            },
          );
          await t.test(
            "controlled ordinary release is a real manager decision and commits transcript without enquiry jobs",
            async () => {
              const confirmed = await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: unknown.member },
                  decision: "customer_confirmed",
                  expectedRevision: 0,
                  evidence: {
                    sourceReference: "owned:human-review",
                    statement: "Owned actual reviewer confirms ordinary customer",
                  },
                },
                manager,
                ports,
              );
              const resolution = {
                receiptId: unresolved.id,
                expectedRevision: 1,
                memberDecisionId: confirmed.id,
                resolution: "customer",
                evidence: {
                  sourceReference: "owned:review-message",
                  statement: "Owned reviewer releases this original customer transcript",
                },
              };
              await assert.rejects(resolveEnquiryInfoHeldReceipt(resolution, agent, ports));
              await assert.rejects(
                resolveEnquiryInfoHeldReceipt(resolution, { ...agent, roles: ["admin"] }, ports),
              );
              await assert.rejects(
                resolveEnquiryInfoHeldReceipt(
                  { ...resolution, expectedRevision: 2 },
                  manager,
                  ports,
                ),
                (error) => error.code === "ENQUIRY_INFO_REVISION_CONFLICT",
              );
              assert.equal(
                (
                  await decisions.getEnquiryInfoDecisionHead(
                    scope,
                    { kind: "receipt", receiptId: unresolved.id },
                    query,
                  )
                ).decision,
                "held",
              );
              const prior = await effects();
              const result = await resolveEnquiryInfoHeldReceipt(resolution, manager, ports);
              assert.equal(result.skipped, null);
              assert.equal(result.messageInserted, true);
              const after = await effects();
              assert.equal(after.contacts, prior.contacts + 1);
              assert.equal(after.messages, prior.messages + 1);
              assert.equal(after.enquiries, prior.enquiries);
              assert.equal(after.jobs, prior.jobs);
              assert.equal(after.internal, prior.internal);
              const receipt = (
                await query("SELECT * FROM whatsapp_inbound_receipts WHERE id=$1", [unresolved.id])
              )[0];
              assert.equal(receipt.projection_state, "projected");
              assert.equal(receipt.block_reason, null);
              await receipts.markInboundReceipt(unresolved.id, "failed", "PROJECTION_FAILED", {
                query,
              });
              assert.equal(
                (
                  await query(
                    "SELECT projection_state FROM whatsapp_inbound_receipts WHERE id=$1",
                    [unresolved.id],
                  )
                )[0].projection_state,
                "projected",
              );
              await assert.rejects(resolveEnquiryInfoHeldReceipt(resolution, manager, ports));
            },
          );
          await t.test(
            "a newly uncovered conflict blocks phone-only derivation while a genuine historical member remains staff",
            async () => {
              await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id) VALUES('Owned uncovered conflict','55550502','owned_uncovered_collision')",
              );
              const prior = await effects();
              assert.equal(
                (
                  await (
                    await receive(
                      payload({ member: "owned_new_unproved_collision", from: "85255550502" }),
                    )
                  ).json()
                ).projection,
                "review_required",
              );
              assert.deepEqual(await effects(), prior);
              assert.equal(
                (await (await receive(payload({ member: "owned_genuine_staff" }))).json()).skipped,
                "staff-internal",
              );
              assert.equal((await effects()).messages, prior.messages);
            },
          );
          await t.test(
            "a genuine manager-linked ordinary conversation keeps its authoritative customer despite a stale other phone match",
            async () => {
              const [old] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id) VALUES('Owned stale match','55550501','owned_linked_opaque') RETURNING *",
              );
              const [ordinary] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp) VALUES('Owned linked customer','85255550608','owned_canonical_customer',true) RETURNING *",
              );
              const [conversation] = await query(
                "INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id) VALUES($1,'owned_linked_opaque',$2) RETURNING id",
                [ordinary.id, scope.channelId],
              );
              await query(
                "INSERT INTO crm_contact_identity_reviews(reason,contact_a,contact_b,conversation_id,status,linked_contact_id,resolved_at,resolved_by) VALUES('whatsapp_identity_conflict',$1,$2,$3,'linked',$2,now(),$4)",
                [old.id, ordinary.id, conversation.id, manager.staffId],
              );
              const result = await receive(payload({ member: "owned_linked_opaque" }));
              assert.equal((await result.json()).projection, undefined);
              assert.equal(
                (
                  await query(
                    "SELECT contact_id FROM whatsapp_messages WHERE woztell_member_id='owned_linked_opaque'",
                  )
                )[0].contact_id,
                ordinary.id,
              );
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [old.id]))[0],
                old,
              );
            },
          );
          await t.test(
            "fresh final classification prevents CRM and historical enquiry backfill after a concurrent roster change",
            async () => {
              const body = payload({ member: "owned_final_guard_race", from: "85255550650" });
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id) VALUES('Owned preexisting transcript','85255550650','owned_final_guard_race') RETURNING *",
              );
              const [conversation] = await query(
                "INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id) VALUES($1,$2,$3) RETURNING id",
                [contact.id, body.member, scope.channelId],
              );
              await query(
                "INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,external_message_id,woztell_member_id,channel_id,payload) VALUES($1,$2,'inbound','TEXT',$3,$4,$5,$6,$7::jsonb)",
                [
                  conversation.id,
                  contact.id,
                  body.data.text,
                  body.messageId,
                  body.member,
                  scope.channelId,
                  JSON.stringify(body),
                ],
              );
              const prior = await effects();
              let changed = false;
              const guarded = async (statements, options) => {
                if (!changed && statements.some((s) => s.statement.includes("matched AS ("))) {
                  changed = true;
                  await staff(null, body.from);
                }
                return transaction(statements, options);
              };
              assert.equal(
                (await (await receive(body, guarded)).json()).projection,
                "review_required",
              );
              assert.equal(changed, true);
              assert.deepEqual(await effects(), prior);
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [contact.id]))[0],
                contact,
              );
            },
          );
          await t.test(
            "receipt context and opaque release tokens cannot be forged to project a different message",
            async () => {
              const row = (
                await query("SELECT * FROM whatsapp_inbound_receipts WHERE id=$1", [unresolved.id])
              )[0];
              const event = eventForReceiptProjection(
                row.normalized_event,
                row.id,
                row.event_kind,
                row.identity_key,
              );
              const prior = await effects();
              for (const change of [
                (e) => ({ ...e, text: "Changed unaccepted text" }),
                (e) => ({ ...e, woztellMemberId: "other_opaque" }),
                (e) => ({ ...e, appId: "other_app" }),
                (e) => ({ ...e, direction: "outbound" }),
              ])
                await assert.rejects(
                  ingestWoztellEvent(change(event), "live_webhook", transaction, {
                    signedEvent: true,
                    mode: "off",
                    receiptContext: { receiptId: row.id },
                  }),
                  /WA_ENQUIRY_INFO_RECEIPT_MISMATCH/,
                );
              await assert.rejects(
                ingestWoztellEvent(event, "live_webhook", transaction, {
                  signedEvent: true,
                  mode: "off",
                  receiptContext: { receiptId: row.id },
                  enquiryInfoRelease: {},
                }),
                (error) => error.code === "ENQUIRY_INFO_RELEASE_CONTEXT_INVALID",
              );
              assert.deepEqual(await effects(), prior);
            },
          );
          await t.test(
            "a held message remains held after new staff proof until explicit staff release",
            async () => {
              const member = "owned_later_proved_staff";
              await receive(payload({ member }));
              const [held] = await query(
                "SELECT * FROM whatsapp_inbound_receipts WHERE member_id=$1",
                [member],
              );
              const employee = await staff(null, "85255550503");
              await approvePhone("85255550503", employee.staffId);
              assert.equal(
                (await (await receive(payload({ member, from: "85255550503" }))).json()).skipped,
                "staff-internal",
              );
              const binding = await decisions.getEnquiryInfoDecisionHead(
                scope,
                { kind: "sender_member", memberId: member },
                query,
              );
              assert.equal(
                (
                  await query("SELECT block_reason FROM whatsapp_inbound_receipts WHERE id=$1", [
                    held.id,
                  ])
                )[0].block_reason,
                "REVIEW_REQUIRED",
              );
              const prior = await effects();
              const result = await resolveEnquiryInfoHeldReceipt(
                {
                  receiptId: held.id,
                  expectedRevision: 1,
                  memberDecisionId: binding.id,
                  resolution: "staff",
                  evidence: {
                    sourceReference: "owned:actual-inbound-proof",
                    statement: "Owned reviewer releases a proved staff message",
                  },
                },
                manager,
                ports,
              );
              assert.equal(result.skipped, "staff-internal");
              const after = await effects();
              assert.equal(after.internal, prior.internal + 1);
              assert.equal(after.contacts, prior.contacts);
              assert.equal(after.messages, prior.messages);
              assert.equal(after.jobs, prior.jobs);
              await assert.rejects(
                decisions.appendEnquiryInfoDecision(
                  {
                    scope,
                    subject: { kind: "sender_member", memberId: member },
                    decision: "customer_confirmed",
                    expectedRevision: binding.revision,
                  },
                  manager,
                  ports,
                ),
                (error) => error.code === "ENQUIRY_INFO_ACTIVE_STAFF_BINDING",
              );
            },
          );
          await t.test(
            "an identity concern appearing at customer release rolls back the release CAS and all projection effects",
            async () => {
              const member = "owned_release_race_customer";
              await receive(payload({ member }));
              const [held] = await query(
                "SELECT * FROM whatsapp_inbound_receipts WHERE member_id=$1",
                [member],
              );
              await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id) VALUES('Owned reviewed customer','85255550670',$1)",
                [member],
              );
              const confirmed = await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: member },
                  decision: "customer_confirmed",
                  expectedRevision: 0,
                  evidence: {
                    sourceReference: "owned:reviewed-association",
                    statement: "Owned manager confirms the existing actual customer",
                  },
                },
                manager,
                ports,
              );
              const prior = await effects();
              let changed = false;
              const changing = async (statements, options) => {
                if (!changed && statements.some((s) => s.statement.includes("matched AS ("))) {
                  changed = true;
                  await staff(null, "85255550670");
                }
                return transaction(statements, options);
              };
              await assert.rejects(
                resolveEnquiryInfoHeldReceipt(
                  {
                    receiptId: held.id,
                    expectedRevision: 1,
                    memberDecisionId: confirmed.id,
                    resolution: "customer",
                    evidence: {
                      sourceReference: "owned:release-race",
                      statement: "Owned attempted release invalidated by new identity concern",
                    },
                  },
                  manager,
                  { query, transaction: changing },
                ),
                (error) => error.code === "ENQUIRY_INFO_RELEASE_NOT_PROJECTED",
              );
              assert.equal(changed, true);
              assert.deepEqual(await effects(), prior);
              assert.equal(
                (
                  await decisions.getEnquiryInfoDecisionHead(
                    scope,
                    { kind: "receipt", receiptId: held.id },
                    query,
                  )
                ).decision,
                "held",
              );
              assert.equal(
                (
                  await query("SELECT block_reason FROM whatsapp_inbound_receipts WHERE id=$1", [
                    held.id,
                  ])
                )[0].block_reason,
                "REVIEW_REQUIRED",
              );
            },
          );
          await t.test(
            "other scopes and history imports retain the default customer path",
            async () => {
              const body = payload({ member: "owned_other_scope", channel: "owned_other_channel" });
              const stored = await receipts.storeInboundReceipt(verified(body), ports);
              assert.equal(stored.enquiryForwardingArmId, null);
              const event = eventForReceiptProjection(
                normalizeWoztellEvent(body),
                stored.receiptId,
                "customer_message",
                stored.identityKey,
              );
              assert.equal(
                (
                  await ingestWoztellEvent(event, "live_webhook", transaction, {
                    signedEvent: true,
                    mode: "off",
                    receiptContext: { receiptId: stored.receiptId },
                  })
                ).skipped,
                null,
              );
              assert.equal(
                (
                  await ingestWoztellEvent(
                    normalizeWoztellEvent(payload({ member: "owned_history_customer" })),
                    "history_import",
                    transaction,
                  )
                ).skipped,
                null,
              );
            },
          );
          await t.test(
            "interactive inbound replies are held and reviewer release remains transcript-only",
            async () => {
              const member = "owned_unknown_interactive";
              const body = { ...payload({ member }), type: "BUTTON" };
              const prior = await effects();
              assert.equal((await (await receive(body)).json()).projection, "review_required");
              assert.deepEqual(await effects(), prior);
              const [held] = await query(
                "SELECT * FROM whatsapp_inbound_receipts WHERE member_id=$1",
                [member],
              );
              const confirmed = await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: member },
                  decision: "customer_confirmed",
                  expectedRevision: 0,
                  evidence: { review: "Owned actual manager reviews this interactive sender" },
                },
                manager,
                ports,
              );
              const result = await resolveEnquiryInfoHeldReceipt(
                {
                  receiptId: held.id,
                  expectedRevision: 1,
                  memberDecisionId: confirmed.id,
                  resolution: "customer",
                  evidence: {
                    sourceReference: "owned:interactive-review",
                    statement: "Owned reviewer approves only the original transcript",
                  },
                },
                manager,
                ports,
              );
              assert.equal(result.messageInserted, true);
              assert.equal((await effects()).enquiries, prior.enquiries);
              assert.equal((await effects()).jobs, prior.jobs);
            },
          );
          await t.test(
            "repair applies the neutral policy to an admitted interactive reply too",
            async () => {
              const body = { ...payload({ member: "owned_repair_interactive" }), type: "BUTTON" };
              const stored = await receipts.storeInboundReceipt(
                { ...verified(body), eventKind: "unsupported" },
                ports,
              );
              await query(
                "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '10 minutes' WHERE id=$1",
                [stored.receiptId],
              );
              const prior = await effects();
              const result = await receipts.recoverPendingInboundReceipts({
                query,
                project: (event, mode, receiptContext) =>
                  ingestWoztellEvent(event, "live_webhook", transaction, {
                    signedEvent: true,
                    mode,
                    receiptContext,
                    wake: () => {},
                  }),
              });
              assert.equal(result.review, 1);
              assert.deepEqual(await effects(), prior);
              assert.equal(
                (
                  await decisions.getEnquiryInfoDecisionHead(
                    scope,
                    { kind: "receipt", receiptId: stored.receiptId },
                    query,
                  )
                ).decision,
                "held",
              );
            },
          );
          await t.test(
            "partial optional schema loss blocks admission instead of inventing a pre-arm receipt",
            async () => {
              const client = await pool.connect();
              const localQuery = async (sql, params = []) => (await client.query(sql, params)).rows;
              try {
                await client.query("BEGIN");
                await client.query(
                  "ALTER TABLE whatsapp_inbound_receipts DROP COLUMN enquiry_forwarding_arm_id",
                );
                await assert.rejects(
                  receipts.storeInboundReceipt(
                    verified(payload({ member: "owned_partial_schema" })),
                    { query: localQuery },
                  ),
                  /WA_ENQUIRY_SCHEMA_REQUIRED/,
                );
              } finally {
                await client.query("ROLLBACK");
                client.release();
              }
            },
          );
          await t.test(
            "custom query ports cannot silently admit through or release through another transaction backend",
            async () => {
              const prior = await effects();
              await assert.rejects(
                receipts.storeInboundReceipt(
                  verified(payload({ member: "owned_missing_admission_transaction" })),
                  { query },
                ),
                /WA_RECEIPT_TRANSACTION_REQUIRED/,
              );
              await assert.rejects(
                resolveEnquiryInfoHeldReceipt(
                  {
                    receiptId: unresolved.id,
                    expectedRevision: 1,
                    memberDecisionId: knownStaff.id,
                    resolution: "customer",
                    evidence: {
                      sourceReference: "owned:missing-transaction",
                      statement: "Owned custom ports must remain bound to their database",
                    },
                  },
                  manager,
                  { query },
                ),
                (error) => error.code === "ENQUIRY_INFO_RECEIPT_TRANSACTION_REQUIRED",
              );
              assert.deepEqual(await effects(), prior);
            },
          );
          await t.test(
            "default repair projection uses the supplied admission transaction and original receipt context",
            async () => {
              const stored = await receipts.storeInboundReceipt(
                verified(payload({ member: "owned_default_projector_unknown" })),
                ports,
              );
              await query(
                "UPDATE whatsapp_inbound_receipts SET updated_at=now()-interval '10 minutes' WHERE id=$1",
                [stored.receiptId],
              );
              const prior = await effects();
              const result = await receipts.recoverPendingInboundReceipts(ports);
              assert.equal(result.review, 1);
              assert.deepEqual(await effects(), prior);
              assert.equal(
                (
                  await decisions.getEnquiryInfoDecisionHead(
                    scope,
                    { kind: "receipt", receiptId: stored.receiptId },
                    query,
                  )
                ).decision,
                "held",
              );
            },
          );
          await t.test(
            "historical genuine staff concern cannot commit a customer release even after an invalidated binding and new member decision",
            async () => {
              assert.equal(
                (
                  await query("SELECT enquiry_info_member_binding_valid($1::uuid) AS valid", [
                    knownStaff.id,
                  ])
                )[0].valid,
                false,
              );
              const current = await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: "owned_genuine_staff" },
                  decision: "customer_confirmed",
                  expectedRevision: knownStaff.revision,
                  evidence: {
                    sourceReference: "owned:conflicting-human-review",
                    statement: "Owned review must not erase genuine historical staff evidence",
                  },
                },
                manager,
                ports,
              );
              const prior = await effects();
              await assert.rejects(
                resolveEnquiryInfoHeldReceipt(
                  {
                    receiptId: knownStaffHeldReceipt.id,
                    expectedRevision: 1,
                    memberDecisionId: current.id,
                    resolution: "customer",
                    evidence: {
                      sourceReference: "owned:historical-staff-release",
                      statement:
                        "Owned attempted customer release must roll back on historical staff evidence",
                    },
                  },
                  manager,
                  ports,
                ),
                (error) => error.code === "ENQUIRY_INFO_RELEASE_NOT_PROJECTED",
              );
              assert.deepEqual(await effects(), prior);
              assert.equal(
                (
                  await decisions.getEnquiryInfoDecisionHead(
                    scope,
                    { kind: "receipt", receiptId: knownStaffHeldReceipt.id },
                    query,
                  )
                ).decision,
                "held",
              );
              assert.equal(
                (
                  await query("SELECT block_reason FROM whatsapp_inbound_receipts WHERE id=$1", [
                    knownStaffHeldReceipt.id,
                  ])
                )[0].block_reason,
                "REVIEW_REQUIRED",
              );
            },
          );
          let retiredSender;
          await t.test(
            "a prior unresolved sender stays neutral after a real staff phone move and old permission retirement",
            async () => {
              const member = "owned_retired_phone_unproved",
                phone = "85255550711";
              const employee = await staff(null, phone);
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp) VALUES('Owned unresolved old context',$1,$2,true) RETURNING *",
                [phone, member],
              );
              const [conversation] = await query(
                "INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id) VALUES($1,$2,$3) RETURNING *",
                [contact.id, member, scope.channelId],
              );
              await approvePhone(phone, employee.staffId);
              const prior = await effects();
              assert.equal(
                (await (await receive(payload({ member }))).json()).projection,
                "review_required",
              );
              await query(
                "UPDATE staff_users SET phone='85255550712',whatsapp='85255550712' WHERE id=$1",
                [employee.staffId],
              );
              await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "recipient_phone", phone },
                  decision: "revoked",
                  expectedRevision: 1,
                  evidence: {
                    reason:
                      "Owned legitimate business phone retirement, no member identity resolution",
                  },
                },
                manager,
                ports,
              );
              assert.equal(
                (await (await receive(payload({ member }))).json()).projection,
                "review_required",
              );
              assert.deepEqual(await effects(), prior);
              assert.equal(
                await decisions.getEnquiryInfoDecisionHead(
                  scope,
                  { kind: "sender_member", memberId: member },
                  query,
                ),
                null,
              );
              const held = await query(
                "SELECT * FROM whatsapp_inbound_receipts WHERE app_id=$1 AND channel_id=$2 AND member_id=$3 ORDER BY received_at,id",
                [scope.appId, scope.channelId, member],
              );
              assert.equal(held.length, 2);
              assert.ok(
                held.every(
                  (r) => r.projection_state === "failed" && r.block_reason === "REVIEW_REQUIRED",
                ),
              );
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [contact.id]))[0],
                contact,
              );
              assert.deepEqual(
                (
                  await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [conversation.id])
                )[0],
                conversation,
              );
              retiredSender = { member, held };
            },
          );
          await t.test(
            "only the current real customer review clears prior concern; revocation blocks later replies and stale release",
            async () => {
              const { member, held } = retiredSender;
              const confirmed = await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: member },
                  decision: "customer_confirmed",
                  expectedRevision: 0,
                  evidence: {
                    sourceReference: "owned:current-customer-review",
                    statement:
                      "Owned actual manager confirms this exact previously unresolved customer",
                  },
                },
                manager,
                ports,
              );
              const prior = await effects();
              for (const receipt of held) {
                const outcome = await resolveEnquiryInfoHeldReceipt(
                  {
                    receiptId: receipt.id,
                    expectedRevision: 1,
                    memberDecisionId: confirmed.id,
                    resolution: "customer",
                    evidence: {
                      sourceReference: "owned:controlled-retired-phone-review",
                      statement: "Owned real reviewer releases only this original transcript",
                    },
                  },
                  manager,
                  ports,
                );
                assert.equal(outcome.messageInserted, true);
              }
              const released = await effects();
              assert.equal(released.messages, prior.messages + 2);
              assert.equal(released.enquiries, prior.enquiries);
              assert.equal(released.jobs, prior.jobs);
              assert.equal(released.internal, prior.internal);
              assert.equal(
                (await (await receive(payload({ member }))).json()).projection,
                undefined,
              );
              const ordinary = await effects();
              assert.equal(ordinary.messages, released.messages + 1);
              await decisions.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: member },
                  decision: "revoked",
                  expectedRevision: confirmed.revision,
                  evidence: { reason: "Owned current member review withdrawn" },
                },
                manager,
                ports,
              );
              assert.equal(
                (await (await receive(payload({ member }))).json()).projection,
                "review_required",
              );
              assert.deepEqual(await effects(), ordinary);
              const [currentHeld] = await query(
                "SELECT * FROM whatsapp_inbound_receipts WHERE app_id=$1 AND channel_id=$2 AND member_id=$3 AND block_reason='REVIEW_REQUIRED'",
                [scope.appId, scope.channelId, member],
              );
              assert.ok(currentHeld);
              await assert.rejects(
                resolveEnquiryInfoHeldReceipt(
                  {
                    receiptId: currentHeld.id,
                    expectedRevision: 1,
                    memberDecisionId: confirmed.id,
                    resolution: "customer",
                    evidence: {
                      sourceReference: "owned:stale-customer-review",
                      statement: "Owned revoked customer head must not release a new held receipt",
                    },
                  },
                  manager,
                  ports,
                ),
              );
              assert.deepEqual(await effects(), ordinary);
              assert.equal(
                (
                  await decisions.getEnquiryInfoDecisionHead(
                    scope,
                    { kind: "receipt", receiptId: currentHeld.id },
                    query,
                  )
                ).decision,
                "held",
              );
            },
          );
          await t.test(
            "prior held member concern is isolated to its actual app and channel even in another armed scope",
            async () => {
              for (const other of [
                { ...scope, appId: "owned_retirement_other_app" },
                { ...scope, channelId: "owned_retirement_other_channel" },
              ]) {
                const [proof] = await query(
                  "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb) RETURNING id",
                  [
                    randomUUID(),
                    JSON.stringify({
                      channel: { configuredChannelId: other.channelId },
                      infoForwarding: { ready: true, purpose: "enq_forward_info", ...other },
                    }),
                  ],
                );
                const [copy] = await query(
                  "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
                );
                await transaction(
                  [
                    ...decisions.enquiryInfoLockStatements(other),
                    {
                      statement:
                        "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,destination_reference=phone,verified_at=now(),verification_ref='owned-other-scope-proof',permission_granted=true,permission_ref='owned-other-scope-authority' WHERE recipient_key='copy'",
                      params: [other.channelId],
                    },
                    decisions.buildEnquiryInfoDecisionStatement(
                      {
                        scope: other,
                        subject: { kind: "policy" },
                        decision: "armed",
                        expectedRevision: 0,
                        evidence: { providerProofAuditId: proof.id, copyVersion: copy.version + 1 },
                      },
                      manager,
                    ),
                  ],
                  { isolationLevel: "ReadCommitted" },
                );
                const before = await effects();
                const response = await receive(
                  payload({
                    member: retiredSender.member,
                    app: other.appId,
                    channel: other.channelId,
                  }),
                  transaction,
                  other,
                );
                assert.equal((await response.json()).projection, undefined);
                assert.equal((await effects()).messages, before.messages + 1);
                const [accepted] = await query(
                  "SELECT enquiry_forwarding_arm_id,projection_state,block_reason FROM whatsapp_inbound_receipts WHERE app_id=$1 AND channel_id=$2 AND member_id=$3",
                  [other.appId, other.channelId, retiredSender.member],
                );
                assert.ok(accepted.enquiry_forwarding_arm_id);
                assert.equal(accepted.projection_state, "projected");
                assert.equal(accepted.block_reason, null);
              }
            },
          );
          assert.equal(network.mock.callCount(), 0);
        },
        { migrationVersions: MIGRATION_VERSIONS.filter((version) => version !== VERSION) },
      );
    } finally {
      mock.restoreAll();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);
