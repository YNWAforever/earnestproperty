import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import {
  ENQUIRY_COPY,
  ENQUIRY_MANAGERS,
  ENQUIRY_ROUTING_APPROVAL,
} from "../whatsapp-enquiries/enquiry-routing.mjs";

const channel = "owned-admin-forwarding-channel";
const template = {
  name: "owned_admin_staff_alert",
  language: "zh_HK",
  params: ["name", "source", "phone", "link"],
};
const baseEnv = {
  WOZTELL_APP_ID: "owned-admin-app",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  WOZTELL_CHANNEL_ID: channel,
  EP_WA_COMPANY_CHANNEL_ID: channel,
  EP_WA_ENQUIRY_MODE: "observe",
  OPS_WAKE_URL: "",
};
const responseStatus = (status) => (error) => error instanceof Response && error.status === status;

// All identities, credentials, audit proofs and provider responses below are owned
// fixtures. The only real contact IDs are the migration's immutable manager IDs.
// No external connection, provider send, production write or authentication grant.
test(
  "owned admin forwarding API authorizes, verifies and commits settings atomically",
  { timeout: 120000 },
  async (t) => {
    assert.ok(MIGRATION_VERSIONS.includes("20261116000000_enquiry_forwarding.sql"));
    const previous = Object.fromEntries(Object.keys(baseEnv).map((key) => [key, process.env[key]]));
    Object.assign(process.env, baseEnv);
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("External network forbidden in owned admin forwarding tests");
    });
    try {
      await withOwnedPostgres(async ({ query, transaction, pool }) => {
        let trustedRosterReads = 0;
        await mockOwnedServerDb(
          mock,
          async (statement, params = []) => {
            if (statement.includes("FROM staff_users WHERE active AND show_on_website"))
              trustedRosterReads++;
            return query(statement, params);
          },
          transaction,
        );
        const wakes = [],
          wakeObservations = [];
        let wakeError = null;
        mock.module(new URL("../control-plane/job-wake.server.ts", import.meta.url).href, {
          exports: {
            wakeAfterCommit: (lane) => {
              wakes.push(lane);
              if (wakeError) throw wakeError;
              wakeObservations.push(
                query(
                  "SELECT id FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness' AND actor_staff_id IS NOT NULL",
                ),
              );
            },
            laneForJob: () => "service",
          },
        });
        const {
          getEnquiryForwardingSettings,
          setEnquiryForwardingEnabled,
          enableEnquiryForwardingFromOwnerInstruction,
          queueEnquiryForwardingCheck,
        } = await import("./enquiry-forwarding.server.ts");
        const { inspectEnquiryForwardingProvider } =
          await import("../whatsapp-enquiries/enquiry-forwarding-provider.server.ts");
        const ports = { query, transaction };
        const sha = (value) => createHash("sha256").update(value).digest("hex");
        const scope = { appId: baseEnv.WOZTELL_APP_ID, channelId: channel };
        const owner = {
          goalId: "owned-activation-authority",
          sourceReference: "owned:activation-request",
          sourceSha256: sha("owned actual instruction"),
          receivedAt: "2026-01-01T00:00:00Z",
          recorderReference: "owned:trusted-operator",
          statement: "Owned Owner authorises informational enquiry phone copies.",
          photoSha256: sha("owned approved routing photo"),
        };
        const decisions = await import("./enquiry-info-decisions.server.ts");
        const { getCurrentEnquiryInfoInstallationEvidence } =
          await import("./enquiry-info-installation.server.ts");
        const [releaseJob] = await query(
          "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key) VALUES('woztell.enquiry.forward.readiness',1,'{}','queued',2,now(),$1) RETURNING id",
          [`owned-release:${randomUUID()}`],
        );
        const [releaseAudit] = await query(
          "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.check_requested','ops_job',$1,$2::jsonb) RETURNING id",
          [
            releaseJob.id,
            JSON.stringify({
              source: "approved_deployment_verification",
              releaseSha: baseEnv.VERCEL_GIT_COMMIT_SHA,
            }),
          ],
        );
        const installation = await getCurrentEnquiryInfoInstallationEvidence(scope, {
          query,
          env: baseEnv,
        });
        assert.equal(installation.releaseAuditId, releaseAudit.id);
        async function staff({
          id = randomUUID(),
          role,
          active = true,
          publicProfile = false,
          phone = null,
          whatsapp = null,
        } = {}) {
          await query(
            "INSERT INTO staff_users(id,auth_user_id,name_zh,active,show_on_website,phone,whatsapp) VALUES($1,$2,'Owned forwarding colleague',$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET active=EXCLUDED.active,show_on_website=EXCLUDED.show_on_website,phone=EXCLUDED.phone,whatsapp=EXCLUDED.whatsapp",
            [id, `owned-forwarding-admin-${id}`, active, publicProfile, phone, whatsapp],
          );
          if (role)
            await query(
              "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [id, role],
            );
          return { staffId: id, roles: role ? [role] : [] };
        }
        const admin = await staff({ role: "admin" });
        const manager = await staff({ role: "manager" });
        const noRole = await staff();
        const inactive = await staff({ role: "admin", active: false });
        const sales = await staff({
          role: "agent",
          publicProfile: true,
          whatsapp: "95551234",
          phone: "95551234",
        });
        const privateSales = await staff({ role: "agent", whatsapp: "95551235" });
        const inactiveSales = await staff({
          role: "agent",
          active: false,
          publicProfile: true,
          whatsapp: "95551236",
        });
        const malformedSales = await staff({ publicProfile: true, whatsapp: "not-a-phone" });
        for (const contact of Object.values(ENQUIRY_MANAGERS))
          await staff({ id: contact.staffId, publicProfile: true, phone: contact.phone });
        const expectedKeys = [
          "copy",
          ...Object.keys(ENQUIRY_MANAGERS),
          `sales:${sales.staffId}`,
        ].sort();
        const copy = async () =>
          (
            await query("SELECT * FROM enquiry_notification_recipients WHERE recipient_key='copy'")
          )[0];
        const snapshot = async () => {
          const [data] = await query(`SELECT
          (SELECT jsonb_agg(to_jsonb(r) ORDER BY recipient_key) FROM enquiry_notification_recipients r) AS recipients,
          (SELECT count(*)::int FROM audit_logs WHERE action LIKE 'whatsapp.enquiry_forwarding.%') AS audits,
          (SELECT count(*)::int FROM ops_jobs) AS jobs,
          (SELECT count(*)::int FROM staff_notification_attempts) AS attempts,
          (SELECT jsonb_agg(to_jsonb(s) ORDER BY staff_user_id,role) FROM staff_roles s) AS roles,
          (SELECT count(*)::int FROM enquiry_forwarding_decisions) AS decisions`);
          return data;
        };
        async function reset() {
          await query("UPDATE enquiry_notification_recipients SET enabled=false");
          await query(
            "DELETE FROM audit_logs WHERE action LIKE 'whatsapp.enquiry_forwarding.%' AND metadata->>'source' IS DISTINCT FROM 'approved_deployment_verification'",
          );
          await query(
            "DELETE FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness' AND id<>$1",
            [releaseJob.id],
          );
          for (const contact of Object.values(ENQUIRY_MANAGERS))
            await query(
              "UPDATE staff_users SET active=true,show_on_website=true,phone=$2 WHERE id=$1",
              [contact.staffId, contact.phone],
            );
          wakes.length = 0;
          wakeObservations.length = 0;
          wakeError = null;
        }
        const ready = await inspectEnquiryForwardingProvider({
          informationalInstallation: installation,
          env: {
            ...baseEnv,
            WOZTELL_ENABLED: "true",
            WOZTELL_APP_ID: "owned-admin-app",
            WOZTELL_BOT_ACCESS_TOKEN: "owned-test-bot-credential",
            WOZTELL_OPEN_API_TOKEN: "owned-test-open-credential",
            WOZTELL_CHANNEL_SECRET: "owned-test-webhook-secret",
            VITE_CONTACT_WHATSAPP_PHONE: "85224962283",
            EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
            EP_WA_STAFF_ALERT_TEMPLATE: JSON.stringify(template),
            EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: "owned-test-whatsapp-evidence",
            EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "owned-test-correlation-evidence",
            EP_WA_STAFF_ASSOCIATION_REVIEW_REF: "owned-test-association-evidence",
            EP_WA_STAFF_REPLY_CONTEXT_PATH: "messageEvent.context.replyTo",
          },
          fetch: async (input) => {
            const url = new URL(String(input));
            const body =
              url.hostname === "open.api.woztell.com"
                ? {
                    data: {
                      apiViewer: {
                        channel: {
                          _id: channel,
                          appId: "owned-admin-app",
                          connected: true,
                          archived: false,
                          appIntegrationAccessToken: "owned-test-channel-credential",
                        },
                      },
                    },
                  }
                : url.pathname.endsWith("/waba-info")
                  ? {
                      ok: 1,
                      result: {
                        phoneNumber: "85224962283",
                        phoneNumberId: "owned-phone",
                        wabaId: "owned-waba",
                      },
                    }
                  : {
                      ok: 1,
                      data: [
                        {
                          id: "owned-template",
                          name: template.name,
                          statuses: [{ language: "zh_HK", status: "APPROVED" }],
                          templates: [
                            {
                              language: "zh_HK",
                              status: "APPROVED",
                              components: [
                                {
                                  type: "BODY",
                                  text: "姓名{{1}}，來源{{2}}，電話{{3}}，連結{{4}}",
                                },
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
        assert.equal(
          ready.ready,
          true,
          "the real inspector produces the owned local fixture report",
        );
        assert.equal(
          ready.infoForwarding.ready,
          true,
          "actual owned inspector and installed components/release rows satisfy informational gates",
        );
        async function proof(metadata = ready, age = "0 seconds") {
          return (
            await query(
              "INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata,created_at) VALUES(NULL,'whatsapp.enquiry_forwarding.provider_checked','ops_job',$1,$2::jsonb,now()-$3::interval) RETURNING id",
              [randomUUID(), JSON.stringify(metadata), age],
            )
          )[0];
        }

        await t.test(
          "initial GET returns the desired roster and photo routes without writes or messages",
          async () => {
            await reset();
            const before = await snapshot();
            const settings = await getEnquiryForwardingSettings(admin, query);
            assert.equal(settings.available, true);
            assert.deepEqual(settings.recipients.map((row) => row.key).sort(), expectedKeys);
            assert.ok(settings.recipients.every((row) => !row.enabled && !row.verified));
            assert.ok(settings.routes.length > 0);
            assert.ok(
              settings.routes.every((row) => Object.hasOwn(ENQUIRY_MANAGERS, row.managerKey)),
            );
            assert.equal(settings.providerCheck, null);
            assert.deepEqual(settings.recipientReadiness, {
              checked: true,
              customerConflictRecipientKeys: [],
              distinctBlockedPhoneCount: 0,
            });
            assert.equal(settings.counts.needs_review, 0);
            assert.deepEqual(await snapshot(), before);
            assert.deepEqual(wakes, []);
          },
        );

        await t.test(
          "recipient readiness stays unchecked without a channel or a successful safety read",
          async () => {
            await reset();
            const before = await snapshot();
            try {
              delete process.env.WOZTELL_CHANNEL_ID;
              delete process.env.EP_WA_COMPANY_CHANNEL_ID;
              assert.deepEqual(
                (await getEnquiryForwardingSettings(admin, query)).recipientReadiness,
                { checked: false, customerConflictRecipientKeys: [], distinctBlockedPhoneCount: 0 },
              );
            } finally {
              process.env.WOZTELL_CHANNEL_ID = channel;
              process.env.EP_WA_COMPANY_CHANNEL_ID = channel;
            }
            const unavailable = async (statement, params = []) => {
              if (statement.includes("AS conflict_recipient_keys"))
                throw Error("Owned unavailable safety query");
              return query(statement, params);
            };
            assert.deepEqual(
              (await getEnquiryForwardingSettings(admin, unavailable)).recipientReadiness,
              { checked: false, customerConflictRecipientKeys: [], distinctBlockedPhoneCount: 0 },
            );
            assert.deepEqual(await snapshot(), before);
            assert.deepEqual(wakes, []);
          },
        );

        await t.test(
          "local, 852 and 00852 customer phones expose only trusted conflict keys and block the whole activation",
          async () => {
            const duplicateCopy = await staff({
              publicProfile: true,
              whatsapp: ENQUIRY_COPY.phone,
            });
            const photographed = ENQUIRY_MANAGERS["manager:2"];
            await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
              photographed.staffId,
              photographed.phone,
            ]);
            const expectedConflicts = [
              "copy",
              `sales:${duplicateCopy.staffId}`,
              `sales:${sales.staffId}`,
              "manager:2",
              `sales:${photographed.staffId}`,
            ].sort();
            const rows = [];
            try {
              for (const spelling of ["local", "852", "00852"]) {
                await reset();
                await proof();
                for (const number of [ENQUIRY_COPY.phone, "85295551234", photographed.phone]) {
                  const value =
                    spelling === "local"
                      ? number.slice(3)
                      : spelling === "00852"
                        ? `00${number}`
                        : number;
                  const [customer] = await query(
                    "INSERT INTO crm_contacts(name,email,source,phone,normalized_phone,whatsapp_member_id) VALUES('Owned confidential customer',$1,'whatsapp',$2,$2,$3) RETURNING id",
                    [
                      `private-${spelling}-${number}@example.invalid`,
                      value,
                      `private-member-${spelling}-${number.slice(-3)}`,
                    ],
                  );
                  rows.push(customer.id);
                }
                const before = await snapshot();
                const customerBefore = await query(
                  "SELECT * FROM crm_contacts WHERE id=ANY($1::uuid[]) ORDER BY id",
                  [rows],
                );
                const settings = await getEnquiryForwardingSettings(admin, query);
                assert.deepEqual(settings.recipientReadiness, {
                  checked: true,
                  customerConflictRecipientKeys: expectedConflicts,
                  distinctBlockedPhoneCount: 3,
                });
                const publicResult = JSON.stringify(settings);
                assert.equal(publicResult.includes("Owned confidential customer"), false);
                assert.equal(publicResult.includes("private-member-"), false);
                assert.equal(publicResult.includes("@example.invalid"), false);
                for (const customerId of rows)
                  assert.equal(publicResult.includes(customerId), false);
                assert.deepEqual(
                  await snapshot(),
                  before,
                  "GET never changes registry, roles, audit or jobs",
                );
                let conflict;
                await assert.rejects(
                  setEnquiryForwardingEnabled(
                    { enabled: true, expectedCopyVersion: (await copy()).version },
                    admin,
                    ports,
                  ),
                  (error) => {
                    conflict = error;
                    return (
                      responseStatus(409)(error) &&
                      error.headers.get("X-Error-Code") === "RECIPIENT_IDENTITY_REVIEW_REQUIRED"
                    );
                  },
                );
                assert.match(await conflict.text(), /客戶身份重疊/);
                assert.deepEqual(
                  await snapshot(),
                  before,
                  "blocked activation never partially verifies, bumps versions or audits",
                );
                assert.deepEqual(
                  await query("SELECT * FROM crm_contacts WHERE id=ANY($1::uuid[]) ORDER BY id", [
                    rows,
                  ]),
                  customerBefore,
                );
                assert.deepEqual(wakes, []);
                // Only owned fixture rows are removed; no application identity correction is inferred.
                await query("DELETE FROM crm_contacts WHERE id=ANY($1::uuid[])", [rows]);
                rows.length = 0;
                assert.deepEqual(
                  (await getEnquiryForwardingSettings(admin, query)).recipientReadiness,
                  {
                    checked: true,
                    customerConflictRecipientKeys: [],
                    distinctBlockedPhoneCount: 0,
                  },
                );
                const version = (await copy()).version;
                assert.deepEqual(
                  await setEnquiryForwardingEnabled(
                    { enabled: true, expectedCopyVersion: version },
                    admin,
                    ports,
                  ),
                  { version: version + 1, enabled: true },
                );
              }
            } finally {
              if (rows.length)
                await query("DELETE FROM crm_contacts WHERE id=ANY($1::uuid[])", [rows]);
              await query("UPDATE staff_users SET whatsapp=NULL WHERE id=$1", [
                photographed.staffId,
              ]);
              await query(
                "UPDATE staff_users SET show_on_website=false,whatsapp=NULL WHERE id=$1",
                [duplicateCopy.staffId],
              );
              await reset();
            }
          },
        );

        await t.test(
          "the shared member guard is channel-bound and a late customer overlap blocks inside the transaction",
          async () => {
            await reset();
            await proof();
            const [customer] = await query(
              "INSERT INTO crm_contacts(name,source,phone,normalized_phone) VALUES('Owned member guard','whatsapp','98883333','85298883333') RETURNING id",
            );
            const [conversation] = await query(
              "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id) VALUES($1,'other-owned-channel','0085295551234') RETURNING id",
              [customer.id],
            );
            try {
              assert.equal(
                (await getEnquiryForwardingSettings(admin, query)).recipientReadiness
                  .distinctBlockedPhoneCount,
                0,
              );
              await query("UPDATE whatsapp_conversations SET channel_id=$2 WHERE id=$1", [
                conversation.id,
                channel,
              ]);
              const before = await snapshot();
              assert.deepEqual(
                (await getEnquiryForwardingSettings(admin, query)).recipientReadiness,
                {
                  checked: true,
                  customerConflictRecipientKeys: [`sales:${sales.staffId}`],
                  distinctBlockedPhoneCount: 1,
                },
              );
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  ports,
                ),
                (error) =>
                  responseStatus(409)(error) &&
                  error.headers.get("X-Error-Code") === "RECIPIENT_IDENTITY_REVIEW_REQUIRED",
              );
              assert.deepEqual(await snapshot(), before);
            } finally {
              await query("DELETE FROM whatsapp_conversations WHERE id=$1", [conversation.id]);
              await query("DELETE FROM crm_contacts WHERE id=$1", [customer.id]);
            }
            const before = await snapshot();
            assert.equal(
              (await getEnquiryForwardingSettings(admin, query)).recipientReadiness
                .distinctBlockedPhoneCount,
              0,
            );
            let lateCustomer;
            const concurrentPorts = {
              query,
              transaction: async (statements, options) => {
                assert.equal(options.isolationLevel, "ReadCommitted");
                [lateCustomer] = await query(
                  "INSERT INTO crm_contacts(name,source,phone,normalized_phone) VALUES('Owned late customer','whatsapp','95551234','85295551234') RETURNING id",
                );
                return transaction(statements, options);
              },
            };
            try {
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  concurrentPorts,
                ),
                (error) =>
                  responseStatus(409)(error) &&
                  error.headers.get("X-Error-Code") === "RECIPIENT_IDENTITY_REVIEW_REQUIRED",
              );
              assert.ok(lateCustomer);
              assert.deepEqual(
                await snapshot(),
                before,
                "a conflict appearing after the preflight still prevents every enable mutation",
              );
              assert.deepEqual(wakes, []);
            } finally {
              if (lateCustomer)
                await query("DELETE FROM crm_contacts WHERE id=$1", [lateCustomer.id]);
            }
          },
        );

        await t.test(
          "pause remains available with a customer overlap and no provider proof",
          async () => {
            await reset();
            await proof();
            await setEnquiryForwardingEnabled(
              { enabled: true, expectedCopyVersion: (await copy()).version },
              admin,
              ports,
            );
            const [customer] = await query(
              "INSERT INTO crm_contacts(name,source,phone,normalized_phone,opt_in_whatsapp) VALUES('Owned pause conflict','whatsapp','95551234','85295551234',true) RETURNING *",
            );
            await query(
              "DELETE FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked'",
            );
            try {
              const before = await snapshot(),
                version = (await copy()).version;
              assert.deepEqual(
                await setEnquiryForwardingEnabled(
                  { enabled: false, expectedCopyVersion: version },
                  manager,
                  ports,
                ),
                { version: version + 1, enabled: false },
              );
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM enquiry_notification_recipients WHERE enabled",
                  )
                )[0].n,
                0,
              );
              const after = await snapshot();
              assert.equal(after.audits, before.audits + 1);
              assert.equal(after.jobs, before.jobs);
              assert.equal(after.attempts, before.attempts);
              assert.deepEqual(after.roles, before.roles);
              assert.deepEqual(
                (await query("SELECT * FROM crm_contacts WHERE id=$1", [customer.id]))[0],
                customer,
              );
              assert.equal(
                (await getEnquiryForwardingSettings(admin, query)).recipientReadiness
                  .distinctBlockedPhoneCount,
                1,
              );
              assert.deepEqual(wakes, []);
            } finally {
              await query("DELETE FROM crm_contacts WHERE id=$1", [customer.id]);
            }
          },
        );

        await t.test(
          "every operation rejects forged roles, missing DB roles and inactive or unknown actors",
          async () => {
            await reset();
            const actors = [
              { ...admin, roles: ["agent"] },
              { ...noRole, roles: ["admin"] },
              { ...inactive, roles: ["manager"] },
              { staffId: randomUUID(), roles: ["admin"] },
            ];
            for (const actor of actors) {
              const before = await snapshot();
              const version = (await copy()).version;
              await assert.rejects(getEnquiryForwardingSettings(actor, query), responseStatus(403));
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: false, expectedCopyVersion: version },
                  actor,
                  ports,
                ),
                responseStatus(403),
              );
              await assert.rejects(queueEnquiryForwardingCheck(actor, ports), responseStatus(403));
              assert.deepEqual(await snapshot(), before);
            }
            assert.deepEqual(wakes, []);
          },
        );

        await t.test(
          "activation requires a fresh latest ready proof for the configured channel",
          async () => {
            const cases = [
              [],
              [{ metadata: { ...ready, infoForwarding: undefined } }],
              [{ metadata: { ...ready, channel: { ...ready.channel, archived: null } } }],
              [
                {
                  metadata: { ...ready, channel: { ...ready.channel, companyPhoneMatches: false } },
                },
              ],
              [
                {
                  metadata: {
                    ...ready,
                    template: { ...ready.template, validationComplete: false },
                  },
                },
              ],
              [
                {
                  metadata: {
                    ...ready,
                    infoForwarding: {
                      ...ready.infoForwarding,
                      ready: false,
                      reasonCodes: ["INFO_APPROVED_TEMPLATE_UNVERIFIED"],
                    },
                  },
                },
              ],
              [
                {
                  metadata: {
                    ...ready,
                    channel: { ...ready.channel, configuredChannelId: "other-owned-channel" },
                  },
                },
              ],
              [{ metadata: ready, age: "25 hours" }],
              [
                { metadata: ready, age: "1 minute" },
                {
                  metadata: {
                    ...ready,
                    infoForwarding: {
                      ...ready.infoForwarding,
                      ready: false,
                      reasonCodes: ["INFO_SENDER_UNVERIFIED"],
                    },
                  },
                },
              ],
            ];
            for (const entries of cases) {
              await reset();
              for (const entry of entries) await proof(entry.metadata, entry.age);
              const before = await snapshot();
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  ports,
                ),
                responseStatus(409),
              );
              assert.deepEqual(await snapshot(), before);
              assert.equal((await copy()).enabled, false);
            }
          },
        );

        await t.test(
          "strict inputs cannot supply arbitrary phones, recipients or client proof",
          async () => {
            await reset();
            await proof();
            for (const override of [
              { phone: "85298887777" },
              { recipients: [{ phone: "85298887777" }] },
              { metadata: { ready: true } },
              { enabled: "true" },
            ]) {
              const before = await snapshot();
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version, ...override },
                  admin,
                  ports,
                ),
                (error) => error?.name === "ZodError",
              );
              assert.deepEqual(await snapshot(), before);
            }
          },
        );

        await t.test(
          "a real-shaped protected inspector proof enables only the trusted current roster",
          async () => {
            await reset();
            const evidence = await proof();
            const version = (await copy()).version;
            const before = await snapshot();
            const roles = before.roles;
            const result = await setEnquiryForwardingEnabled(
              { enabled: true, expectedCopyVersion: version },
              manager,
              ports,
            );
            assert.deepEqual(result, { version: version + 1, enabled: true });
            const enabled = await query(
              "SELECT * FROM enquiry_notification_recipients WHERE enabled ORDER BY recipient_key",
            );
            assert.deepEqual(
              enabled.map((row) => row.recipient_key),
              expectedKeys,
            );
            for (const saved of enabled) {
              assert.equal(saved.channel_id, channel);
              assert.equal(saved.destination_type, "recipient_id");
              assert.equal(saved.destination_reference, saved.phone);
              assert.equal(saved.verification_ref, `provider-check-audit:${evidence.id}`);
              assert.equal(saved.permission_ref, ENQUIRY_ROUTING_APPROVAL);
              assert.equal(saved.permission_granted, true);
              assert.ok(saved.verified_at && saved.enabled_since);
            }
            assert.equal(
              enabled.find((row) => row.recipient_key === "copy").phone,
              ENQUIRY_COPY.phone,
            );
            assert.ok(
              enabled.every(
                (row) =>
                  ![privateSales.staffId, inactiveSales.staffId, malformedSales.staffId].includes(
                    row.staff_id,
                  ),
              ),
            );
            assert.deepEqual(
              (await snapshot()).roles,
              roles,
              "notification activation grants no staff role",
            );
            const audits = await query(
              "SELECT actor_id,metadata FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.configured'",
            );
            assert.equal(audits.length, 1);
            assert.equal(audits[0].actor_id, manager.staffId);
            assert.equal(audits[0].metadata.enabled, true);
            assert.equal(audits[0].metadata.verificationRef, `provider-check-audit:${evidence.id}`);
            assert.equal(
              (await snapshot()).jobs,
              before.jobs,
              "activation never forwards historical enquiries",
            );
            assert.equal((await snapshot()).attempts, 0);
            assert.deepEqual(wakes, []);
          },
        );

        await t.test(
          "one invalid trusted profile rolls back copy, roster and audit together",
          async () => {
            await reset();
            await proof();
            await query("UPDATE staff_users SET active=false WHERE id=$1", [
              ENQUIRY_MANAGERS["manager:3"].staffId,
            ]);
            const before = await snapshot();
            await assert.rejects(
              setEnquiryForwardingEnabled(
                { enabled: true, expectedCopyVersion: (await copy()).version },
                admin,
                ports,
              ),
              responseStatus(409),
            );
            assert.deepEqual(await snapshot(), before);
            assert.equal((await copy()).enabled, false);
          },
        );

        await t.test(
          "stale copy versions cause no partial activation, pause or extra audit",
          async () => {
            await reset();
            await proof();
            const oldVersion = (await copy()).version;
            await setEnquiryForwardingEnabled(
              { enabled: true, expectedCopyVersion: oldVersion },
              admin,
              ports,
            );
            for (const enabled of [false, true]) {
              const before = await snapshot();
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled, expectedCopyVersion: oldVersion },
                  admin,
                  ports,
                ),
                responseStatus(409),
              );
              assert.deepEqual(await snapshot(), before);
            }
          },
        );

        await t.test(
          "global pause disables every registry row without requiring a provider proof",
          async () => {
            await reset();
            await proof();
            await setEnquiryForwardingEnabled(
              { enabled: true, expectedCopyVersion: (await copy()).version },
              admin,
              ports,
            );
            const extra = await staff({ publicProfile: true, whatsapp: "95551237" });
            await query(
              "INSERT INTO enquiry_notification_recipients(recipient_key,kind,staff_id,phone,channel_id,destination_reference,enabled,verification_ref,verified_at,permission_granted,permission_ref) VALUES($1,'sales',$2,'85295551237',$3,'85295551237',true,'owned-old-provider-evidence',now(),true,'owned-old-permission')",
              [`sales:${extra.staffId}`, extra.staffId, channel],
            );
            await query("UPDATE staff_users SET show_on_website=false WHERE id=$1", [
              extra.staffId,
            ]);
            await query(
              "DELETE FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked'",
            );
            const version = (await copy()).version;
            const before = await snapshot();
            const result = await setEnquiryForwardingEnabled(
              { enabled: false, expectedCopyVersion: version },
              manager,
              ports,
            );
            assert.deepEqual(result, { version: version + 1, enabled: false });
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM enquiry_notification_recipients WHERE enabled",
                )
              )[0].n,
              0,
            );
            assert.equal((await snapshot()).jobs, before.jobs);
            assert.equal((await snapshot()).attempts, 0);
            assert.deepEqual(wakes, []);
          },
        );

        await t.test(
          "exact current purpose review permits a phone-only colleague without changing customer history",
          async () => {
            await reset();
            const colleague = await staff({
                publicProfile: true,
                whatsapp: "92786562",
                phone: "92786562",
              }),
              number = "85292786562";
            const [customer] = await query(
              "INSERT INTO crm_contacts(name,normalized_phone,whatsapp_member_id,opt_in_whatsapp,opted_out_whatsapp) VALUES('Owned current controller history',$1,'owned_prior_customer_member',false,true) RETURNING *",
              [number],
            );
            const [conversation] = await query(
              "INSERT INTO whatsapp_conversations(contact_id,channel_id,woztell_member_id,assignment_lock) VALUES($1,$2,'owned_prior_customer_member',true) RETURNING *",
              [customer.id, channel],
            );
            try {
              const infoOnly = {
                ...ready,
                ready: false,
                reasonCodes: ["CAPABILITY_REFERENCES_MISSING"],
                capabilities: {
                  whatsappVerification: false,
                  correlationVerification: false,
                  associationReview: false,
                  replyContext: false,
                },
              };
              const evidence = await proof(infoOnly),
                before = await snapshot();
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  ports,
                ),
                responseStatus(409),
              );
              assert.deepEqual(await snapshot(), before);
              const packet = await decisions.getEnquiryInfoPhoneSnapshot(scope, number, query);
              const approval = await decisions.importOwnerEnquiryInfoDecision(
                {
                  scope,
                  subject: { kind: "recipient_phone", phone: number },
                  decision: "approved",
                  expectedRevision: 0,
                  staffId: colleague.staffId,
                  expectedProfileHash: packet.profileHash,
                  expectedConflictHash: packet.conflictHash,
                },
                {
                  ...owner,
                  questionId: "owned_current_controller",
                  response: "Owned owner confirms this is still the colleague phone.",
                },
                ports,
              );
              const settings = await getEnquiryForwardingSettings(admin, query),
                recipient = settings.recipients.find(
                  (row) => row.key === `sales:${colleague.staffId}`,
                );
              assert.equal(
                settings.providerCheck.ready,
                true,
                "legacy references remain independently unready",
              );
              assert.deepEqual(settings.informationalPolicy.scope, scope);
              assert.equal(recipient.purposeReviewed, true);
              assert.equal(recipient.memberAssociated, false);
              assert.equal(settings.recipientReadiness.distinctBlockedPhoneCount, 0);
              const version = (await copy()).version;
              await setEnquiryForwardingEnabled(
                { enabled: true, expectedCopyVersion: version },
                admin,
                ports,
              );
              const [saved] = await query(
                "SELECT permission_ref,verification_ref FROM enquiry_notification_recipients WHERE recipient_key=$1",
                [recipient.key],
              );
              assert.equal(saved.permission_ref, `enq_forward_info:phone-review:${approval.id}`);
              assert.equal(saved.verification_ref, `provider-check-audit:${evidence.id}`);
              const armed = await decisions.getEnquiryInfoDecisionHead(
                scope,
                { kind: "policy" },
                query,
              );
              assert.equal(armed.decision, "armed");
              const armId = armed.id;
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
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM enquiry_forwarding_decisions WHERE subject_kind='sender_member' AND phone=$1",
                    [number],
                  )
                )[0].n,
                0,
              );
              await proof({
                ...ready,
                infoForwarding: {
                  ...ready.infoForwarding,
                  ready: false,
                  reasonCodes: ["INFO_SENDER_UNVERIFIED"],
                },
              });
              const pausePorts = {
                query: async (statement, params) => {
                  if (statement.includes("action='whatsapp.enquiry_forwarding.provider_checked'"))
                    throw Error("Pause must not read provider readiness");
                  return query(statement, params);
                },
                transaction,
              };
              await setEnquiryForwardingEnabled(
                { enabled: false, expectedCopyVersion: (await copy()).version },
                manager,
                pausePorts,
              );
              assert.equal(await decisions.getEnquiryInfoLatestArmId(scope, query), armId);
              assert.equal(
                (await decisions.getEnquiryInfoDecisionHead(scope, { kind: "policy" }, query))
                  .decision,
                "paused",
              );
              await proof();
              const [extra] = await query(
                "INSERT INTO crm_contacts(name,normalized_phone) VALUES('Owned new overlap','92786562') RETURNING id",
              );
              try {
                const beforeConflict = await snapshot();
                await assert.rejects(
                  setEnquiryForwardingEnabled(
                    { enabled: true, expectedCopyVersion: (await copy()).version },
                    admin,
                    ports,
                  ),
                  responseStatus(409),
                );
                assert.deepEqual(await snapshot(), beforeConflict);
              } finally {
                await query("DELETE FROM crm_contacts WHERE id=$1", [extra.id]);
              }
              const beforeProfile = await snapshot();
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  {
                    query,
                    transaction: async (statements, options) => {
                      await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                        colleague.staffId,
                        "92786563",
                      ]);
                      return transaction(statements, options);
                    },
                  },
                ),
                responseStatus(409),
              );
              assert.deepEqual(await snapshot(), beforeProfile);
              await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
                colleague.staffId,
                "92786562",
              ]);
              const beforeRevoke = await snapshot();
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  {
                    query,
                    transaction: async (statements, options) => {
                      await decisions.appendEnquiryInfoDecision(
                        {
                          scope,
                          subject: { kind: "recipient_phone", phone: number },
                          decision: "revoked",
                          expectedRevision: 1,
                        },
                        manager,
                        ports,
                      );
                      return transaction(statements, options);
                    },
                  },
                ),
                responseStatus(409),
              );
              const afterRevoke = await snapshot();
              assert.deepEqual(afterRevoke.recipients, beforeRevoke.recipients);
              assert.equal(afterRevoke.audits, beforeRevoke.audits);
              assert.equal(afterRevoke.decisions, beforeRevoke.decisions + 1);
            } finally {
              await query("DELETE FROM whatsapp_conversations WHERE id=$1", [conversation.id]);
              await query("DELETE FROM crm_contacts WHERE id=$1", [customer.id]);
              await query("UPDATE staff_users SET show_on_website=false WHERE id=$1", [
                colleague.staffId,
              ]);
              await reset();
            }
          },
        );
        await t.test(
          "provider and release changes during locking fail closed and an arm failure rolls back configuration",
          async () => {
            await reset();
            await proof();
            let before = await snapshot();
            await assert.rejects(
              setEnquiryForwardingEnabled(
                { enabled: true, expectedCopyVersion: (await copy()).version },
                admin,
                {
                  query,
                  transaction: async (statements, options) => {
                    await proof({
                      ...ready,
                      channel: { ...ready.channel, archived: null },
                      infoForwarding: {
                        ...ready.infoForwarding,
                        ready: false,
                        reasonCodes: ["INFO_CHANNEL_ARCHIVE_UNVERIFIED"],
                      },
                    });
                    return transaction(statements, options);
                  },
                },
              ),
              responseStatus(409),
            );
            let after = await snapshot();
            assert.deepEqual(after.recipients, before.recipients);
            assert.equal(after.decisions, before.decisions);
            assert.equal(after.audits, before.audits + 1);
            await reset();
            await proof();
            before = await snapshot();
            let extraRelease;
            try {
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  {
                    query,
                    transaction: async (statements, options) => {
                      [extraRelease] = await query(
                        "INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('whatsapp.enquiry_forwarding.check_requested','ops_job',$1,$2::jsonb) RETURNING id",
                        [
                          releaseJob.id,
                          JSON.stringify({
                            source: "approved_deployment_verification",
                            releaseSha: baseEnv.VERCEL_GIT_COMMIT_SHA,
                          }),
                        ],
                      );
                      return transaction(statements, options);
                    },
                  },
                ),
                responseStatus(409),
              );
              after = await snapshot();
              assert.deepEqual(after.recipients, before.recipients);
              assert.equal(after.decisions, before.decisions);
            } finally {
              if (extraRelease)
                await query("DELETE FROM audit_logs WHERE id=$1", [extraRelease.id]);
            }
            await reset();
            await proof();
            before = await snapshot();
            await query(
              "CREATE FUNCTION owned_reject_info_arm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject_kind='policy' AND NEW.decision='armed' THEN RAISE EXCEPTION 'OWNED_ARM_WRITE_FAIL'; END IF; RETURN NEW; END $$",
            );
            await query(
              "CREATE TRIGGER owned_reject_info_arm BEFORE INSERT ON enquiry_forwarding_decisions FOR EACH ROW EXECUTE FUNCTION owned_reject_info_arm()",
            );
            try {
              await assert.rejects(
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: (await copy()).version },
                  admin,
                  ports,
                ),
                /OWNED_ARM_WRITE_FAIL/,
              );
              assert.deepEqual(await snapshot(), before);
            } finally {
              await query("DROP TRIGGER owned_reject_info_arm ON enquiry_forwarding_decisions");
              await query("DROP FUNCTION owned_reject_info_arm()");
            }
          },
        );
        await t.test(
          "trusted Owner activation records NULL staff provenance and cannot be selected through the public API",
          async () => {
            await reset();
            await proof();
            const before = await snapshot(),
              version = (await copy()).version;
            const result = await enableEnquiryForwardingFromOwnerInstruction(
              { expectedCopyVersion: version },
              owner,
              ports,
            );
            assert.equal(result.enabled, true);
            assert.equal(result.version, version + 1);
            const [decision] = await query(
              "SELECT * FROM enquiry_forwarding_decisions WHERE id=$1",
              [result.armId],
            );
            assert.equal(decision.authority_kind, "owner_instruction");
            assert.equal(decision.actor_staff_id, null);
            assert.equal(decision.evidence.ownerInstruction.sourceSha256, owner.sourceSha256);
            const [audit] = await query(
              "SELECT actor_id,metadata FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.configured'",
            );
            assert.equal(audit.actor_id, null);
            assert.equal(audit.metadata.authorityKind, "owner_instruction");
            assert.deepEqual((await snapshot()).roles, before.roles);
            const stable = await snapshot();
            await assert.rejects(
              setEnquiryForwardingEnabled(
                { enabled: true, expectedCopyVersion: result.version, ownerInstruction: owner },
                admin,
                ports,
              ),
              (error) => error.name === "ZodError",
            );
            await assert.rejects(
              setEnquiryForwardingEnabled(
                { enabled: true, expectedCopyVersion: result.version },
                noRole,
                ports,
              ),
              responseStatus(403),
            );
            await assert.rejects(
              enableEnquiryForwardingFromOwnerInstruction(
                { expectedCopyVersion: result.version },
                { ...owner, photoSha256: undefined },
                ports,
              ),
            );
            assert.deepEqual(await snapshot(), stable);
          },
        );
        await t.test(
          "readiness request queues only its non-message job and wakes after committed audit",
          async () => {
            await reset();
            const before = await snapshot();
            const requested = await queueEnquiryForwardingCheck(admin, ports);
            const jobs = await query(
              "SELECT * FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness' AND actor_staff_id IS NOT NULL",
            );
            assert.equal((await snapshot()).jobs, before.jobs + 1);
            assert.equal(jobs.length, 1);
            assert.equal(jobs[0].id, requested.jobId);
            assert.equal(jobs[0].job_type, "woztell.enquiry.forward.readiness");
            assert.deepEqual(jobs[0].payload, {});
            assert.equal(jobs[0].payload_version, 1);
            assert.equal(jobs[0].max_attempts, 2);
            assert.equal(jobs[0].status, "queued");
            assert.equal(jobs[0].actor_staff_id, admin.staffId);
            assert.match(jobs[0].idempotency_key, /^enquiry-forward-readiness:[0-9a-f-]{36}$/);
            const audits = await query(
              "SELECT * FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.check_requested' AND actor_id IS NOT NULL",
            );
            assert.equal(audits.length, 1);
            assert.equal(audits[0].subject_id, requested.jobId);
            assert.equal(audits[0].actor_id, admin.staffId);
            assert.deepEqual(wakes, ["service"]);
            assert.deepEqual(
              (await Promise.all(wakeObservations)).map((rows) => rows.map((row) => row.id)),
              [[requested.jobId]],
            );
            assert.deepEqual((await snapshot()).recipients, before.recipients);
            assert.equal((await snapshot()).attempts, 0);
          },
        );

        await t.test(
          "a failed post-commit wake returns the committed readiness job without leaking errors",
          async () => {
            await reset();
            const warningCalls = [];
            const warning = mock.method(console, "warn", (...args) => warningCalls.push(args));
            wakeError = Error("owned-private-wake-detail-must-not-log");
            try {
              const result = await queueEnquiryForwardingCheck(admin, ports);
              const jobs = await query(
                "SELECT id FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness' AND actor_staff_id IS NOT NULL",
              );
              assert.deepEqual(
                jobs.map((row) => row.id),
                [result.jobId],
              );
              const audits = await query(
                "SELECT subject_id FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.check_requested' AND actor_id IS NOT NULL",
              );
              assert.deepEqual(
                audits.map((row) => row.subject_id),
                [result.jobId],
              );
              assert.deepEqual(wakes, ["service"]);
              assert.doesNotMatch(JSON.stringify(warningCalls), /owned-private-wake-detail/);
            } finally {
              wakeError = null;
              warning.mock.restore();
            }
          },
        );
        await t.test(
          "queue failure never wakes a worker or leaves a partial readiness job",
          async () => {
            await reset();
            const before = await snapshot();
            await query(
              "CREATE FUNCTION owned_reject_forward_check_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='whatsapp.enquiry_forwarding.check_requested' THEN RAISE EXCEPTION 'OWNED_CHECK_AUDIT_FAILURE'; END IF; RETURN NEW; END $$",
            );
            await query(
              "CREATE TRIGGER owned_reject_forward_check_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION owned_reject_forward_check_audit()",
            );
            try {
              await assert.rejects(
                queueEnquiryForwardingCheck(admin, ports),
                /OWNED_CHECK_AUDIT_FAILURE/,
              );
              assert.deepEqual(await snapshot(), before);
              assert.deepEqual(wakes, []);
            } finally {
              await query("DROP TRIGGER owned_reject_forward_check_audit ON audit_logs");
              await query("DROP FUNCTION owned_reject_forward_check_audit()");
            }
          },
        );

        await t.test(
          "concurrent ReadCommitted activation reports one clean CAS conflict after fresh policy locks",
          async () => {
            await reset();
            await proof();
            const version = (await copy()).version;
            let entered = 0,
              release;
            const barrier = new Promise((resolve) => {
              release = resolve;
            });
            const synchronized = {
              query,
              transaction: async (statements, options) => {
                assert.equal(options.isolationLevel, "ReadCommitted");
                const client = await pool.connect();
                try {
                  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
                  await client.query(
                    "SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy'",
                  );
                  if (++entered === 2) release();
                  await barrier;
                  const results = [];
                  for (const statement of statements)
                    results.push(
                      (await client.query(statement.statement, statement.params ?? [])).rows,
                    );
                  await client.query("COMMIT");
                  return results;
                } catch (error) {
                  await client.query("ROLLBACK");
                  throw error;
                } finally {
                  client.release();
                }
              },
            };
            const results = await Promise.allSettled(
              [1, 2].map(() =>
                setEnquiryForwardingEnabled(
                  { enabled: true, expectedCopyVersion: version },
                  admin,
                  synchronized,
                ),
              ),
            );
            assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
            const loser = results.find((entry) => entry.status === "rejected");
            assert.ok(
              responseStatus(409)(loser.reason),
              `expected a 409 CAS conflict; got ${loser.reason?.code ?? loser.reason?.status}`,
            );
            assert.equal((await copy()).version, version + 1);
            assert.equal(
              (
                await query(
                  "SELECT count(*)::int n FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.configured'",
                )
              )[0].n,
              1,
            );
          },
        );
        await t.test(
          "the registered readiness handler stores only protected UUID evidence under its own lease",
          async () => {
            await reset();
            const duplicateSales = await staff({
              publicProfile: true,
              whatsapp: "00852 9555-1234",
            });
            const duplicateCopy = await staff({ publicProfile: true, whatsapp: "+852 9798 7774" });
            const photographed = ENQUIRY_MANAGERS["manager:2"];
            await query("UPDATE staff_users SET whatsapp=$2 WHERE id=$1", [
              photographed.staffId,
              "+852 9100 5322",
            ]);
            const expectedPhones = [
              ENQUIRY_COPY.phone,
              ...Object.values(ENQUIRY_MANAGERS).map(({ phone }) => phone),
              "85295551234",
            ];
            const rosterReadsBefore = trustedRosterReads;
            const inspectionInputs = [];
            let inspections = 0;
            let duringInspection = async () => {};
            const providerModule = mock.module(
              new URL(
                "../whatsapp-enquiries/enquiry-forwarding-provider.server.ts",
                import.meta.url,
              ).href,
              {
                exports: {
                  inspectEnquiryForwardingProvider: async (options) => {
                    inspections++;
                    inspectionInputs.push(structuredClone(options));
                    await duringInspection();
                    return structuredClone(ready);
                  },
                },
              },
            );
            try {
              const { getJobHandler } = await import("../control-plane/job-handlers.server.ts");
              const handler = getJobHandler("woztell.enquiry.forward.readiness", 1);
              assert.ok(handler);
              assert.deepEqual(handler.parsePayload({}), {});
              for (const payload of [
                { phone: "85298887777" },
                { recipientPhones: ["85298887777"] },
                [],
                null,
              ])
                assert.throws(
                  () => handler.parsePayload(payload),
                  (error) => error.code === "VALIDATION_ERROR",
                );
              assert.equal(
                trustedRosterReads,
                rosterReadsBefore,
                "invalid client payloads cannot read the roster",
              );
              const queued = await queueEnquiryForwardingCheck(admin, ports);
              const workerId = "owned-provider-readiness-worker";
              await transaction([
                {
                  statement: "SELECT set_config('app.wa_worker_capabilities',$1,true)",
                  params: [JSON.stringify(["woztell.enquiry.forward.readiness@1"])],
                },
                {
                  statement:
                    "UPDATE ops_jobs SET status='running',attempt_count=1,lease_owner=$2,lease_expires_at=now()+interval '10 minutes' WHERE id=$1::uuid",
                  params: [queued.jobId, workerId],
                },
              ]);
              const context = {
                jobId: queued.jobId,
                workerId,
                attempt: 1,
                checkpoint: async () => {},
              };
              const beforeInspection = await snapshot();
              const result = await handler.run({}, context);
              const afterInspection = await snapshot();
              assert.deepEqual(afterInspection.recipients, beforeInspection.recipients);
              assert.deepEqual(afterInspection.roles, beforeInspection.roles);
              assert.equal(afterInspection.attempts, beforeInspection.attempts);
              assert.equal(afterInspection.jobs, beforeInspection.jobs);
              assert.equal(afterInspection.audits, beforeInspection.audits + 1);
              assert.deepEqual(result, { summary: { ready: 1, blockers: 0 } });
              assert.equal(inspections, 1);
              assert.equal(trustedRosterReads, rosterReadsBefore + 1);
              assert.equal(inspectionInputs.length, 1);
              assert.deepEqual(Object.keys(inspectionInputs[0]).sort(), [
                "informationalInstallation",
                "recipientPhones",
              ]);
              assert.deepEqual(
                inspectionInputs[0].recipientPhones,
                expectedPhones,
                "only canonical deduplicated fixed contacts and active public valid Sales reach the inspector",
              );
              const installation = inspectionInputs[0].informationalInstallation;
              assert.equal(installation.purpose, "enq_forward_info");
              assert.equal(installation.version, 1);
              assert.equal(installation.appId, process.env.WOZTELL_APP_ID);
              assert.equal(installation.channelId, process.env.WOZTELL_CHANNEL_ID);
              assert.equal(installation.runtimeBuildSha, process.env.VERCEL_GIT_COMMIT_SHA);
              assert.equal(installation.verifiedBuildSha, installation.runtimeBuildSha);
              assert.equal(installation.schemaAvailable, true);
              assert.equal(installation.receiptAdmissionVersion, 1);
              assert.equal(installation.neutralHoldVersion, 1);
              assert.equal(installation.templateTransportVersion, 1);
              const [release] = await query(
                "SELECT actor_id,metadata FROM audit_logs WHERE id=$1 AND action='whatsapp.enquiry_forwarding.check_requested'",
                [installation.releaseAuditId],
              );
              assert.equal(release.actor_id, null);
              assert.equal(release.metadata.source, "approved_deployment_verification");
              assert.equal(release.metadata.releaseSha, installation.runtimeBuildSha);
              assert.ok(
                !inspectionInputs[0].recipientPhones.some((phone) =>
                  ["85295551235", "85295551236", "not-a-phone", "85298887777"].includes(phone),
                ),
              );
              const audits = await query(
                "SELECT actor_id,subject_type,subject_id,metadata FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked'",
              );
              assert.equal(audits.length, 1);
              assert.equal(audits[0].actor_id, null);
              assert.equal(audits[0].subject_type, "ops_job");
              assert.equal(audits[0].subject_id, queued.jobId);
              assert.deepEqual(audits[0].metadata, ready);
              assert.doesNotMatch(
                JSON.stringify(audits),
                /owned-test-(bot|open|channel)-credential|owned-test-webhook-secret/,
              );
              for (const invalid of [
                { ...context, workerId: "other-owned-worker" },
                { ...context, workerId: undefined },
              ]) {
                await assert.rejects(handler.run({}, invalid));
                assert.equal(
                  inspections,
                  1,
                  "an invalid lease never inspects private provider configuration",
                );
                assert.equal(
                  trustedRosterReads,
                  rosterReadsBefore + 1,
                  "an invalid lease never reads recipient phones",
                );
              }
              const [wrongType] = await query(
                "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,attempt_count,run_after,idempotency_key,lease_owner,lease_expires_at) VALUES('ai.knowledge.repair',1,'{}','running',2,1,now(),$1,$2,now()+interval '10 minutes') RETURNING id",
                [`owned-wrong-readiness-type:${randomUUID()}`, workerId],
              );
              await assert.rejects(handler.run({}, { ...context, jobId: wrongType.id }));
              assert.equal(inspections, 1);
              assert.equal(
                trustedRosterReads,
                rosterReadsBefore + 1,
                "a different job type never reads recipient phones",
              );
              const [wrongPayload] = await query(
                "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,attempt_count,run_after,idempotency_key,lease_owner,lease_expires_at) VALUES('woztell.enquiry.forward.readiness',1,$1::jsonb,'running',2,1,now(),$2,$3,now()+interval '10 minutes') RETURNING id",
                [
                  JSON.stringify({ recipientPhones: ["85298887777"] }),
                  `owned-wrong-readiness-payload:${randomUUID()}`,
                  workerId,
                ],
              );
              await assert.rejects(
                handler.run({}, { ...context, jobId: wrongPayload.id }),
                (error) => error.code === "JOB_OWNERSHIP_LOST",
              );
              assert.equal(inspections, 1);
              assert.equal(
                trustedRosterReads,
                rosterReadsBefore + 1,
                "a nonempty stored payload never reads recipient phones",
              );
              duringInspection = async () => {
                await transaction([
                  {
                    statement: "SELECT set_config('app.wa_worker_capabilities',$1,true)",
                    params: [JSON.stringify(["woztell.enquiry.forward.readiness@1"])],
                  },
                  {
                    statement:
                      "UPDATE ops_jobs SET lease_owner='owned-replacement-worker' WHERE id=$1::uuid",
                    params: [queued.jobId],
                  },
                ]);
              };
              await assert.rejects(
                handler.run({}, context),
                (error) => error.code === "JOB_OWNERSHIP_LOST",
              );
              assert.equal(inspections, 2, "a lost lease after inspection cannot publish evidence");
              assert.equal(trustedRosterReads, rosterReadsBefore + 2);
              assert.deepEqual(
                inspectionInputs[1],
                inspectionInputs[0],
                "replacement leases cannot alter the trusted roster or actual installation evidence",
              );
              await transaction([
                {
                  statement: "SELECT set_config('app.wa_worker_capabilities',$1,true)",
                  params: [JSON.stringify(["woztell.enquiry.forward.readiness@1"])],
                },
                {
                  statement:
                    "UPDATE ops_jobs SET lease_owner=$2,lease_expires_at=now()-interval '1 minute' WHERE id=$1::uuid",
                  params: [queued.jobId, workerId],
                },
              ]);
              await assert.rejects(
                handler.run({}, context),
                (error) => error.code === "JOB_OWNERSHIP_LOST",
              );
              assert.equal(inspections, 2, "an expired lease never calls the inspector");
              assert.equal(
                trustedRosterReads,
                rosterReadsBefore + 2,
                "an expired lease never reads recipient phones",
              );
              assert.equal(
                (
                  await query(
                    "SELECT count(*)::int n FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked'",
                  )
                )[0].n,
                1,
              );
              assert.equal(
                (await snapshot()).attempts,
                0,
                "readiness cannot create a notification attempt",
              );
            } finally {
              providerModule.restore();
              await query("UPDATE staff_users SET whatsapp=NULL WHERE id=$1", [
                photographed.staffId,
              ]);
              await query(
                "UPDATE staff_users SET show_on_website=false,whatsapp=NULL WHERE id=ANY($1::uuid[])",
                [[duplicateSales.staffId, duplicateCopy.staffId]],
              );
            }
          },
        );
        await t.test(
          "admin health counts reviewed enquiry subjects once across recipient attempts",
          async () => {
            await reset();
            const subjects = [];
            for (const suffix of [1, 2, 3]) {
              const [contact] = await query(
                "INSERT INTO crm_contacts(name,phone,normalized_phone) VALUES('Owned review fixture',$1,$2) RETURNING id",
                [`9888000${suffix}`, `8529888000${suffix}`],
              );
              const [lead] = await query(
                "INSERT INTO crm_leads(contact_id,source) VALUES($1,'website') RETURNING id",
                [contact.id],
              );
              subjects.push(lead.id);
            }
            const attempts = [
              [
                subjects[0],
                { purpose: "enquiry_forward", source: "website", routingKind: "review" },
                "0 seconds",
              ],
              [
                subjects[0],
                { purpose: "enquiry_forward", source: "website", routingKind: "review" },
                "0 seconds",
              ],
              [
                subjects[1],
                {
                  purpose: "enquiry_forward",
                  source: "website",
                  routingKind: "property",
                  reason: "property_sales_unavailable",
                },
                "0 seconds",
              ],
              [
                subjects[2],
                { purpose: "enquiry_forward", source: "website", routingKind: "review" },
                "8 days",
              ],
              [
                subjects[2],
                { purpose: "legacy_alert", source: "website", routingKind: "review" },
                "0 seconds",
              ],
            ];
            for (const [leadId, routing, age] of attempts)
              await query(
                "INSERT INTO staff_notification_attempts(lead_id,transport,attempt_key,dispatch_state,routing_snapshot,created_at) VALUES($1,'staff_whatsapp',$2,'suppressed',$3::jsonb,now()-$4::interval)",
                [leadId, `owned-health:${randomUUID()}`, JSON.stringify(routing), age],
              );
            const before = await snapshot();
            const settings = await getEnquiryForwardingSettings(admin, query);
            assert.equal(settings.counts.needs_review, 2);
            assert.equal(settings.counts.suppressed, 3);
            assert.deepEqual(await snapshot(), before, "health GET adds no intent, job or audit");
            assert.deepEqual(wakes, []);
          },
        );
        assert.equal(network.mock.callCount(), 0, "no external provider or wake request ran");
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      mock.restoreAll();
    }
  },
);

test(
  "owned compatible pause succeeds before informational migration",
  { timeout: 120000 },
  async () => {
    const previous = Object.fromEntries(Object.keys(baseEnv).map((key) => [key, process.env[key]]));
    Object.assign(process.env, baseEnv);
    const network = mock.method(globalThis, "fetch", () => {
      throw Error("External network forbidden");
    });
    try {
      await withOwnedPostgres(
        async ({ query, transaction }) => {
          await mockOwnedServerDb(mock, query, transaction);
          const { setEnquiryForwardingEnabled, getEnquiryForwardingSettings } =
            await import("./enquiry-forwarding.server.ts");
          const id = randomUUID();
          await query("INSERT INTO staff_users(id,auth_user_id,active) VALUES($1,$2,true)", [
            id,
            `owned-legacy-pause-${id}`,
          ]);
          await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin')", [id]);
          const actor = { staffId: id, roles: ["admin"] };
          await query(
            "UPDATE enquiry_notification_recipients SET enabled=true,channel_id=$1,destination_type='recipient_id',destination_reference=phone,verified_at=now(),verification_ref='owned-before-info-provider-proof',permission_granted=true,permission_ref=$2 WHERE recipient_key='copy'",
            [channel, ENQUIRY_ROUTING_APPROVAL],
          );
          const [before] = await query(
            "SELECT * FROM enquiry_notification_recipients WHERE recipient_key='copy'",
          );
          const settings = await getEnquiryForwardingSettings(actor, query);
          assert.equal(settings.available, true);
          assert.equal(settings.informationalPolicy.available, false);
          assert.equal(settings.recipients.find((row) => row.key === "copy").enabled, true);
          const guarded = {
            query: async (statement, params) => {
              if (statement.includes("action='whatsapp.enquiry_forwarding.provider_checked'"))
                throw Error("Pause cannot require provider proof");
              return query(statement, params);
            },
            transaction,
          };
          const result = await setEnquiryForwardingEnabled(
            { enabled: false, expectedCopyVersion: before.version },
            actor,
            guarded,
          );
          assert.deepEqual(result, { enabled: false, version: before.version + 1 });
          assert.equal(
            (
              await query(
                "SELECT enabled FROM enquiry_notification_recipients WHERE recipient_key='copy'",
              )
            )[0].enabled,
            false,
          );
          assert.equal(
            (await query("SELECT to_regclass('enquiry_forwarding_decisions') IS NULL AS absent"))[0]
              .absent,
            true,
          );
          assert.equal(network.mock.callCount(), 0);
        },
        {
          migrationVersions: MIGRATION_VERSIONS.filter(
            (value) => value < "20261116010000_enquiry_information_scope.sql",
          ),
        },
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      mock.restoreAll();
    }
  },
);
