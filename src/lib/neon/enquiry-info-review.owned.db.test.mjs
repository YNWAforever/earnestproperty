import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import {
  ENQUIRY_MANAGERS,
  ENQUIRY_ROUTING_APPROVAL,
} from "../whatsapp-enquiries/enquiry-routing.mjs";
const scope = { appId: "owned_review_app", channelId: "owned_review_channel" },
  phone = "85292786562";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const env = {
  WOZTELL_APP_ID: scope.appId,
  WOZTELL_CHANNEL_ID: scope.channelId,
  EP_WA_COMPANY_CHANNEL_ID: scope.channelId,
  EP_WA_ENQUIRY_MODE: "observe",
  VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
};
const evidence = {
  sourceReference: "owned:actual-manager-review",
  statement: "Owned manager has checked the actual source for this specific identity.",
};
const status = (n) => (e) => e instanceof Response && e.status === n;

test(
  "authenticated purpose reviews and original held-reply resolution on ordered owned Postgres",
  { timeout: 180000 },
  async (t) => {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("External network forbidden in owned review");
    });
    try {
      await withOwnedPostgres(
        async ({ query, transaction }) => {
          await mockOwnedServerDb(mock, query, transaction);
          const api = await import("./enquiry-info-review.server.ts"),
            decisions = await import("./enquiry-info-decisions.server.ts");
          const { inspectEnquiryForwardingProvider } =
            await import("../whatsapp-enquiries/enquiry-forwarding-provider.server.ts");
          const { getCurrentEnquiryInfoInstallationEvidence } =
            await import("./enquiry-info-installation.server.ts");
          const { enableEnquiryForwardingFromOwnerInstruction } =
            await import("./enquiry-forwarding.server.ts");
          const receipts = await import("../whatsapp-enquiries/inbound-receipts.server.ts");
          const { handleWoztellWebhook } = await import("../whatsapp-enquiries/webhook.server.ts");
          const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
          const { eventForReceiptProjection } =
            await import("../whatsapp-enquiries/inbound-identity.ts");
          const ports = { query, transaction };
          async function staff(role, number = null, id = randomUUID()) {
            await query(
              "INSERT INTO staff_users(id,auth_user_id,name_zh,active,show_on_website,phone,whatsapp) VALUES($1,$2,'Owned review colleague',true,$3,$4,$4)",
              [id, `owned_review_${id}`, !!number, number],
            );
            if (role)
              await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [id, role]);
            return { staffId: id, roles: role ? [role] : [] };
          }
          const manager = await staff("manager"),
            agent = await staff("agent"),
            noRole = await staff(null),
            colleague = await staff(null, phone);
          for (const m of Object.values(ENQUIRY_MANAGERS)) await staff(null, m.phone, m.staffId);
          const [releaseJob] = await query(
            "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) VALUES('woztell.enquiry.forward.readiness',1,'{}','queued',2,now(),$1) RETURNING id",
            [`owned-review-release:${randomUUID()}`],
          );
          await query(
            "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.check_requested','ops_job',$1,$2::jsonb)",
            [
              releaseJob.id,
              JSON.stringify({
                source: "approved_deployment_verification",
                releaseSha: env.VERCEL_GIT_COMMIT_SHA,
              }),
            ],
          );
          const installation = await getCurrentEnquiryInfoInstallationEvidence(scope, {
            query,
            env,
          });
          let matched = [];
          const template = {
            name: "owned_review_notice",
            language: "zh_HK",
            params: ["name", "source", "phone", "link"],
          };
          async function providerReport() {
            return inspectEnquiryForwardingProvider({
              informationalInstallation: installation,
              recipientPhones: [phone],
              env: {
                ...env,
                WOZTELL_ENABLED: "true",
                WOZTELL_BOT_ACCESS_TOKEN: "owned_review_bot",
                WOZTELL_OPEN_API_TOKEN: "owned_review_open",
                WOZTELL_CHANNEL_SECRET: "owned_review_secret",
                VITE_CONTACT_WHATSAPP_PHONE: "85224962283",
                EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
                EP_WA_STAFF_ALERT_TEMPLATE: JSON.stringify(template),
              },
              fetch: async (input, init) => {
                const url = new URL(String(input));
                let body;
                if (url.hostname === "open.api.woztell.com") {
                  const source = JSON.parse(init.body);
                  body = source.query.includes("members(")
                    ? {
                        data: {
                          apiViewer: {
                            members: {
                              edges: matched.map((member) => ({
                                node: {
                                  _id: member,
                                  channelId: scope.channelId,
                                  externalId: phone,
                                },
                              })),
                              pageInfo: { hasNextPage: false },
                            },
                          },
                        },
                      }
                    : {
                        data: {
                          apiViewer: {
                            channel: {
                              _id: scope.channelId,
                              appId: scope.appId,
                              connected: true,
                              archived: false,
                              appIntegrationAccessToken: "owned_review_cloud_credential",
                            },
                          },
                        },
                      };
                } else if (url.pathname.endsWith("/waba-info"))
                  body = {
                    ok: 1,
                    result: {
                      phoneNumber: "85224962283",
                      phoneNumberId: "owned_phone",
                      wabaId: "owned_waba",
                    },
                  };
                else
                  body = {
                    ok: 1,
                    data: [
                      {
                        id: "owned_template",
                        name: template.name,
                        statuses: [{ language: "zh_HK", status: "APPROVED" }],
                        templates: [
                          {
                            language: "zh_HK",
                            status: "APPROVED",
                            components: [
                              { type: "BODY", text: "姓名{{1}}來源{{2}}電話{{3}}連結{{4}}" },
                            ],
                          },
                        ],
                      },
                    ],
                    paging: { hasNext: false },
                  };
                return new Response(JSON.stringify(body), {
                  headers: { "Content-Type": "application/json" },
                });
              },
            });
          }
          let report = await providerReport();
          assert.equal(report.infoForwarding.ready, true);
          assert.equal(report.ready, false, "legacy capability references stay absent");
          const proof = async (metadata = report) =>
            (
              await query(
                "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb) RETURNING id",
                [randomUUID(), JSON.stringify(metadata)],
              )
            )[0];
          await proof();
          const owner = {
            goalId: "owned-review-routing-goal",
            sourceReference: "owned:approved-routing",
            sourceSha256: sha("owned approved routing"),
            receivedAt: "2026-01-01T00:00:00Z",
            recorderReference: "owned:operator",
            statement: "Owned Owner approves this informational forwarding activation.",
            photoSha256: sha("owned routing photo"),
          };
          await enableEnquiryForwardingFromOwnerInstruction(
            {
              expectedCopyVersion: (
                await query(
                  "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
                )
              )[0].version,
            },
            owner,
            ports,
          );
          async function effects() {
            return (
              await query(
                `SELECT jsonb_build_object('contacts',(SELECT count(*) FROM crm_contacts),'messages',(SELECT count(*) FROM whatsapp_messages),'enquiries',(SELECT count(*) FROM whatsapp_enquiry_events),'jobs',(SELECT count(*) FROM ops_jobs),'decisions',(SELECT count(*) FROM enquiry_forwarding_decisions),'audits',(SELECT count(*) FROM audit_logs),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY staff_user_id,role) FROM staff_roles r)) v`,
              )
            )[0].v;
          }
          async function receive(
            member,
            {
              from,
              app = scope.appId,
              channel = scope.channelId,
              message = "請提供這個單位的資料。",
            } = {},
          ) {
            const body = {
              type: "TEXT",
              eventType: "INBOUND",
              messageId: `owned_review_${randomUUID()}`,
              member,
              app,
              channel,
              timestamp: Math.floor(Date.now() / 1000),
              ...(from ? { from } : {}),
              to: "85224962283",
              data: { text: message },
            };
            const raw = JSON.stringify(body),
              secret = "owned_review_signature";
            let projectionError;
            const response = await handleWoztellWebhook(
              new Request("https://owned.invalid/api/woztell/webhook", {
                method: "POST",
                body: raw,
                headers: {
                  "x-woztell-signature": createHmac("sha256", secret).update(raw).digest("base64"),
                },
              }),
              {
                config: { enabled: true, channelSecret: secret, appId: app, channelId: channel },
                storeReceipt: (input) => receipts.storeInboundReceipt(input, ports),
                markReceipt: (id, state, reason) =>
                  receipts.markInboundReceipt(id, state, reason, { query }),
                ingest: async (event, origin, _unused, options) => {
                  try {
                    return await ingestWoztellEvent(event, origin, transaction, {
                      ...options,
                      schemaAvailable: async () => true,
                      wake: () => {},
                    });
                  } catch (e) {
                    projectionError = e;
                    throw e;
                  }
                },
              },
            );
            if (projectionError) throw projectionError;
            assert.equal(response.status, 200);
            return (
              await query(
                "SELECT * FROM whatsapp_inbound_receipts WHERE member_id=$1 AND app_id=$2 ORDER BY received_at DESC,id DESC LIMIT 1",
                [member, app],
              )
            )[0];
          }
          const get = () => api.getEnquiryInfoReviewState(manager, ports),
            phoneData = async () => ({
              ...(await get()).phones.find((p) => p.phone === phone),
              ...evidence,
            });
          const reviewInput = async (decision = "approved") => {
            const p = await phoneData();
            return {
              ...evidence,
              phone,
              decision,
              expectedRevision: p.revision,
              profileHash: p.profileHash,
              conflictHash: p.conflictHash,
            };
          };
          const heldInput = async (id, resolution = "customer") => {
            const r = (await get()).heldReplies.find((r) => r.receiptId === id);
            return {
              ...evidence,
              receiptId: id,
              expectedRevision: r.expectedRevision,
              expectedMemberRevision: r.expectedMemberRevision,
              resolution,
            };
          };
          await t.test(
            "DB roles reject agents, forged role claims, inactive users and missing identities before protected reads",
            async () => {
              for (const actor of [
                agent,
                { ...agent, roles: ["manager"] },
                { ...noRole, roles: ["admin"] },
                { staffId: randomUUID(), roles: ["manager"] },
              ]) {
                const before = await effects();
                await assert.rejects(api.getEnquiryInfoReviewState(actor, ports), status(403));
                await assert.rejects(api.reviewEnquiryInfoPhone({}, actor, ports), status(403));
                await assert.rejects(api.resolveEnquiryInfoReply({}, actor, ports), status(403));
                assert.deepEqual(await effects(), before);
              }
              await query("UPDATE staff_users SET active=false WHERE id=$1", [manager.staffId]);
              await assert.rejects(get(), status(403));
              await query("UPDATE staff_users SET active=true WHERE id=$1", [manager.staffId]);
            },
          );
          await t.test(
            "scope absence fails closed and readonly GET has no review, credential or raw provider side effects",
            async () => {
              const before = await effects(),
                data = await get();
              assert.deepEqual(await effects(), before);
              assert.ok(data.phones.some((p) => p.phone === phone));
              assert.doesNotMatch(
                JSON.stringify(data),
                /owned_review_(cloud_credential|signature|bot|open)|proofHash|normalized_event|body_digest/,
              );
              process.env.WOZTELL_APP_ID = "owned_unestablished_app";
              try {
                await assert.rejects(get(), status(503));
              } finally {
                process.env.WOZTELL_APP_ID = scope.appId;
              }
            },
          );
          await t.test(
            "established review and controlled customer release survive expired or failed provider checks without enabling delivery",
            async () => {
              await query(
                "UPDATE audit_logs SET created_at=now()-interval '25 hours' WHERE action='whatsapp.enquiry_forwarding.provider_checked'",
              );
              const old = await receive("owned_outage_customer"),
                before = await effects();
              const current = await get();
              assert.ok(current.heldReplies.some((r) => r.receiptId === old.id));
              assert.deepEqual(await effects(), before);
              const { getEnquiryForwardingSettings, setEnquiryForwardingEnabled } =
                await import("./enquiry-forwarding.server.ts");
              const settings = await getEnquiryForwardingSettings(manager, query);
              assert.equal(settings.providerCheck, null);
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  {
                    enabled: true,
                    expectedCopyVersion: (
                      await query(
                        "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
                      )
                    )[0].version,
                  },
                  manager,
                  ports,
                ),
                status(409),
              );
              const result = await api.resolveEnquiryInfoReply(
                await heldInput(old.id),
                manager,
                ports,
              );
              assert.equal(result.resolved, true);
              assert.equal((await effects()).jobs, before.jobs);
              await proof({
                ...report,
                channel: { ...report.channel, appId: null },
                infoForwarding: { ...report.infoForwarding, ready: false },
              });
              assert.ok((await get()).phones.length > 0);
              await proof();
            },
          );
          const [oldCustomer] = await query(
            "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp,opted_out_whatsapp) VALUES('Owned old customer',$1,'owned_old_customer_member',false,true) RETURNING *",
            [phone],
          );
          const [oldConversation] = await query(
            "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,assignment_lock) VALUES($1,$2,'owned_old_customer_member',true) RETURNING *",
            [oldCustomer.id, scope.channelId],
          );
          const oldReply = await receive("owned_old_customer_member");
          const nativeReply = await receive("owned_native_source_staff", { from: phone });
          await t.test(
            "phone review requires current roster, exact revision and live profile/conflict hashes without touching CRM or binding old member",
            async () => {
              const input = await reviewInput(),
                before = await effects();
              for (const invalid of [
                { ...input, phone: "85299991234" },
                { ...input, profileHash: "0".repeat(64) },
                { ...input, conflictHash: "0".repeat(64) },
                { ...input, expectedRevision: 9 },
              ])
                await assert.rejects(
                  api.reviewEnquiryInfoPhone(invalid, manager, ports),
                  status(409),
                );
              await assert.rejects(
                api.reviewEnquiryInfoPhone({ ...input, memberId: "forged_member" }, manager, ports),
                status(400),
              );
              assert.deepEqual(await effects(), before);
              await api.reviewEnquiryInfoPhone(input, manager, ports);
              assert.deepEqual((await effects()).roles, before.roles);
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [oldCustomer.id]))[0],
                oldCustomer,
              );
              assert.deepEqual(
                (
                  await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [
                    oldConversation.id,
                  ])
                )[0],
                oldConversation,
              );
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM enquiry_forwarding_decisions WHERE subject_kind='sender_member' AND member_id='owned_old_customer_member'",
                  )
                )[0].n,
                0,
              );
              const old = (await get()).heldReplies.find((r) => r.receiptId === oldReply.id);
              assert.equal(old.staffAllowed, false);
              assert.equal(old.customerAllowed, false);
              await assert.rejects(
                api.resolveEnquiryInfoReply(await heldInput(oldReply.id), manager, ports),
                status(409),
              );
            },
          );
          await t.test(
            "actual signed explicit fromPhone can establish staff association only after current phone-purpose review",
            async () => {
              const preview = (await get()).heldReplies.find((r) => r.receiptId === nativeReply.id);
              assert.equal(preview.staffAllowed, true);
              assert.equal(preview.customerAllowed, false);
              const before = await effects(),
                result = await api.resolveEnquiryInfoReply(
                  await heldInput(nativeReply.id, "staff"),
                  manager,
                  ports,
                ),
                after = await effects();
              assert.equal(result.resolved, true);
              assert.equal(result.messageInserted, false);
              assert.equal(after.contacts, before.contacts);
              assert.equal(after.messages, before.messages);
              assert.equal(after.jobs, before.jobs);
              assert.equal(after.enquiries, before.enquiries);
              assert.deepEqual(after.roles, before.roles);
              const head = await decisions.getEnquiryInfoDecisionHead(
                scope,
                { kind: "sender_member", memberId: "owned_native_source_staff" },
                query,
              );
              assert.equal(head.evidence.memberEvidence.kind, "accepted_ingress");
              assert.equal(head.evidence.memberEvidence.receiptId, nativeReply.id);
            },
          );
          await t.test(
            "new conflict and profile changes invalidate both approval and revocation CAS with zero review writes",
            async () => {
              let input = await reviewInput("revoked");
              const [extra] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone) VALUES('Owned new collision','92786562') RETURNING id",
              );
              let before = await effects();
              await assert.rejects(api.reviewEnquiryInfoPhone(input, manager, ports), status(409));
              assert.deepEqual(await effects(), before);
              await query("DELETE FROM crm_contacts WHERE id=$1", [extra.id]);
              input = await reviewInput("revoked");
              before = await effects();
              await assert.rejects(
                api.reviewEnquiryInfoPhone(input, manager, {
                  query,
                  transaction: async (statements, options) => {
                    await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                      colleague.staffId,
                      "85292786563",
                    ]);
                    return transaction(statements, options);
                  },
                }),
                status(409),
              );
              assert.deepEqual(await effects(), before);
              await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                colleague.staffId,
                phone,
              ]);
              await api.reviewEnquiryInfoPhone(await reviewInput("revoked"), manager, ports);
              assert.equal((await get()).phones.find((p) => p.phone === phone).state, "revoked");
              await api.reviewEnquiryInfoPhone(await reviewInput(), manager, ports);
            },
          );
          const customer = await receive("owned_actual_new_customer");
          await t.test(
            "generic retry cannot release, client scope/member/proof flags are rejected and stale review writes nothing",
            async () => {
              let before = await effects();
              const event = eventForReceiptProjection(
                customer.normalized_event,
                customer.id,
                "customer_message",
                customer.identity_key,
              );
              const ordinary = await ingestWoztellEvent(event, "live_webhook", transaction, {
                signedEvent: true,
                mode: "observe",
                receiptContext: { receiptId: customer.id },
                schemaAvailable: async () => true,
                wake: () => {},
              });
              assert.ok(ordinary.receiptReview);
              assert.deepEqual(await effects(), before);
              const input = await heldInput(customer.id);
              for (const invalid of [
                { ...input, memberId: "owned_spoof" },
                { ...input, appId: "owned_cross_app" },
                { ...input, providerProof: true },
                { ...input, ownerInstruction: owner },
              ])
                await assert.rejects(
                  api.resolveEnquiryInfoReply(invalid, manager, ports),
                  status(400),
                );
              for (const invalid of [
                { ...input, expectedRevision: input.expectedRevision + 1 },
                { ...input, expectedMemberRevision: 1 },
              ])
                await assert.rejects(
                  api.resolveEnquiryInfoReply(invalid, manager, ports),
                  status(409),
                );
              assert.deepEqual(await effects(), before);
            },
          );
          await t.test(
            "explicit actual customer confirmation completes only original transcript with zero live enquiry or job effects",
            async () => {
              const before = await effects(),
                result = await api.resolveEnquiryInfoReply(
                  await heldInput(customer.id),
                  manager,
                  ports,
                ),
                after = await effects();
              assert.equal(result.resolved, true);
              assert.equal(result.messageInserted, true);
              assert.equal(after.messages, before.messages + 1);
              assert.equal(after.contacts, before.contacts + 1);
              assert.equal(after.jobs, before.jobs);
              assert.equal(after.enquiries, before.enquiries);
              assert.deepEqual(after.roles, before.roles);
              const [receipt] = await query(
                "SELECT projection_state,block_reason FROM whatsapp_inbound_receipts WHERE id=$1",
                [customer.id],
              );
              assert.equal(receipt.projection_state, "projected");
              assert.equal(receipt.block_reason, null);
              assert.ok(!(await get()).heldReplies.some((r) => r.receiptId === customer.id));
            },
          );
          const bspReply = await receive("owned_genuine_bsp_staff");
          await t.test(
            "staff action uses actual exact protected BSP member proof and never old CRM phone or member digits",
            async () => {
              const numeric = await receive(phone);
              assert.equal(
                (await get()).heldReplies.find((r) => r.receiptId === numeric.id).staffAllowed,
                false,
              );
              matched = ["owned_genuine_bsp_staff"];
              report = await providerReport();
              assert.equal(report.members.matched[0].memberId, "owned_genuine_bsp_staff");
              await proof();
              const data = await get();
              assert.equal(
                data.heldReplies.find((r) => r.receiptId === bspReply.id).staffAllowed,
                true,
              );
              assert.equal(
                data.heldReplies.find((r) => r.receiptId === oldReply.id).staffAllowed,
                false,
              );
              const before = await effects(),
                result = await api.resolveEnquiryInfoReply(
                  await heldInput(bspReply.id, "staff"),
                  manager,
                  ports,
                ),
                after = await effects();
              assert.equal(result.resolved, true);
              assert.equal(result.messageInserted, false);
              assert.equal(after.messages, before.messages);
              assert.equal(after.contacts, before.contacts);
              assert.equal(after.jobs, before.jobs);
              assert.equal(after.enquiries, before.enquiries);
              const head = await decisions.getEnquiryInfoDecisionHead(
                scope,
                { kind: "sender_member", memberId: "owned_genuine_bsp_staff" },
                query,
              );
              assert.equal(head.decision, "staff_bound");
              assert.equal(head.evidence.memberEvidence.kind, "provider_audit");
              assert.equal(head.actorStaffId, manager.staffId);
            },
          );
          await t.test(
            "retired actual purpose phone can only be revoked and its unproved old CRM member still needs controlled customer review",
            async () => {
              await query("UPDATE staff_users SET phone=$2,whatsapp=$2 WHERE id=$1", [
                colleague.staffId,
                "85292786564",
              ]);
              try {
                let current = await get(),
                  retired = current.phones.find((p) => p.phone === phone);
                assert.equal(retired.retired, true);
                assert.equal(retired.eligible, false);
                assert.equal(
                  current.heldReplies.find((r) => r.receiptId === oldReply.id).customerAllowed,
                  false,
                );
                const before = await effects(),
                  input = {
                    ...evidence,
                    phone,
                    decision: "revoked",
                    expectedRevision: retired.revision,
                    profileHash: retired.profileHash,
                    conflictHash: retired.conflictHash,
                  };
                await api.reviewEnquiryInfoPhone(input, manager, ports);
                const after = await effects();
                assert.equal(after.contacts, before.contacts);
                assert.equal(after.messages, before.messages);
                assert.equal(after.jobs, before.jobs);
                assert.deepEqual(after.roles, before.roles);
                assert.deepEqual(
                  (await query("SELECT * FROM crm_contacts WHERE id=$1", [oldCustomer.id]))[0],
                  oldCustomer,
                );
                assert.deepEqual(
                  (
                    await query("SELECT * FROM whatsapp_conversations WHERE id=$1", [
                      oldConversation.id,
                    ])
                  )[0],
                  oldConversation,
                );
                const head = await decisions.getEnquiryInfoDecisionHead(
                  scope,
                  { kind: "recipient_phone", phone },
                  query,
                );
                assert.equal(head.decision, "revoked");
                assert.equal(head.staffId, null);
                current = await get();
                retired = current.phones.find((p) => p.phone === phone);
                assert.equal(retired.retired, true);
                assert.equal(retired.state, "revoked");
                const stable = await effects();
                await assert.rejects(
                  api.reviewEnquiryInfoPhone(
                    {
                      ...input,
                      decision: "approved",
                      expectedRevision: retired.revision,
                      profileHash: retired.profileHash,
                      conflictHash: retired.conflictHash,
                    },
                    manager,
                    ports,
                  ),
                  status(409),
                );
                await assert.rejects(
                  api.reviewEnquiryInfoPhone(
                    { ...input, phone: "85299991234", expectedRevision: 0 },
                    manager,
                    ports,
                  ),
                  status(409),
                );
                assert.deepEqual(await effects(), stable);
                assert.equal(
                  current.heldReplies.find((r) => r.receiptId === oldReply.id).customerAllowed,
                  true,
                );
                assert.equal(
                  (
                    await query(
                      "SELECT count(*)::int n FROM enquiry_forwarding_decisions WHERE subject_kind='sender_member' AND member_id='owned_old_customer_member' AND decision='staff_bound'",
                    )
                  )[0].n,
                  0,
                );
                const result = await api.resolveEnquiryInfoReply(
                  await heldInput(oldReply.id),
                  manager,
                  ports,
                );
                assert.equal(result.resolved, true);
                assert.equal((await effects()).jobs, stable.jobs);
                assert.equal((await effects()).enquiries, stable.enquiries);
                assert.equal(
                  (
                    await query("SELECT assignment_lock FROM whatsapp_conversations WHERE id=$1", [
                      oldConversation.id,
                    ])
                  )[0].assignment_lock,
                  true,
                );
                const consent = (
                  await query(
                    "SELECT opt_in_whatsapp,opted_out_whatsapp FROM crm_contacts WHERE id=$1",
                    [oldCustomer.id],
                  )
                )[0];
                assert.equal(consent.opt_in_whatsapp, false);
                assert.equal(consent.opted_out_whatsapp, true);
              } finally {
                await query("UPDATE staff_users SET phone=$2,whatsapp=$2 WHERE id=$1", [
                  colleague.staffId,
                  phone,
                ]);
              }
              await api.reviewEnquiryInfoPhone(await reviewInput(), manager, ports);
            },
          );
          await t.test(
            "late genuine historical staff evidence cannot turn a recorded customer review into successful release",
            async () => {
              const member = "owned_late_staff",
                receipt = await receive(member),
                input = await heldInput(receipt.id),
                before = await effects();
              let injected = false;
              const raced = {
                query: async (statement, params) => {
                  if (!injected && statement.includes("JOIN staff_users s ON s.id=$2::uuid")) {
                    injected = true;
                    matched = [member];
                    report = await providerReport();
                    const p = await proof();
                    const approval = await decisions.getEnquiryInfoDecisionHead(
                      scope,
                      { kind: "recipient_phone", phone },
                      query,
                    );
                    await decisions.appendEnquiryInfoDecision(
                      {
                        scope,
                        subject: { kind: "sender_member", memberId: member },
                        decision: "staff_bound",
                        expectedRevision: 1,
                        phone,
                        relatedDecisionId: approval.id,
                        memberEvidence: {
                          kind: "provider_audit",
                          auditId: p.id,
                          proofHash: report.members.matched[0].proofHash,
                        },
                        evidence,
                      },
                      manager,
                      ports,
                    );
                  }
                  return query(statement, params);
                },
                transaction,
              };
              await assert.rejects(api.resolveEnquiryInfoReply(input, manager, raced), status(409));
              assert.equal(injected, true);
              const after = await effects();
              assert.equal(after.contacts, before.contacts);
              assert.equal(after.messages, before.messages);
              assert.equal(after.jobs, before.jobs);
              assert.equal(after.enquiries, before.enquiries);
              assert.equal(
                (
                  await query(
                    "SELECT projection_state FROM whatsapp_inbound_receipts WHERE id=$1",
                    [receipt.id],
                  )
                )[0].projection_state,
                "failed",
              );
              await assert.rejects(
                api.resolveEnquiryInfoReply(await heldInput(receipt.id), manager, ports),
                status(409),
              );
            },
          );
          await t.test(
            "cross-company receipt IDs cannot be reviewed or exposed through the configured scope",
            async () => {
              const other = { appId: "owned_other_app", channelId: "owned_other_channel" },
                otherMember = "owned_other_customer";
              const [p] = await query(
                "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb) RETURNING id",
                [
                  randomUUID(),
                  JSON.stringify({
                    channel: { configuredChannelId: other.channelId, appId: other.appId },
                    infoForwarding: { ...other, purpose: "enq_forward_info", ready: true },
                  }),
                ],
              );
              const copy = (
                await query(
                  "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
                )
              )[0];
              await transaction(
                [
                  ...decisions.enquiryInfoLockStatements(other, [{ kind: "policy" }]),
                  {
                    statement:
                      "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,verification_ref=$2,verified_at=now(),permission_granted=true,permission_ref=$3,destination_type='recipient_id',destination_reference=phone WHERE recipient_key='copy'",
                    params: [
                      other.channelId,
                      `provider-check-audit:${p.id}`,
                      ENQUIRY_ROUTING_APPROVAL,
                    ],
                  },
                  decisions.buildEnquiryInfoDecisionStatement(
                    {
                      scope: other,
                      subject: { kind: "policy" },
                      decision: "armed",
                      expectedRevision: 0,
                      evidence: { providerProofAuditId: p.id, copyVersion: copy.version + 1 },
                    },
                    manager,
                  ),
                ],
                { isolationLevel: "ReadCommitted" },
              );
              const foreign = await receive(otherMember, {
                app: other.appId,
                channel: other.channelId,
              });
              await proof();
              await query(
                "UPDATE enquiry_notification_recipients SET channel_id=$1 WHERE recipient_key='copy'",
                [scope.channelId],
              );
              const before = await effects();
              assert.ok(!(await get()).heldReplies.some((r) => r.receiptId === foreign.id));
              await assert.rejects(
                api.resolveEnquiryInfoReply(
                  {
                    ...evidence,
                    receiptId: foreign.id,
                    expectedRevision: 1,
                    expectedMemberRevision: 0,
                    resolution: "customer",
                  },
                  manager,
                  ports,
                ),
                status(409),
              );
              assert.deepEqual(await effects(), before);
            },
          );
          await t.test(
            "a signed staff receipt verifies the historical phone and another active directory holder blocks it",
            async () => {
              const number = "85298764444";
              const receipt = await receive("owned_historical_colleague", {
                from: number,
                message: "我是測試同事，確認使用此號碼全日接收公司的查詢通知。",
              });
              const { staffId } = await staff("agent", number);
              const [ep] = await query(
                "INSERT INTO staff_notification_endpoints(staff_id,transport,channel_id,destination_reference,verification_ref,verified_at,permission_granted,permission_ref,quiet_hours_policy) VALUES($1,'website_lead_phone',$2,$3,$4,now(),true,$5,$6::jsonb) RETURNING id",
                [
                  staffId,
                  scope.channelId,
                  number,
                  `accepted-ingress:${receipt.id}`,
                  `recipient-consent:${receipt.id}`,
                  JSON.stringify({
                    approved: true,
                    allowAllHours: true,
                    timezone: "Asia/Hong_Kong",
                  }),
                ],
              );
              const approval = {
                version: 1,
                authority: "authenticated_recipient_confirmation",
                allowAllHours: true,
                timezone: "Asia/Hong_Kong",
                transport: "website_lead_phone",
                enabled: false,
                companyApprovalRef: "owned company approval",
                consentReceiptId: receipt.id,
                allHoursReceiptId: receipt.id,
                destinationProofReceiptId: receipt.id,
              };
              await query(
                "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('staff.endpoint.configure','staff_endpoint',$1,$2::jsonb)",
                [ep.id, JSON.stringify(approval)],
              );
              const reviewed = new Set(
                ["consent", "identity", "hours", "first_confirmation"].map((role) =>
                  sha(
                    [
                      "historical-recipient-evidence:v1",
                      role,
                      staffId,
                      receipt.id,
                      receipt.body_digest,
                    ].join("\n"),
                  ),
                ),
              );
              const { getHistoricalRecipientProof } =
                await import("./historical-recipient-proof.server.ts");
              const read = () =>
                getHistoricalRecipientProof(staffId, scope.channelId, query, reviewed);
              const original = await read();
              assert.equal(original.review.receipts.length, 3);
              assert.ok(
                original.review.receipts.every(
                  (r) => r.verified && r.attested && r.matchedMember && r.matchedPhone,
                ),
              );
              assert.equal(original.review.hoursApproved, true);
              assert.ok(!original.reasons.includes("shared_phone"));
              await staff(null, number);
              const shared = await read();
              assert.equal(shared.ready, false);
              assert.ok(shared.reasons.includes("shared_phone"));
              assert.notEqual(shared.fingerprint, original.fingerprint);
            },
          );
          await t.test(
            "every public review handler delegates each request to opaque staff auth without an Owner authority switch",
            async () => {
              let request = new Request("https://owned.invalid/admin"),
                authCalls = 0,
                serviceCalls = 0;
              mock.module("@tanstack/react-start", {
                namedExports: {
                  createServerFn: () => {
                    let schema;
                    return {
                      inputValidator(value) {
                        schema = value;
                        return this;
                      },
                      handler(fn) {
                        return async (options = {}) =>
                          fn({ data: schema ? schema.parse(options.data) : undefined });
                      },
                    };
                  },
                },
              });
              mock.module("@tanstack/react-start/server", {
                namedExports: { getRequest: () => request },
              });
              mock.module(new URL("./staff-server-fn.ts", import.meta.url).href, {
                namedExports: { callStaffServerFn: async (fn, options) => fn(options) },
              });
              mock.module(new URL("./auth.server.ts", import.meta.url).href, {
                namedExports: {
                  requireStaffAccess: async (actual, roles) => {
                    authCalls++;
                    assert.equal(actual, request);
                    assert.deepEqual(roles, ["admin", "manager"]);
                    const token = actual.headers.get("authorization");
                    if (!token) throw new Response("Unauthorized", { status: 401 });
                    if (token !== "Bearer owned_opaque_manager_session")
                      throw new Response("Forbidden", { status: 403 });
                    return manager;
                  },
                },
              });
              mock.module(new URL("./enquiry-info-review.server.ts", import.meta.url).href, {
                namedExports: {
                  getEnquiryInfoReviewState: async (actor) => {
                    serviceCalls++;
                    assert.equal(actor, manager);
                    return { phones: [], heldReplies: [], heldCount: 0, hasMore: false };
                  },
                  reviewEnquiryInfoPhone: async (_input, actor) => {
                    serviceCalls++;
                    assert.equal(actor, manager);
                    return { phone, decision: "approved", revision: 1 };
                  },
                  resolveEnquiryInfoReply: async (input, actor) => {
                    serviceCalls++;
                    assert.equal(actor, manager);
                    return {
                      receiptId: input.receiptId,
                      resolved: true,
                      resolution: "customer",
                      messageInserted: true,
                    };
                  },
                },
              });
              const client = await import("./enquiry-forwarding.ts");
              const p = {
                  ...evidence,
                  phone,
                  decision: "approved",
                  expectedRevision: 0,
                  profileHash: sha("owned profile"),
                  conflictHash: sha("owned conflicts"),
                },
                r = {
                  ...evidence,
                  receiptId: randomUUID(),
                  expectedRevision: 1,
                  expectedMemberRevision: 0,
                  resolution: "customer",
                };
              for (const call of [
                () => client.fetchEnquiryIdentityReview(),
                () => client.reviewEnquiryPhonePurpose(p),
                () => client.resolveEnquiryHeldReply(r),
              ])
                await assert.rejects(call(), status(401));
              assert.equal(authCalls, 3);
              assert.equal(serviceCalls, 0);
              request = new Request("https://owned.invalid/admin", {
                headers: { authorization: "Bearer owned_opaque_agent_session" },
              });
              await assert.rejects(client.fetchEnquiryIdentityReview(), status(403));
              assert.equal(serviceCalls, 0);
              request = new Request("https://owned.invalid/admin", {
                headers: { authorization: "Bearer owned_opaque_manager_session" },
              });
              await client.fetchEnquiryIdentityReview();
              await client.reviewEnquiryPhonePurpose(p);
              await client.resolveEnquiryHeldReply(r);
              assert.equal(authCalls, 7);
              assert.equal(serviceCalls, 3);
              await assert.rejects(
                client.reviewEnquiryPhonePurpose({ ...p, ownerInstruction: owner }),
                (error) => error.name === "ZodError",
              );
              assert.equal(serviceCalls, 3);

              const historical = await import("./historical-resend.ts");
              const pair = { leadId: randomUUID(), staffId: colleague.staffId };
              const confirmation = {
                ...pair,
                fingerprint: sha("owned historical review"),
                identityReviewed: true,
              };
              const current = () => true;
              const calls = [
                () => historical.fetchHistoricalRecipients(current),
                () => historical.reviewHistoricalRecipient(pair, current),
                () => historical.sendHistoricalNotification(confirmation, current),
              ];
              for (const [authorization, code] of [
                [null, 401],
                ["Bearer owned_opaque_agent_session", 403],
              ]) {
                request = new Request("https://owned.invalid/admin", {
                  headers: authorization ? { authorization } : {},
                });
                for (const call of calls) await assert.rejects(call(), status(code));
              }
              request = new Request("https://owned.invalid/admin", {
                headers: { authorization: "Bearer owned_opaque_manager_session" },
              });
              const deployment = process.env.VERCEL_ENV;
              try {
                process.env.VERCEL_ENV = "preview";
                await assert.rejects(calls[2](), status(403));
                delete process.env.VERCEL_ENV;
                await assert.rejects(calls[2](), status(403));
              } finally {
                if (deployment === undefined) delete process.env.VERCEL_ENV;
                else process.env.VERCEL_ENV = deployment;
              }
            },
          );
          assert.equal(network.mock.callCount(), 0);
        },
        { migrationVersions: MIGRATION_VERSIONS },
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      mock.restoreAll();
    }
  },
);
