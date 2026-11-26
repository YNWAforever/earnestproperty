import { seedOwnedEnquiryCopy } from "../../../scripts/acceptance/owned-enquiry-copy.mjs";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { migrationStatements } from "../../../scripts/acceptance/migrated-schema.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { staffDestinationNotACustomer } from "../whatsapp-enquiries/staff-recipient-guard.ts";
const copyVersion = "20261126000000_staff_enquiry_copy.sql";
const version = "20261116010000_enquiry_information_scope.sql";
const scope = { appId: "owned_info_app", channelId: "owned_info_channel" };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const owner = {
  goalId: "owned-informational-goal",
  sourceReference: "owned:owner-instruction",
  sourceSha256: sha("owned owner source"),
  receivedAt: "2026-01-01T00:00:00Z",
  recorderReference: "owned:operator-record",
  statement: "Owned owner confirms this current notification controller only.",
};
const code = (expected) => (error) =>
  error?.code === expected || error?.message?.includes(expected);

// Every instruction, session, proof and provider identity is an OWNED fixture. No
// external service, production connection, authentication session or live import.
test(
  "owned informational decision foundation uses ordered migrations and truthful authority",
  { timeout: 120000 },
  async (t) => {
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("External network forbidden");
    });
    try {
      await withOwnedPostgres(
        async ({ query, transaction, pool }) => {
          await mockOwnedServerDb(mock, query, transaction);
          const api = await import("./enquiry-info-decisions.server.ts");
          const ports = { query, transaction };
          async function receipt({
            app = scope.appId,
            channel = scope.channelId,
            member = "owned_member_opaque",
            from = "85292786562",
            to = "85224962283",
            arm = null,
            direction = "inbound",
            origin = "live_webhook",
          } = {}) {
            const id = randomUUID(),
              identity = `owned-receipt-${id}`;
            const event = {
              appId: app,
              channelId: channel,
              woztellMemberId: member,
              fromPhone: from,
              toPhone: to,
              direction,
              externalMessageId: identity,
              payload: { data: { text: "Owned proof message" } },
            };
            const [row] = await query(
              "INSERT INTO whatsapp_inbound_receipts(id,tenant_key,provider,app_id,channel_id,member_id,event_kind,origin,identity_key,similarity_key,normalized_event,body_digest,capture_mode,effects_eligible,received_at,projection_state) VALUES($1,$2,'woztell',$3,$4,$5,'customer_message',$6,$7,$7,$8::jsonb,$9,'observe',false,now(),'pending') RETURNING *",
              [
                id,
                `woztell:${app}`,
                app,
                channel,
                member,
                origin,
                identity,
                JSON.stringify(event),
                sha(identity),
              ],
            );
            // Arm is captured by INSERT, never retroactively attached. Recreate only the
            // owned fixture INSERT when an admitted witness is required.
            if (arm) {
              await query("DELETE FROM whatsapp_inbound_receipts WHERE id=$1", [id]);
              return (
                await query(
                  "INSERT INTO whatsapp_inbound_receipts(id,tenant_key,provider,app_id,channel_id,member_id,event_kind,origin,identity_key,similarity_key,normalized_event,body_digest,capture_mode,effects_eligible,received_at,projection_state,enquiry_forwarding_arm_id) VALUES($1,$2,'woztell',$3,$4,$5,'customer_message',$6,$7,$7,$8::jsonb,$9,'observe',false,now(),'pending',$10) RETURNING *",
                  [
                    id,
                    `woztell:${app}`,
                    app,
                    channel,
                    member,
                    origin,
                    identity,
                    JSON.stringify(event),
                    sha(identity),
                    arm,
                  ],
                )
              )[0];
            }
            return row;
          }
          let preArm;
          await t.test(
            "absent schema is explicit, migration seeds no arm or review, older receipts stay unarmed",
            async () => {
              assert.equal(await api.enquiryInfoSchemaAvailable(query), false);
              await assert.rejects(
                api.getEnquiryInfoLatestArmId(scope, query),
                code("ENQUIRY_INFO_SCHEMA_UNAVAILABLE"),
              );
              preArm = await receipt();
              await query(
                "UPDATE enquiry_notification_recipients SET enabled_since=now()-interval '30 days' WHERE recipient_key='copy'",
              );
              await transaction(migrationStatements(version).map((statement) => ({ statement })));
              await query("INSERT INTO app_migrations(version) VALUES($1)", [version]);
              await transaction(
                migrationStatements(copyVersion).map((statement) => ({ statement })),
              );
              await query("INSERT INTO app_migrations(version) VALUES($1)", [copyVersion]);
              await seedOwnedEnquiryCopy(query);
              assert.equal(await api.enquiryInfoSchemaAvailable(query), true);
              assert.equal(
                (await query("SELECT count(*)::int n FROM enquiry_forwarding_decisions"))[0].n,
                0,
              );
              assert.equal(await api.getEnquiryInfoLatestArmId(scope, query), null);
              assert.equal(
                (
                  await query(
                    "SELECT enquiry_forwarding_arm_id FROM whatsapp_inbound_receipts WHERE id=$1",
                    [preArm.id],
                  )
                )[0].enquiry_forwarding_arm_id,
                null,
              );
            },
          );
          async function staff({
            id = randomUUID(),
            role,
            active = true,
            publicProfile = false,
            number = null,
          } = {}) {
            await query(
              "INSERT INTO staff_users(id,auth_user_id,name_zh,active,show_on_website,phone,whatsapp) VALUES($1,$2,'Owned info colleague',$3,$4,$5,$5)",
              [id, `owned-info-${id}`, active, publicProfile, number],
            );
            if (role)
              await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [id, role]);
            return { staffId: id, roles: role ? [role] : [] };
          }
          const admin = await staff({ role: "admin" }),
            manager = await staff({ role: "manager" }),
            agent = await staff({ role: "agent" }),
            inactive = await staff({ role: "admin", active: false });
          const employee = await staff({ publicProfile: true, number: "92786562" }),
            target = "85292786562";
          const [customer] = await query(
            "INSERT INTO crm_contacts(name,source,normalized_phone,whatsapp_member_id,opt_in_whatsapp,opted_out_whatsapp) VALUES('Owned employee customer history','whatsapp',$1,'owned_old_crm_member',false,true) RETURNING *",
            [target],
          );
          const [conversation] = await query(
            "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,assigned_agent_id,assignment_lock) VALUES($1,$2,'owned_old_crm_member',$3,true) RETURNING *",
            [customer.id, scope.channelId, manager.staffId],
          );
          const initialRoles = await query("SELECT * FROM staff_roles ORDER BY staff_user_id,role");
          const legacy = async (number) =>
            (
              await query(
                `SELECT ${staffDestinationNotACustomer("r")} AND ${staffDestinationNotACustomer("r", "phone")} AS allowed FROM (SELECT $1::text AS phone,$1::text AS destination_reference,$2::text AS channel_id) r`,
                [number, scope.channelId],
              )
            )[0].allowed;
          const count = async () =>
            (await query("SELECT count(*)::int n FROM enquiry_forwarding_decisions"))[0].n;
          const snapshot = () => api.getEnquiryInfoPhoneSnapshot(scope, target, query);
          async function approve({
            expectedRevision = 0,
            actor = null,
            source = owner,
            number = target,
            staffId = employee.staffId,
          } = {}) {
            const current = await api.getEnquiryInfoPhoneSnapshot(scope, number, query);
            const input = {
              scope,
              subject: { kind: "recipient_phone", phone: number },
              decision: "approved",
              expectedRevision,
              staffId,
              expectedProfileHash: current.profileHash,
              expectedConflictHash: current.conflictHash,
            };
            return actor
              ? api.appendEnquiryInfoDecision(input, actor, ports)
              : api.importOwnerEnquiryInfoDecision(input, source, ports);
          }
          let approved;
          await t.test(
            "Owner phone authority is truthful, exact and independent of member/registration claims",
            async () => {
              const before = await snapshot();
              assert.equal(before.originalGuardAllows, false);
              assert.equal(before.eligible, true);
              approved = await approve();
              assert.equal(approved.authorityKind, "owner_instruction");
              assert.equal(approved.actorStaffId, null);
              assert.equal(approved.memberId, null);
              assert.equal(approved.evidence.ownerInstruction.statement, owner.statement);
              assert.equal(approved.conflictHash, before.conflictHash);
              assert.equal(
                await legacy(target),
                false,
                "legacy D11 is unchanged after purpose review",
              );
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM enquiry_forwarding_decisions WHERE subject_kind='sender_member'",
                  )
                )[0].n,
                0,
              );
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [customer.id]))[0],
                customer,
              );
              assert.deepEqual(
                (
                  await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [conversation.id])
                )[0],
                conversation,
              );
              assert.deepEqual(
                await query("SELECT * FROM staff_roles ORDER BY staff_user_id,role"),
                initialRoles,
              );
            },
          );
          await t.test(
            "staff authority rechecks current DB roles; clients cannot choose owner/system actors",
            async () => {
              for (const actor of [
                { ...agent, roles: ["admin"] },
                { ...inactive, roles: ["admin"] },
                { staffId: randomUUID(), roles: ["admin"] },
              ]) {
                const before = await count();
                await assert.rejects(
                  api.appendEnquiryInfoDecision(
                    { scope, subject: { kind: "policy" }, decision: "paused", expectedRevision: 0 },
                    actor,
                    ports,
                  ),
                  code("ENQUIRY_INFO_REVIEWER_FORBIDDEN"),
                );
                assert.equal(await count(), before);
              }
              await assert.rejects(
                api.appendEnquiryInfoDecision(
                  {
                    scope,
                    subject: { kind: "policy" },
                    decision: "paused",
                    expectedRevision: 0,
                    authorityKind: "owner_instruction",
                  },
                  admin,
                  ports,
                ),
                (error) => error.name === "ZodError",
              );
              await assert.rejects(
                api.appendEnquiryInfoDecision(
                  { scope, subject: { kind: "policy" }, decision: "armed", expectedRevision: 0 },
                  admin,
                  ports,
                ),
                code("ENQUIRY_INFO_ATOMIC_ARM_REQUIRED"),
              );
              await assert.rejects(
                api.importOwnerEnquiryInfoDecision(
                  { scope, subject: { kind: "policy" }, decision: "armed", expectedRevision: 0 },
                  owner,
                  ports,
                ),
                code("ENQUIRY_INFO_OWNER_IMPORT_SCOPE_INVALID"),
              );
              await assert.rejects(
                api.importOwnerEnquiryInfoDecision(
                  {
                    scope,
                    subject: { kind: "recipient_phone", phone: target },
                    decision: "revoked",
                    expectedRevision: 1,
                  },
                  { ...owner, receivedAt: "2999-01-01T00:00:00Z" },
                  ports,
                ),
                code("ENQUIRY_INFO_OWNER_AUTHORITY_REQUIRED"),
              );
            },
          );
          await t.test(
            "ledger is append-only, CAS revisions and scoped relationships cannot be forged",
            async () => {
              await assert.rejects(
                query("UPDATE enquiry_forwarding_decisions SET decision='revoked' WHERE id=$1", [
                  approved.id,
                ]),
                /ENQUIRY_INFO_APPEND_ONLY/,
              );
              await assert.rejects(
                query("DELETE FROM enquiry_forwarding_decisions WHERE id=$1", [approved.id]),
                /ENQUIRY_INFO_APPEND_ONLY/,
              );
              await assert.rejects(approve(), code("ENQUIRY_INFO_REVISION_CONFLICT"));
              const invalid = api.buildEnquiryInfoDecisionStatement(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: "85292786562" },
                  decision: "staff_bound",
                  phone: target,
                  relatedDecisionId: approved.id,
                  expectedRevision: 0,
                  memberEvidence: {
                    kind: "provider_audit",
                    auditId: randomUUID(),
                    proofHash: sha("not real provider proof"),
                  },
                },
                admin,
              );
              await assert.rejects(
                transaction([
                  ...api.enquiryInfoLockStatements(scope, [
                    { kind: "sender_member", memberId: "85292786562" },
                  ]),
                  invalid,
                ]),
                /ENQUIRY_INFO_MEMBER_BINDING_UNPROVED/,
              );
              await assert.rejects(
                query(
                  "INSERT INTO enquiry_forwarding_decisions(app_id,channel_id,subject_kind,subject_key,revision,decision,phone,profile_hash,conflict_hash,authority_kind,evidence) VALUES($1,$2,'recipient_phone','85292786562',1,'approved','92786562',$3,$3,'system_policy','{}')",
                  [scope.appId, scope.channelId, sha("bad")],
                ),
                /ENQUIRY_INFO_/,
              );
              const other = { appId: "owned_other_app", channelId: "owned_other_channel" };
              const cross = api.buildEnquiryInfoDecisionStatement(
                {
                  scope: other,
                  subject: { kind: "sender_member", memberId: "owned_cross_member" },
                  decision: "staff_bound",
                  phone: target,
                  relatedDecisionId: approved.id,
                  expectedRevision: 0,
                  memberEvidence: { kind: "accepted_ingress", receiptId: preArm.id },
                },
                admin,
              );
              await assert.rejects(
                transaction([...api.enquiryInfoLockStatements(other), cross]),
                /ENQUIRY_INFO_RELATED_SCOPE_MISMATCH/,
              );
            },
          );
          await t.test(
            "snapshot enumeration has exact D11 parity for normalized, member and channel/suffix variants",
            async () => {
              const number = "85297987775";
              for (const value of [
                "97987775",
                "85297987775",
                "0085297987775",
                "+852 9798 7775",
                "861397987775",
              ]) {
                const [contact] = await query(
                  "INSERT INTO crm_contacts(name,normalized_phone) VALUES('Owned parity',$1) RETURNING id",
                  [value],
                );
                try {
                  const s = await api.getEnquiryInfoPhoneSnapshot(scope, number, query);
                  assert.equal(s.originalGuardAllows, await legacy(number));
                  assert.equal(s.originalGuardAllows, false);
                } finally {
                  await query("DELETE FROM crm_contacts WHERE id=$1", [contact.id]);
                }
              }
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone) VALUES('Owned channel parity','85298882222') RETURNING id",
              );
              const [conv] = await query(
                "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id) VALUES($1,'other-channel','0085297987775') RETURNING id",
                [contact.id],
              );
              try {
                assert.equal(
                  (await api.getEnquiryInfoPhoneSnapshot(scope, number, query)).originalGuardAllows,
                  await legacy(number),
                );
                assert.equal(await legacy(number), true);
                await query("UPDATE whatsapp_conversations SET channel_id=$2 WHERE id=$1", [
                  conv.id,
                  scope.channelId,
                ]);
                assert.equal(
                  (await api.getEnquiryInfoPhoneSnapshot(scope, number, query)).originalGuardAllows,
                  await legacy(number),
                );
                assert.equal(await legacy(number), false);
              } finally {
                await query("DELETE FROM whatsapp_conversations WHERE id=$1", [conv.id]);
                await query("DELETE FROM crm_contacts WHERE id=$1", [contact.id]);
              }
            },
          );
          await t.test(
            "new conflicts, changed profiles and stale previews invalidate exact reviews",
            async () => {
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                true,
              );
              const before = await snapshot();
              const [extra] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone) VALUES('Owned new conflicting identity','92786562') RETURNING id",
              );
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                false,
              );
              await assert.rejects(
                api.importOwnerEnquiryInfoDecision(
                  {
                    scope,
                    subject: { kind: "recipient_phone", phone: target },
                    decision: "approved",
                    expectedRevision: 1,
                    staffId: employee.staffId,
                    expectedProfileHash: before.profileHash,
                    expectedConflictHash: before.conflictHash,
                  },
                  owner,
                  ports,
                ),
                code("ENQUIRY_INFO_IDENTITY_CHANGED"),
              );
              await query("DELETE FROM crm_contacts WHERE id=$1", [extra.id]);
              await query("UPDATE staff_users SET show_on_website=false WHERE id=$1", [
                employee.staffId,
              ]);
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                false,
              );
              await query("UPDATE staff_users SET show_on_website=true WHERE id=$1", [
                employee.staffId,
              ]);
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                true,
              );
            },
          );
          await t.test(
            "linked conversation identity and permitted public phone changes invalidate the reviewed packet",
            async () => {
              await query("UPDATE whatsapp_conversations SET woztell_member_id=$2 WHERE id=$1", [
                conversation.id,
                "owned_changed_linked_member",
              ]);
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                false,
              );
              await query("UPDATE whatsapp_conversations SET woztell_member_id=$2 WHERE id=$1", [
                conversation.id,
                conversation.woztell_member_id,
              ]);
              await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                employee.staffId,
                "98889999",
              ]);
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                false,
              );
              await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                employee.staffId,
                "92786562",
              ]);
              assert.equal(
                (
                  await query("SELECT enquiry_info_phone_approval_valid($1) AS valid", [
                    approved.id,
                  ])
                )[0].valid,
                true,
              );
            },
          );
          await t.test(
            "photographed manager and public Sales aliases remain one physical reviewed phone without login roles",
            async () => {
              const id = "fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2",
                number = "85291005322";
              await staff({ id, publicProfile: true, number });
              const current = await api.getEnquiryInfoPhoneSnapshot(scope, number, query);
              assert.deepEqual(
                current.identitySnapshot.recipients.map((value) => value.key),
                ["manager:2", `sales:${id}`],
              );
              const review = await approve({ number, staffId: id });
              assert.equal(review.phone, number);
              assert.equal(review.memberId, null);
              assert.equal(
                (
                  await query("SELECT count(*)::int n FROM staff_roles WHERE staff_user_id=$1", [
                    id,
                  ])
                )[0].n,
                0,
              );
            },
          );
          let bound, proofReceipt;
          await t.test(
            "genuine scoped accepted-ingress evidence binds an opaque member, old CRM and toPhone do not",
            async () => {
              proofReceipt = await receipt({ member: "owned_genuine_opaque_member", from: target });
              const input = {
                scope,
                subject: { kind: "sender_member", memberId: proofReceipt.member_id },
                decision: "staff_bound",
                expectedRevision: 0,
                phone: target,
                staffId: employee.staffId,
                relatedDecisionId: approved.id,
                memberEvidence: { kind: "accepted_ingress", receiptId: proofReceipt.id },
              };
              bound = await api.importOwnerEnquiryInfoDecision(input, owner, ports);
              assert.equal(bound.memberId, "owned_genuine_opaque_member");
              assert.notEqual(bound.memberId, target);
              assert.equal(bound.relatedDecisionId, approved.id);
              const bad = await receipt({ member: "owned_to_phone_only", from: null, to: target });
              await assert.rejects(
                api.appendEnquiryInfoDecision(
                  {
                    ...input,
                    subject: { kind: "sender_member", memberId: bad.member_id },
                    memberEvidence: { kind: "accepted_ingress", receiptId: bad.id },
                  },
                  admin,
                  ports,
                ),
                code("ENQUIRY_INFO_MEMBER_BINDING_UNPROVED"),
              );
              await assert.rejects(
                api.appendEnquiryInfoDecision(
                  {
                    scope,
                    subject: { kind: "sender_member", memberId: bound.memberId },
                    decision: "customer_confirmed",
                    expectedRevision: 1,
                  },
                  admin,
                  ports,
                ),
                code("ENQUIRY_INFO_ACTIVE_STAFF_BINDING"),
              );
            },
          );
          await t.test(
            "provider proof must be protected, complete, current and match exact app/channel/phone/member",
            async () => {
              for (const variant of [
                "missing",
                "incomplete",
                "stale",
                "future",
                "wrong-app",
                "old-with-receipt",
                "info-app",
                "good",
              ]) {
                const member = `owned_bsp_${variant.replace("-", "_")}`,
                  proofHash = sha(member),
                  auditId = randomUUID();
                if (variant !== "missing")
                  await query(
                    "INSERT INTO audit_logs(id,action,subject_type,subject_id,metadata,created_at) VALUES($1,'whatsapp.enquiry_forwarding.provider_checked','ops_job',$2,$3::jsonb,now()-$4::interval)",
                    [
                      auditId,
                      randomUUID(),
                      JSON.stringify({
                        channel: {
                          configuredChannelId: scope.channelId,
                          appId:
                            variant === "old-with-receipt" || variant === "info-app"
                              ? undefined
                              : variant === "wrong-app"
                                ? "different-app"
                                : scope.appId,
                        },
                        ...(variant === "info-app"
                          ? { infoForwarding: { appId: scope.appId } }
                          : {}),
                        members: {
                          checked: true,
                          complete: variant !== "incomplete",
                          matched: [{ phone: target, memberId: member, proofHash }],
                        },
                      }),
                      variant === "stale"
                        ? "25 hours"
                        : variant === "future"
                          ? "-2 hours"
                          : "0 seconds",
                    ],
                  );
                const input = {
                  scope,
                  subject: { kind: "sender_member", memberId: member },
                  decision: "staff_bound",
                  expectedRevision: 0,
                  phone: target,
                  staffId: employee.staffId,
                  relatedDecisionId: approved.id,
                  memberEvidence: {
                    kind: "provider_audit",
                    auditId,
                    proofHash,
                    ...(variant === "old-with-receipt"
                      ? { receiptId: (await receipt({ member, from: target })).id }
                      : {}),
                  },
                };
                if (["good", "old-with-receipt", "info-app"].includes(variant))
                  assert.equal(
                    (await api.appendEnquiryInfoDecision(input, manager, ports)).memberId,
                    member,
                  );
                else
                  await assert.rejects(
                    api.appendEnquiryInfoDecision(input, manager, ports),
                    code("ENQUIRY_INFO_MEMBER_BINDING_UNPROVED"),
                  );
              }
            },
          );
          let arm;
          async function atomicArm(expectedRevision) {
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
            const armInput = {
              scope,
              subject: { kind: "policy" },
              decision: "armed",
              expectedRevision,
              evidence: { providerProofAuditId: proof.id, copyVersion: copy.version + 1 },
            };
            const results = await transaction(
              [
                ...api.enquiryInfoLockStatements(scope, [{ kind: "policy" }]),
                {
                  statement:
                    "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,destination_reference=phone,verified_at=now(),verification_ref='owned-info-proof',permission_granted=true,permission_ref='owned-info-business-authority' WHERE recipient_key='copy'",
                  params: [scope.channelId],
                },
                api.buildEnquiryInfoDecisionStatement(armInput, admin),
              ],
              { isolationLevel: "ReadCommitted" },
            );
            return results.at(-1)[0];
          }
          await t.test(
            "arm requires atomic real enable/proof; admission witness is immutable, scoped and historical through pause",
            async () => {
              const bad = api.buildEnquiryInfoDecisionStatement(
                { scope, subject: { kind: "policy" }, decision: "armed", expectedRevision: 0 },
                admin,
              );
              await assert.rejects(
                transaction([...api.enquiryInfoLockStatements(scope), bad]),
                /ENQUIRY_INFO_ATOMIC_ARM_CONTEXT_REQUIRED/,
              );
              assert.equal(await api.getEnquiryInfoLatestArmId(scope, query), null);
              arm = await atomicArm(0);
              assert.equal(await api.getEnquiryInfoLatestArmId(scope, query), arm.id);
              assert.equal(
                (
                  await query("SELECT enquiry_info_recipient_allowed($1,$2,$3) AS allowed", [
                    scope.appId,
                    scope.channelId,
                    target,
                  ])
                )[0].allowed,
                true,
              );
              const admitted = await receipt({ arm: arm.id });
              await assert.rejects(
                query(
                  "UPDATE whatsapp_inbound_receipts SET enquiry_forwarding_arm_id=NULL WHERE id=$1",
                  [admitted.id],
                ),
                /ENQUIRY_INFO_RECEIPT_ARM_IMMUTABLE/,
              );
              await assert.rejects(
                query(
                  "UPDATE whatsapp_inbound_receipts SET enquiry_forwarding_arm_id=$2 WHERE id=$1",
                  [preArm.id, arm.id],
                ),
                /ENQUIRY_INFO_RECEIPT_ARM_IMMUTABLE/,
              );
              await assert.rejects(
                receipt({ app: "other-app", arm: arm.id }),
                /ENQUIRY_INFO_RECEIPT_ARM_SCOPE_MISMATCH/,
              );
              await api.appendEnquiryInfoDecision(
                { scope, subject: { kind: "policy" }, decision: "paused", expectedRevision: 1 },
                admin,
                ports,
              );
              assert.equal(await api.getEnquiryInfoLatestArmId(scope, query), arm.id);
              assert.equal(
                (
                  await query("SELECT enquiry_info_recipient_allowed($1,$2,$3) AS allowed", [
                    scope.appId,
                    scope.channelId,
                    target,
                  ])
                )[0].allowed,
                false,
              );
              assert.equal((await receipt({ arm: arm.id })).enquiry_forwarding_arm_id, arm.id);
            },
          );
          await t.test(
            "system holds are idempotent; release needs a real current review and creates no customer projection",
            async () => {
              const unresolved = await receipt({
                member: "owned_unknown_opaque",
                from: null,
                arm: arm.id,
              });
              const hold = api.buildEnquiryInfoSystemHoldStatement(scope, unresolved.id, {
                subreason: "owned-unknown",
              });
              const locks = api.enquiryInfoLockStatements(scope, [
                { kind: "receipt", receiptId: unresolved.id },
              ]);
              const held = (await transaction([...locks, hold])).at(-1)[0];
              assert.equal(held.authority_kind, "system_policy");
              assert.equal(held.actor_staff_id, null);
              assert.equal(held.decision, "held");
              assert.equal((await transaction([...locks, hold])).at(-1)[0].id, held.id);
              await assert.rejects(
                api.appendEnquiryInfoDecision(
                  {
                    scope,
                    subject: { kind: "receipt", receiptId: unresolved.id },
                    decision: "released_customer",
                    expectedRevision: 1,
                  },
                  admin,
                  ports,
                ),
                code("ENQUIRY_INFO_RELEASE_REVIEW_REQUIRED"),
              );
              const confirmed = await api.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "sender_member", memberId: unresolved.member_id },
                  decision: "customer_confirmed",
                  expectedRevision: 0,
                  evidence: { review: "Owned actual human identity review" },
                },
                manager,
                ports,
              );
              const released = await api.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "receipt", receiptId: unresolved.id },
                  decision: "released_customer",
                  expectedRevision: 1,
                  relatedDecisionId: confirmed.id,
                },
                manager,
                ports,
              );
              assert.equal(released.authorityKind, "staff_session");
              assert.equal(released.actorStaffId, manager.staffId);
              await assert.rejects(
                transaction([...locks, hold]),
                /ENQUIRY_INFO_RECEIPT_ALREADY_DECIDED/,
              );
              assert.equal(
                (
                  await query(
                    "SELECT projection_state FROM whatsapp_inbound_receipts WHERE id=$1",
                    [unresolved.id],
                  )
                )[0].projection_state,
                "pending",
                "foundation does not project or change receipt state",
              );
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [customer.id]))[0],
                customer,
              );
              assert.deepEqual(
                (
                  await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [conversation.id])
                )[0],
                conversation,
              );
            },
          );
          await t.test(
            "system binding derives only from reviewed phone plus genuine inbound evidence and retains snapshot fences",
            async () => {
              const actual = await receipt({
                member: "owned_fresh_opaque",
                from: target,
                arm: arm.id,
              });
              const stmt = api.buildEnquiryInfoDerivedBindingStatement(
                scope,
                actual.id,
                approved.id,
              );
              const keys = api.enquiryInfoLockStatements(
                scope,
                [
                  { kind: "sender_member", memberId: actual.member_id },
                  { kind: "recipient_phone", phone: target },
                ],
                [`woztell-member:${actual.member_id}`, `woztell-phone:${target}`],
              );
              const derived = (await transaction([...keys, stmt])).at(-1)[0];
              assert.equal(derived.authority_kind, "system_policy");
              assert.equal(derived.related_decision_id, approved.id);
              assert.equal((await transaction([...keys, stmt])).at(-1)[0].id, derived.id);
              const bad = await receipt({
                member: "owned_unproved",
                from: null,
                to: target,
                arm: arm.id,
              });
              await assert.rejects(
                transaction([
                  ...api.enquiryInfoLockStatements(scope),
                  api.buildEnquiryInfoDerivedBindingStatement(scope, bad.id, approved.id),
                ]),
                /ENQUIRY_INFO_MEMBER_BINDING_UNPROVED/,
              );
              const staffHold = api.buildEnquiryInfoSystemHoldStatement(scope, actual.id, {
                subreason: "owned-review-staff-resolution",
              });
              await transaction([
                ...api.enquiryInfoLockStatements(scope, [
                  { kind: "receipt", receiptId: actual.id },
                ]),
                staffHold,
              ]);
              const releasedStaff = await api.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "receipt", receiptId: actual.id },
                  decision: "released_staff",
                  expectedRevision: 1,
                  relatedDecisionId: derived.id,
                },
                manager,
                ports,
              );
              assert.equal(releasedStaff.decision, "released_staff");
              assert.equal(releasedStaff.relatedDecisionId, derived.id);
              const revoked = await api.appendEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "recipient_phone", phone: target },
                  decision: "revoked",
                  expectedRevision: 1,
                },
                admin,
                ports,
              );
              assert.equal(revoked.revision, 2);
              assert.equal(revoked.previousDecisionId, approved.id);
              assert.equal(
                (
                  await query("SELECT enquiry_info_member_binding_valid($1) AS valid", [derived.id])
                )[0].valid,
                false,
              );
              await assert.rejects(
                transaction([...keys, stmt]),
                /ENQUIRY_INFO_MEMBER_BINDING_UNPROVED/,
              );
            },
          );
          await t.test(
            "concurrent CAS has one winner; reads after a policy-lock wait see the newly committed head",
            async () => {
              const number = "85297987775",
                s = await api.getEnquiryInfoPhoneSnapshot(scope, number, query);
              const input = {
                scope,
                subject: { kind: "recipient_phone", phone: number },
                decision: "approved",
                expectedRevision: 0,
                expectedProfileHash: s.profileHash,
                expectedConflictHash: s.conflictHash,
              };
              const results = await Promise.allSettled(
                [1, 2].map(() => api.appendEnquiryInfoDecision(input, admin, ports)),
              );
              assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
              assert.equal(results.filter((r) => r.status === "rejected").length, 1);
              const blocker = await pool.connect(),
                waiter = await pool.connect();
              try {
                await blocker.query("BEGIN");
                await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
                  api.enquiryInfoPolicyLockKey(scope),
                ]);
                await waiter.query("BEGIN ISOLATION LEVEL READ COMMITTED");
                const waiting = waiter.query(
                  "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                  [api.enquiryInfoPolicyLockKey(scope)],
                );
                const revoke = api.buildEnquiryInfoDecisionStatement(
                  { scope, subject: { kind: "policy" }, decision: "revoked", expectedRevision: 2 },
                  admin,
                );
                await blocker.query(revoke.statement, revoke.params);
                await blocker.query("COMMIT");
                await waiting;
                const observed = (
                  await waiter.query("SELECT * FROM enquiry_info_head($1,$2,'policy','policy')", [
                    scope.appId,
                    scope.channelId,
                  ])
                ).rows[0];
                assert.equal(observed.decision, "revoked");
                assert.equal(observed.revision, 3);
                await waiter.query("COMMIT");
              } finally {
                await blocker.query("ROLLBACK").catch(() => {});
                await waiter.query("ROLLBACK").catch(() => {});
                blocker.release();
                waiter.release();
              }
              assert.equal(await api.getEnquiryInfoLatestArmId(scope, query), arm.id);
              assert.equal(
                await api.getEnquiryInfoDecisionHead(
                  { appId: "unrelated-app", channelId: scope.channelId },
                  { kind: "policy" },
                  query,
                ),
                null,
              );
            },
          );
          await t.test(
            "trusted Owner activation records honest provenance and requires the same atomic enable/proof gates",
            async () => {
              await query(
                "UPDATE enquiry_notification_recipients SET enabled=false WHERE recipient_key='copy'",
              );
              const [copy] = await query(
                "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
              );
              const [proof] = await query(
                "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb) RETURNING id",
                [
                  randomUUID(),
                  JSON.stringify({
                    channel: { configuredChannelId: scope.channelId, appId: scope.appId },
                    infoForwarding: { ready: true, purpose: "enq_forward_info", ...scope },
                  }),
                ],
              );
              const input = {
                scope,
                subject: { kind: "policy" },
                decision: "armed",
                expectedRevision: 3,
                evidence: { providerProofAuditId: proof.id, copyVersion: copy.version + 1 },
              };
              assert.throws(
                () => api.buildOwnerEnquiryInfoActivationStatement(input, owner),
                code("ENQUIRY_INFO_OWNER_PHOTO_AUTHORITY_REQUIRED"),
              );
              const source = { ...owner, photoSha256: sha("owned approved routing photo") };
              const stmt = api.buildOwnerEnquiryInfoActivationStatement(input, source);
              await assert.rejects(
                transaction([...api.enquiryInfoLockStatements(scope), stmt]),
                /ENQUIRY_INFO_ATOMIC_ARM_CONTEXT_REQUIRED/,
              );
              const results = await transaction(
                [
                  ...api.enquiryInfoLockStatements(scope),
                  {
                    statement:
                      "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,destination_reference=phone,verified_at=now(),verification_ref=$2,permission_granted=true,permission_ref=$3 WHERE recipient_key='copy'",
                    params: [
                      scope.channelId,
                      `enq_forward_info:provider:${proof.id}`,
                      `enq_forward_info:owner_goal:${owner.goalId}`,
                    ],
                  },
                  stmt,
                ],
                { isolationLevel: "ReadCommitted" },
              );
              const armed = results.at(-1)[0];
              assert.equal(armed.authority_kind, "owner_instruction");
              assert.equal(armed.actor_staff_id, null);
              assert.equal(armed.evidence.ownerInstruction.photoSha256, source.photoSha256);
              assert.equal(await api.getEnquiryInfoLatestArmId(scope, query), armed.id);
              const system = api.buildEnquiryInfoDecisionStatement(
                { ...input, expectedRevision: 4 },
                admin,
              );
              system.params[14] = "system_policy";
              system.params[15] = null;
              await assert.rejects(
                transaction([...api.enquiryInfoLockStatements(scope), system]),
                /ENQUIRY_INFO_SYSTEM_APPROVAL_FORBIDDEN/,
              );
            },
          );
          assert.equal(network.mock.callCount(), 0);
        },
        {
          migrationVersions: MIGRATION_VERSIONS.filter(
            (value) => value !== version && value !== copyVersion,
          ),
        },
      );
    } finally {
      mock.restoreAll();
    }
  },
);
