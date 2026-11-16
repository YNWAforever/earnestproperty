import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
        await mockOwnedServerDb(mock, query, transaction);
        const wakes = [],
          wakeObservations = [];
        let wakeError = null;
        mock.module(new URL("../control-plane/job-wake.server.ts", import.meta.url).href, {
          exports: {
            wakeAfterCommit: (lane) => {
              wakes.push(lane);
              if (wakeError) throw wakeError;
              wakeObservations.push(
                query("SELECT id FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness'"),
              );
            },
            laneForJob: () => "service",
          },
        });
        const {
          getEnquiryForwardingSettings,
          setEnquiryForwardingEnabled,
          queueEnquiryForwardingCheck,
        } = await import("./enquiry-forwarding.server.ts");
        const { inspectEnquiryForwardingProvider } =
          await import("../whatsapp-enquiries/enquiry-forwarding-provider.server.ts");
        const ports = { query, transaction };
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
          (SELECT jsonb_agg(to_jsonb(s) ORDER BY staff_user_id,role) FROM staff_roles s) AS roles`);
          return data;
        };
        async function reset() {
          await query("UPDATE enquiry_notification_recipients SET enabled=false");
          await query("DELETE FROM audit_logs WHERE action LIKE 'whatsapp.enquiry_forwarding.%'");
          await query("DELETE FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness'");
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
              if (statement.includes("WITH customer_conflicts AS ("))
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
                assert.equal(options.isolationLevel, "Serializable");
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
              [
                {
                  metadata: {
                    ...ready,
                    ready: false,
                    reasonCodes: ["CAPABILITY_REFERENCES_MISSING"],
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
                { metadata: { ...ready, ready: false, reasonCodes: ["CHANNEL_AUTH_DENIED"] } },
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
              /ENQUIRY_RECIPIENT_PUBLIC_CONTACT_INVALID/,
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
          "readiness request queues only its non-message job and wakes after committed audit",
          async () => {
            await reset();
            const before = await snapshot();
            const requested = await queueEnquiryForwardingCheck(admin, ports);
            const jobs = await query(
              "SELECT * FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness'",
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
              "SELECT * FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.check_requested'",
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
                "SELECT id FROM ops_jobs WHERE job_type='woztell.enquiry.forward.readiness'",
              );
              assert.deepEqual(
                jobs.map((row) => row.id),
                [result.jobId],
              );
              const audits = await query(
                "SELECT subject_id FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.check_requested'",
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
          "concurrent Serializable activation reports one clean conflict without partial writes",
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
                assert.equal(options.isolationLevel, "Serializable");
                const client = await pool.connect();
                try {
                  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
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
            let inspections = 0;
            let duringInspection = async () => {};
            const providerModule = mock.module(
              new URL(
                "../whatsapp-enquiries/enquiry-forwarding-provider.server.ts",
                import.meta.url,
              ).href,
              {
                exports: {
                  inspectEnquiryForwardingProvider: async () => {
                    inspections++;
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
              assert.throws(
                () => handler.parsePayload({ phone: "85298887777" }),
                (error) => error.code === "VALIDATION_ERROR",
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
              const result = await handler.run({}, context);
              assert.deepEqual(result, { summary: { ready: 1, blockers: 0 } });
              assert.equal(inspections, 1);
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
              }
              const [wrongType] = await query(
                "INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,attempt_count,run_after,idempotency_key,lease_owner,lease_expires_at) VALUES('ai.knowledge.repair',1,'{}','running',2,1,now(),$1,$2,now()+interval '10 minutes') RETURNING id",
                [`owned-wrong-readiness-type:${randomUUID()}`, workerId],
              );
              await assert.rejects(handler.run({}, { ...context, jobId: wrongType.id }));
              assert.equal(inspections, 1);
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
