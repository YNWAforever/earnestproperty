import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { createInboxApi } from "../woztell/inbox-api.server.ts";
import { parseRegisteredJobPayload } from "../control-plane/job-handlers.server.ts";
const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("UNEXPECTED_PROVIDER_NETWORK");
};
after(() => {
  globalThis.fetch = nativeFetch;
});
const config = {
  verificationRef: "SYNTHETIC_ONLY",
  appId: "app",
  appIntegrationId: "integration",
  signature: "fixture-secret",
  channelId: "channel",
  listThreadsUrl: "https://api.inbox.woztell.sanuker.com/v1.0/api/list-threads",
  listUsersUrl: "https://api.inbox.woztell.sanuker.com/v1.0/api/list-users",
  assignUrl: "https://api.inbox.woztell.sanuker.com/v1.0/update-thread-agent",
  internalMessageUrl: "https://api.inbox.woztell.sanuker.com/v1.0/internal-message",
};
test("NT-05/06 unverified Inbox capability fails without network", () =>
  assert.throws(() => createInboxApi(null), /UNVERIFIED/));
test("NT-05/06 private note uses only documented Inbox contract and checks scope", async () => {
  const calls = [];
  const api = createInboxApi(config, async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify(
        String(url).includes("list-threads")
          ? {
              ok: 1,
              data: [
                {
                  channelId: "channel",
                  memberId: "customer",
                  userId: "agent",
                  folder: "folder",
                  threadId: "T1",
                },
              ],
            }
          : { ok: 1, memberId: "customer", threadId: "T1" },
      ),
    );
  });
  await api.postPrivateNote({
    channelId: "channel",
    memberId: "customer",
    inboxUserId: "agent",
    folderId: "folder",
    message: "Open protected work item",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, config.internalMessageUrl);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    memberId: "customer",
    message: "Open protected work item",
  });
  assert.ok(calls[1].init.headers["X-Woztell-SignedContext"]);
  await assert.rejects(
    api.readAuthoritativeAssignment({ channelId: "other", memberId: "customer" }),
    /SCOPE/,
  );
});
test("NT-11 notification jobs reject extra data and unknown versions", () => {
  for (const job of [
    "woztell.enquiry.staff.notify",
    "woztell.enquiry.staff.notify.reconcile",
    "woztell.enquiry.staff.ack.check",
  ]) {
    assert.deepEqual(
      parseRegisteredJobPayload(job, 1, { notificationId: "11111111-1111-4111-8111-111111111111" })
        .payload,
      { notificationId: "11111111-1111-4111-8111-111111111111" },
    );
    assert.throws(() =>
      parseRegisteredJobPayload(job, 1, {
        notificationId: "11111111-1111-4111-8111-111111111111",
        phone: "secret",
      }),
    );
    assert.throws(() => parseRegisteredJobPayload(job, 2, {}));
  }
});

test("NT-16 dedicated staff transport uses protected STAFF member and proven response format", async () => {
  const { createStaffWhatsAppTransport } =
    await import("../woztell/staff-whatsapp-transport.server.ts");
  const names = [
    "EP_WA_STAFF_WHATSAPP_VERIFICATION_REF",
    "EP_WA_STAFF_CORRELATION_VERIFICATION_REF",
    "EP_WA_STAFF_REPLY_CONTEXT_PATH",
    "EP_WA_STAFF_NOTIFICATIONS_ENABLED",
    "WOZTELL_CHANNEL_ID",
    "EP_WA_STAFF_ASSOCIATION_REVIEW_REF",
  ];
  const old = names.map((k) => process.env[k]);
  names.forEach(
    (k, i) =>
      (process.env[k] = [
        "SYNTHETIC",
        "SYNTHETIC",
        "context.replyTo",
        "true",
        "fixture",
        "SYNTHETIC",
      ][i]),
  );
  try {
    let sent;
    const api = createStaffWhatsAppTransport(async (input) => {
      sent = input;
      return { ok: true, body: { ok: 1, messageId: "synthetic-op" } };
    });
    const result = await api.sendStaffWhatsApp({
      channelId: "fixture",
      memberId: "staff-device",
      message: "Protected work link",
      template: null,
      beforeSend: async () => {},
    });
    assert.deepEqual(sent, {
      memberId: "staff-device",
      response: [{ type: "TEXT", text: "Protected work link" }],
    });
    assert.equal(result.providerOperationId, "synthetic-op");
    sent = undefined;
    await assert.rejects(
      api.sendStaffWhatsApp({
        channelId: "fixture",
        memberId: "staff-device",
        message: "Protected link",
        template: null,
        beforeSend: async () => {
          throw new Error("endpoint_changed");
        },
      }),
      (error) => error.code === "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED",
    );
    assert.equal(
      sent,
      undefined,
      "NT-19 direct pre-send boundary race invokes zero provider calls",
    );
  } finally {
    names.forEach((k, i) =>
      old[i] === undefined ? delete process.env[k] : (process.env[k] = old[i]),
    );
  }
});

test("NT-05 protected work link contains only opaque IDs and configured origin", async () => {
  const { staffNotificationWorkLink } = await import("./staff-notifications.server.ts");
  const old = process.env.VITE_SITE_URL;
  process.env.VITE_SITE_URL = "https://earnest.example.invalid/path";
  try {
    const link = new URL(
      staffNotificationWorkLink({
        id: "notification",
        conversation_id: "conversation",
        inquiry_id: "inquiry",
      }),
    );
    assert.equal(link.origin, "https://earnest.example.invalid");
    assert.equal(link.pathname, "/admin/whatsapp");
    assert.deepEqual([...link.searchParams.keys()], ["conversation", "enquiry", "notification"]);
  } finally {
    old === undefined ? delete process.env.VITE_SITE_URL : (process.env.VITE_SITE_URL = old);
  }
});

test("unassigned live thread may omit userId but cannot authorize a private note", async () => {
  const api = createInboxApi(
    config,
    async () =>
      new Response(
        JSON.stringify({
          ok: 1,
          data: [{ channelId: "channel", memberId: "customer", folder: "folder" }],
        }),
      ),
  );
  assert.deepEqual(
    await api.readAuthoritativeAssignment({ channelId: "channel", memberId: "customer" }),
    { inboxUserId: "", folderId: "folder" },
  );
  await assert.rejects(
    api.postPrivateNote({
      channelId: "channel",
      memberId: "customer",
      folderId: "folder",
      inboxUserId: "agent",
      message: "test",
    }),
    /PREFLIGHT_BLOCKED/,
  );
});

// Names are assembled so this file never matches its own scan.
const REMOVED_SWITCHES = [
  ["EP_WA_STAFF", "WHATSAPP_ALERTS_ENABLED"].join("_"),
  ["EP_WA_STAFF", "ACK_ESCALATION_ENABLED"].join("_"),
];
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?|json|sql|ya?ml|sh|ps1)$/.test(entry.name) ? [path] : [];
  });
}
const scanned = () => [".env.example", ...sourceFiles("src"), ...sourceFiles("scripts")];

test("only EP_WA_STAFF_NOTIFICATIONS_ENABLED gates staff notifications", async () => {
  const hits = scanned().filter((file) => {
    const text = readFileSync(file, "utf8");
    return REMOVED_SWITCHES.some((name) => text.includes(name));
  });
  assert.deepEqual(hits, []);
  assert.match(readFileSync(".env.example", "utf8"), /^EP_WA_STAFF_NOTIFICATIONS_ENABLED=/m);
  assert.match(readFileSync(".env.example", "utf8"), /^EP_WA_STAFF_ALERT_TEMPLATE=/m);
  const { staffNotificationRuntime } = await import("./staff-notifications.server.ts");
  const names = ["EP_WA_STAFF_NOTIFICATIONS_ENABLED", "EP_WA_ENQUIRY_MODE"];
  const old = names.map((name) => process.env[name]);
  try {
    process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED = "true";
    process.env.EP_WA_ENQUIRY_MODE = "active";
    assert.deepEqual(Object.keys(staffNotificationRuntime()).sort(), [
      "channelId",
      "enabled",
      "generationId",
      "template",
    ]);
    assert.equal(staffNotificationRuntime().enabled, true);
    process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED = "false";
    assert.equal(staffNotificationRuntime().enabled, false);
  } finally {
    names.forEach((name, index) =>
      old[index] === undefined ? delete process.env[name] : (process.env[name] = old[index]),
    );
  }
});

test("ack escalation has no reader", () => {
  const reader = new RegExp(["ack", "escalation"].join("_?"), "i");
  const self = join("src", "lib", "whatsapp-enquiries", "staff-notifications.test.mjs");
  const hits = sourceFiles("src").filter(
    (file) => file !== self && reader.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(hits, []);
  // Queued legacy rows must still parse; the handler stays registered.
  assert.equal(
    parseRegisteredJobPayload("woztell.enquiry.staff.ack.check", 1, {
      notificationId: "11111111-1111-4111-8111-111111111111",
    }).payload.notificationId,
    "11111111-1111-4111-8111-111111111111",
  );
});
