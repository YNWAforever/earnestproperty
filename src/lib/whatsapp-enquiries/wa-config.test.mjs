import assert from "node:assert/strict";
import test from "node:test";
import {
  companyChannelId,
  companyPhone,
  inboxVerificationRef,
  legacyWaNamesInUse,
  resetLegacyNameLog,
  routingEnabled,
  trackedLinksEnabled,
} from "./wa-config.server.ts";
import {
  companyFallbackLocation,
  resolveTrackingLinks,
} from "../neon/whatsapp-enquiries.server.ts";
import { serviceRuntime } from "./service-workflow.server.ts";
import { inboxConfig } from "../woztell/inbox-api.server.ts";

// FX-19c-1: the consolidated WhatsApp settings read the surviving name and fall
// back to the old one. Env is restored key by key: replacing process.env with a
// plain object would drop Node's env semantics.
const KEYS = [
  "EP_WA_COMPANY_PHONE",
  "VITE_CONTACT_WHATSAPP_PHONE",
  "EP_WA_COMPANY_CHANNEL_ID",
  "WOZTELL_CHANNEL_ID",
  "EP_WA_TRACKED_LINKS_ENABLED",
  "EP_WA_ROUTING_ENABLED",
  "EP_WA_ENQUIRY_MODE",
  "EP_WA_SERVICE_AUTOMATION_ENABLED",
  "EP_WA_INBOX_VERIFICATION_REF",
  "WOZTELL_APP_ID",
  "EP_WA_INBOX_INTEGRATION_ID",
  "EP_WA_INBOX_SIGNATURE",
  "EP_WA_INBOX_LIST_THREADS_URL",
  "EP_WA_INBOX_LIST_USERS_URL",
  "EP_WA_INBOX_ASSIGN_URL",
  "EP_WA_INBOX_INTERNAL_MESSAGE_URL",
  "EP_WA_REDIRECT_GLOBAL_SHARD_PER_MIN",
  "EP_WA_REDIRECT_LINK_PER_MIN",
];
function withEnv(values, fn) {
  const saved = KEYS.map((key) => [key, Object.hasOwn(process.env, key), process.env[key]]);
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const [key, had, value] of saved) {
      if (had) process.env[key] = value;
      else delete process.env[key];
    }
  }
}
async function withEnvAsync(values, fn) {
  const saved = KEYS.map((key) => [key, Object.hasOwn(process.env, key), process.env[key]]);
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const [key, had, value] of saved) {
      if (had) process.env[key] = value;
      else delete process.env[key];
    }
  }
}

const OLD_PHONE = "85291234567";
const NEW_PHONE = "85212345678";

test("company phone resolves identically under old-only, new-only and both-names environments", () => {
  assert.equal(companyPhone({ EP_WA_COMPANY_PHONE: OLD_PHONE }), OLD_PHONE);
  assert.equal(companyPhone({ VITE_CONTACT_WHATSAPP_PHONE: OLD_PHONE }), OLD_PHONE);
  assert.equal(
    companyPhone({ EP_WA_COMPANY_PHONE: OLD_PHONE, VITE_CONTACT_WHATSAPP_PHONE: OLD_PHONE }),
    OLD_PHONE,
  );
  // Both set and different: the old name wins until the owner deletes it.
  assert.equal(
    companyPhone({ EP_WA_COMPANY_PHONE: OLD_PHONE, VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE }),
    OLD_PHONE,
  );
  // An empty string is not "set".
  assert.equal(
    companyPhone({ EP_WA_COMPANY_PHONE: "", VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE }),
    NEW_PHONE,
  );
  assert.equal(companyPhone({}), undefined);
  const oldOnly = companyFallbackLocation({ EP_WA_COMPANY_PHONE: OLD_PHONE });
  const newOnly = companyFallbackLocation({ VITE_CONTACT_WHATSAPP_PHONE: OLD_PHONE });
  const both = companyFallbackLocation({
    EP_WA_COMPANY_PHONE: OLD_PHONE,
    VITE_CONTACT_WHATSAPP_PHONE: OLD_PHONE,
  });
  assert.equal(oldOnly, newOnly);
  assert.equal(oldOnly, both);
  assert.ok(oldOnly.includes(OLD_PHONE));
});

function waNumbers(value) {
  return [...JSON.stringify(value).matchAll(/wa\.me\/(\d+)/g)].map((match) => match[1]);
}

test("companyFallbackLocation and resolveTrackingLinks never return a number that is not one of the two env values", async () => {
  const envs = [
    { EP_WA_COMPANY_PHONE: OLD_PHONE },
    { VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE },
    { EP_WA_COMPANY_PHONE: OLD_PHONE, VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE },
    { EP_WA_COMPANY_PHONE: "85200000000", VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE },
    {},
  ];
  const offers = [
    {
      propertyId: "11111111-1111-4111-8111-111111111111",
      publicListingNo: "A001",
      dealType: "sale",
      title: "測試樓盤",
    },
  ];
  for (const env of envs) {
    const allowed = [env.EP_WA_COMPANY_PHONE, env.VITE_CONTACT_WHATSAPP_PHONE].filter(Boolean);
    for (const number of waNumbers(companyFallbackLocation(env)))
      assert.ok(allowed.includes(number), `fallback ${number} not in env`);
    for (const extra of [
      {},
      { EP_WA_TRACKED_LINKS_ENABLED: "true", EP_WA_COMPANY_CHANNEL_ID: "fixture-channel" },
      { EP_WA_ENQUIRY_MODE: "active", WOZTELL_CHANNEL_ID: "fixture-channel" },
    ]) {
      const result = await withEnvAsync({ ...env, ...extra }, () =>
        resolveTrackingLinks(offers, async () => []),
      );
      for (const number of waNumbers(result))
        assert.ok(allowed.includes(number), `resolveTrackingLinks ${number} not in env`);
    }
  }
});

test("channel: old-only, new-only, both (old wins), neither is null", () => {
  assert.equal(companyChannelId({ EP_WA_COMPANY_CHANNEL_ID: "old-channel" }), "old-channel");
  assert.equal(
    companyChannelId({ WOZTELL_CHANNEL_ID: "new-channel", EP_WA_ENQUIRY_MODE: "active" }),
    "new-channel",
  );
  assert.equal(
    companyChannelId({
      EP_WA_COMPANY_CHANNEL_ID: "old-channel",
      WOZTELL_CHANNEL_ID: "new-channel",
    }),
    "old-channel",
  );
  assert.equal(companyChannelId({}), null);
  assert.equal(companyChannelId({ EP_WA_COMPANY_CHANNEL_ID: "", WOZTELL_CHANNEL_ID: "" }), null);
});

test("channel fallback to WOZTELL_CHANNEL_ID is ignored when EP_WA_ENQUIRY_MODE is unset or off", () => {
  for (const mode of [undefined, "", "off"]) {
    const env = { WOZTELL_CHANNEL_ID: "new-channel" };
    if (mode !== undefined) env.EP_WA_ENQUIRY_MODE = mode;
    assert.equal(companyChannelId(env), null, `mode ${mode}`);
    // The old name still wins regardless of mode.
    assert.equal(
      companyChannelId({ ...env, EP_WA_COMPANY_CHANNEL_ID: "old-channel" }),
      "old-channel",
    );
  }
  // General Preview today: mode unset, WOZTELL_CHANNEL_ID set -> the admin channel
  // readers and the Inbox config stay unconfigured exactly as before.
  withEnv({ ...INBOX }, () => assert.equal(inboxConfig(), null));
});

test("channel fallback to WOZTELL_CHANNEL_ID is used when EP_WA_ENQUIRY_MODE is observe or active", () => {
  for (const mode of ["observe", "active"])
    assert.equal(
      companyChannelId({ WOZTELL_CHANNEL_ID: "new-channel", EP_WA_ENQUIRY_MODE: mode }),
      "new-channel",
      `mode ${mode}`,
    );
});

test("routing is on only when mode=active, and EP_WA_ROUTING_ENABLED=false still turns it off", () => {
  assert.equal(routingEnabled({ EP_WA_ENQUIRY_MODE: "active" }), true);
  assert.equal(
    routingEnabled({ EP_WA_ENQUIRY_MODE: "active", EP_WA_ROUTING_ENABLED: "true" }),
    true,
  );
  assert.equal(
    routingEnabled({ EP_WA_ENQUIRY_MODE: "active", EP_WA_ROUTING_ENABLED: "false" }),
    false,
  );
  assert.equal(routingEnabled({ EP_WA_ENQUIRY_MODE: "active", EP_WA_ROUTING_ENABLED: "1" }), false);
  for (const mode of [undefined, "off", "observe"]) {
    const env = mode ? { EP_WA_ENQUIRY_MODE: mode } : {};
    assert.equal(routingEnabled(env), false, `mode ${mode}`);
    assert.equal(routingEnabled({ ...env, EP_WA_ROUTING_ENABLED: "true" }), false, `mode ${mode}`);
  }
});

test("tracked links: derived from mode when unset; an explicit false still turns them off", () => {
  assert.equal(trackedLinksEnabled({ EP_WA_ENQUIRY_MODE: "active" }), true);
  assert.equal(trackedLinksEnabled({ EP_WA_ENQUIRY_MODE: "observe" }), true);
  assert.equal(trackedLinksEnabled({ EP_WA_ENQUIRY_MODE: "off" }), false);
  assert.equal(trackedLinksEnabled({}), false);
  assert.equal(
    trackedLinksEnabled({ EP_WA_ENQUIRY_MODE: "active", EP_WA_TRACKED_LINKS_ENABLED: "false" }),
    false,
  );
  assert.equal(
    trackedLinksEnabled({ EP_WA_ENQUIRY_MODE: "active", EP_WA_TRACKED_LINKS_ENABLED: "true" }),
    true,
  );
  // Production today: the old switch on with mode active.
  assert.equal(trackedLinksEnabled({ EP_WA_TRACKED_LINKS_ENABLED: "true" }), true);
});

test("service automation stays off when mode=active and the service switch is unset", () => {
  withEnv({ EP_WA_ENQUIRY_MODE: "active", WOZTELL_CHANNEL_ID: "fixture-channel" }, () => {
    const runtime = serviceRuntime();
    assert.equal(runtime.enabled, false);
    assert.equal(runtime.channelId, "fixture-channel");
  });
  withEnv({ EP_WA_ENQUIRY_MODE: "active", EP_WA_SERVICE_AUTOMATION_ENABLED: "false" }, () =>
    assert.equal(serviceRuntime().enabled, false),
  );
});

const INBOX = {
  WOZTELL_APP_ID: "fixture-app",
  EP_WA_INBOX_INTEGRATION_ID: "fixture-integration",
  EP_WA_INBOX_SIGNATURE: "fixture-signature",
  WOZTELL_CHANNEL_ID: "fixture-channel",
  EP_WA_INBOX_LIST_THREADS_URL: "https://inbox.example.test/threads",
  EP_WA_INBOX_LIST_USERS_URL: "https://inbox.example.test/users",
  EP_WA_INBOX_ASSIGN_URL: "https://inbox.example.test/assign",
  EP_WA_INBOX_INTERNAL_MESSAGE_URL: "https://inbox.example.test/note",
};

test("inboxConfig is null when any of the other 8 values is missing, and uses env-config when the ref is unset", () => {
  withEnv({ ...INBOX, EP_WA_ENQUIRY_MODE: "active" }, () => {
    const config = inboxConfig();
    assert.equal(config?.verificationRef, "env-config");
    assert.equal(config?.channelId, "fixture-channel");
  });
  withEnv(
    { ...INBOX, EP_WA_ENQUIRY_MODE: "active", EP_WA_INBOX_VERIFICATION_REF: "fixture-ref" },
    () => assert.equal(inboxConfig()?.verificationRef, "fixture-ref"),
  );
  for (const key of Object.keys(INBOX)) {
    const env = { ...INBOX };
    delete env[key];
    withEnv({ ...env, EP_WA_ENQUIRY_MODE: "active" }, () =>
      assert.equal(inboxConfig(), null, `${key} missing`),
    );
  }
  assert.equal(inboxVerificationRef({}), "env-config");
});

test("legacyWaNamesInUse lists the set old names, sorted", () => {
  assert.deepEqual(legacyWaNamesInUse({}), []);
  assert.deepEqual(
    legacyWaNamesInUse({
      EP_WA_TRACKED_LINKS_ENABLED: "true",
      EP_WA_COMPANY_PHONE: OLD_PHONE,
      EP_WA_REDIRECT_LINK_PER_MIN: "600",
      EP_WA_INBOX_VERIFICATION_REF: "",
      VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE,
      WOZTELL_CHANNEL_ID: "fixture-channel",
    }),
    ["EP_WA_COMPANY_PHONE", "EP_WA_REDIRECT_LINK_PER_MIN", "EP_WA_TRACKED_LINKS_ENABLED"],
  );
});

test("the legacy-name log carries the variable name only, never a value", () => {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    resetLegacyNameLog();
    const env = {
      EP_WA_COMPANY_PHONE: OLD_PHONE,
      EP_WA_COMPANY_CHANNEL_ID: "secret-old-channel",
      EP_WA_TRACKED_LINKS_ENABLED: "true",
      EP_WA_ROUTING_ENABLED: "true",
      EP_WA_ENQUIRY_MODE: "active",
      EP_WA_INBOX_VERIFICATION_REF: "secret-inbox-ref",
    };
    for (let i = 0; i < 3; i++) {
      companyPhone(env);
      companyChannelId(env);
      trackedLinksEnabled(env);
      routingEnabled(env);
      inboxVerificationRef(env);
    }
    // New-only names never log.
    companyPhone({ VITE_CONTACT_WHATSAPP_PHONE: NEW_PHONE });
    companyChannelId({ WOZTELL_CHANNEL_ID: "new-channel" });
    const logged = calls.map((args) => args[1]?.name).sort();
    assert.deepEqual(logged, [
      "EP_WA_COMPANY_CHANNEL_ID",
      "EP_WA_COMPANY_PHONE",
      "EP_WA_INBOX_VERIFICATION_REF",
      "EP_WA_ROUTING_ENABLED",
      "EP_WA_TRACKED_LINKS_ENABLED",
    ]);
    for (const args of calls) {
      assert.equal(args[0], "[wa-config] legacy_name_in_use");
      assert.deepEqual(Object.keys(args[1]), ["name"]);
      const text = JSON.stringify(args);
      for (const value of [OLD_PHONE, "secret-old-channel", "secret-inbox-ref", "true", "active"])
        assert.ok(!text.includes(value), `log leaks ${value}`);
    }
  } finally {
    console.warn = original;
    resetLegacyNameLog();
  }
});
