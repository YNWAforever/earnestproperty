import assert from "node:assert/strict";
import test from "node:test";
import { inspectEnquiryForwardingProvider } from "./enquiry-forwarding-provider.server.ts";

const channelId = "company-channel";
const secret = "test-open-credential-never-return";
const cloudSecret = "test-channel-credential-never-return";
const configuredCloudSecret = "owned_configured_cloud_access_token_value";
const bodyText = "新查詢：{{1}}，來源：{{2}}，電話：{{3}}，詳情：{{4}}";
const contract = {
  name: "staff_enquiry",
  language: "zh_HK",
  params: ["name", "source", "phone", "link"],
};
const env = () => ({
  WOZTELL_ENABLED: "true",
  WOZTELL_BOT_ACCESS_TOKEN: "test-bot-credential-never-return",
  WOZTELL_OPEN_API_TOKEN: secret,
  WOZTELL_CHANNEL_SECRET: "test-webhook-secret-never-return",
  WOZTELL_APP_ID: "app-one",
  WOZTELL_CHANNEL_ID: channelId,
  VITE_CONTACT_WHATSAPP_PHONE: "85224962283",
  EP_WA_ENQUIRY_MODE: "observe",
  EP_WA_STAFF_NOTIFICATIONS_ENABLED: "true",
  EP_WA_SERVICE_AUTOMATION_ENABLED: "false",
  EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: "test-existing-whatsapp-proof",
  EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "test-existing-correlation-proof",
  EP_WA_STAFF_ASSOCIATION_REVIEW_REF: "test-existing-association-proof",
  EP_WA_STAFF_REPLY_CONTEXT_PATH: "messageEvent.context.replyTo",
  EP_WA_STAFF_ALERT_TEMPLATE: JSON.stringify(contract),
});
const template = (patch = {}) => ({
  id: "template-one",
  name: "staff_enquiry",
  statuses: [{ language: "zh_HK", status: "APPROVED" }],
  templates: [
    { language: "zh_HK", status: "APPROVED", components: [{ type: "BODY", text: bodyText }] },
  ],
  ...patch,
});
function fixture(options = {}) {
  const calls = [];
  let templatePage = 0;
  const fetch = async (input, init) => {
    const url = new URL(String(input));
    const query = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, query });
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    if (options.respond) {
      const override = options.respond({ url, init, query, calls });
      if (override) return override;
    }
    let data;
    if (url.hostname === "open.api.woztell.com") {
      assert.equal(url.pathname, "/v3");
      assert.equal(url.search, "");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, `Bearer ${secret}`);
      assert.match(query.query, /^query /);
      assert.doesNotMatch(query.query, /mutation|sendResponses/i);
      if (query.query.includes("EarnestForwardingChannelIntegrations")) {
        assert.doesNotMatch(
          query.query,
          /\b(unmaskToken|signature|secret|appIntegrationSignature|appIntegrationAccessToken)\b/,
        );
        assert.doesNotMatch(query.query, /\benvironment\s*\(/);
        data = {
          data: {
            apiViewer: {
              channel: {
                _id: channelId,
                appId: "app-one",
                environments: options.environments ?? [],
                ...(options.integrationChannel ?? {}),
              },
            },
          },
        };
      } else if (query.query.includes("EarnestForwardingChannelIdentity")) {
        assert.doesNotMatch(query.query, /\bmutation\b/i);
        data = {
          data: {
            apiViewer: {
              channel: {
                _id: channelId,
                appId: "app-one",
                wabaStatus: options.identity?.wabaStatus ?? null,
                wabaError: options.identity?.wabaError ?? null,
                wabaInfo: options.identity?.wabaInfo ?? null,
                wabaIntegration: options.identity?.wabaIntegration ?? null,
                environments: options.environments ?? [],
              },
            },
          },
        };
      } else if (query.query.includes("EarnestForwardingEnvironmentSignature")) {
        assert.equal(query.variables.env, options.environmentId ?? "env-one");
        data = {
          data: {
            apiViewer: {
              channel: {
                _id: channelId,
                appId: "app-one",
                environment:
                  options.signature === null
                    ? null
                    : {
                        envId: options.environmentId ?? "env-one",
                        appIntegrationSignature: options.signature ?? "signed-context-credential",
                        integration: {
                          _id: "integration-one",
                          integrationId: "whatsapp-cloud",
                          build: 3,
                        },
                      },
              },
            },
          },
        };
      } else if (query.query.includes("EarnestForwardingMembers")) {
        data = {
          data: {
            apiViewer: {
              members: {
                edges: (options.members ?? []).map((node) => ({ node })),
                pageInfo: { hasNextPage: false },
              },
            },
          },
        };
      } else {
        data = {
          data: {
            apiViewer: {
              channel: {
                _id: channelId,
                appId: "app-one",
                type: "WHATSAPP",
                connected: true,
                archived: false,
                appIntegrationAccessToken: cloudSecret,
                ...(options.channel ?? {}),
              },
            },
          },
        };
      }
    } else {
      assert.equal(url.origin, "https://api.whatsapp-cloud.woztell.sanuker.com");
      assert.equal(init.method, "GET");
      assert.equal(url.searchParams.get("accessToken"), options.expectedCloudToken ?? cloudSecret);
      if (url.pathname.endsWith("/whatsapp-business-profile")) {
        assert.equal(
          url.searchParams.get("phoneNumberId"),
          options.phoneNumberId ?? "1418629391333234",
        );
        data = options.profile ?? {
          ok: 1,
          data: { vertical: "PROF_SERVICES", websites: ["https://example.test"] },
        };
      } else if (url.pathname.endsWith("/whatsapp-displayname-status")) {
        assert.equal(
          url.searchParams.get("phoneNumberId"),
          options.phoneNumberId ?? "1418629391333234",
        );
        assert.ok(init.headers["X-Woztell-Payload"]);
        assert.ok(init.headers["X-Woztell-SignedContext"]);
        data = options.displayStatus ?? {
          ok: 1,
          data: {
            id: options.phoneNumberId ?? "1418629391333234",
            account_mode: "LIVE",
            verified_name: "Earnest Property",
            display_phone_number: "+852 2496 2283",
          },
        };
      } else if (url.pathname.endsWith("/waba-info")) {
        assert.equal(url.searchParams.get("channelId"), channelId);
        data = {
          ok: 1,
          result: {
            phoneNumber: "85224962283",
            phoneNumberId: "phone-one",
            wabaId: "waba-one",
            ...(options.sender ?? {}),
          },
        };
      } else {
        assert.equal(url.pathname, "/v1.2/api/whatsapp-message-templates");
        assert.equal(url.searchParams.get("wabaId"), options.templateWabaId ?? "waba-one");
        assert.ok(["100", "10"].includes(url.searchParams.get("first")));
        data = options.pages?.[templatePage++] ?? {
          ok: 1,
          data: options.templates ?? [template()],
          paging: { hasNext: false },
        };
      }
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetch };
}
const run = (options = {}, patch = {}, extra = {}) => {
  const f = fixture(options);
  return inspectEnquiryForwardingProvider({
    env: { ...env(), ...patch },
    fetch: f.fetch,
    ...extra,
  }).then((result) => ({ result, calls: f.calls }));
};

test("authentication mode compares only v1.1 and never upgrades successful diagnostics to readiness", async () => {
  const { result, calls } = await run(
    { expectedCloudToken: configuredCloudSecret, sender: { wabaId: "1465869128784425" } },
    {
      WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret,
      WOZTELL_DIAGNOSTIC_PROBE: "authentication",
      WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425",
    },
    { recipientPhones: ["85298873493"] },
  );
  assert.deepEqual(
    result.requests.map((r) => r.stage),
    ["CHANNEL", "SENDER_V1_1", "CHANNEL_INTEGRATIONS"],
  );
  assert.deepEqual(
    calls.filter((c) => c.url.hostname !== "open.api.woztell.com").map((c) => c.url.pathname),
    ["/v1.1/api/waba-info"],
  );
  assert.deepEqual(result.versionProbe, {
    attempted: true,
    senderVerified: true,
    companyPhoneMatches: true,
    expectedWabaMatches: true,
  });
  assert.equal(result.channel.senderPhone, null);
  assert.equal(result.ready, false);
  assert.equal(result.infoForwarding.ready, false);
  assert.equal(result.template.configuredApproved, false);
  assert.equal(result.members.checked, false);
  assert.equal(result.credentialInspection.claimsReadable, false);
  assert.equal(result.credentialInspection.claimsExpired, null);
});

test("credential diagnostics decode bounded untrusted claims without retaining them", async () => {
  const payload = {
    app: "wrong-app",
    channel: channelId,
    wabaId: "1465869128784425",
    exp: 0,
    nbf: 253402300799,
    private: "private-payload-never-output",
  };
  const token =
    Buffer.from('{"alg":"HS256"}').toString("base64url") +
    "." +
    Buffer.from(JSON.stringify(payload)).toString("base64url") +
    "." +
    Buffer.from("unit-test-only").toString("base64url");
  const { result } = await run(
    { expectedCloudToken: token },
    {
      WOZTELL_CLOUD_ACCESS_TOKEN: token,
      WOZTELL_DIAGNOSTIC_PROBE: "authentication",
      WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425",
    },
  );
  assert.equal(result.credentialInspection.jwtLike, true);
  assert.equal(result.credentialInspection.claimsReadable, true);
  assert.equal(result.credentialInspection.signatureVerified, false);
  assert.equal(result.credentialInspection.claimsExpired, true);
  assert.equal(result.credentialInspection.claimsNotYetValid, true);
  assert.equal(result.credentialInspection.appClaimMatches, false);
  assert.equal(result.credentialInspection.channelClaimMatches, true);
  assert.equal(result.credentialInspection.wabaClaimMatches, true);
  for (const value of [token, payload.private, payload.app, String(payload.nbf)])
    assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(result.ready, false);
});

test("credential diagnostics identify reused tokens but never infer credential validity", async () => {
  const { result } = await run(
    { expectedCloudToken: secret },
    {
      WOZTELL_CLOUD_ACCESS_TOKEN: secret,
      WOZTELL_BOT_ACCESS_TOKEN: secret,
      WOZTELL_DIAGNOSTIC_PROBE: "authentication",
    },
  );
  assert.equal(result.credentialInspection.matchesOpenToken, true);
  assert.equal(result.credentialInspection.matchesBotToken, true);
  assert.equal(result.credentialInspection.signatureVerified, false);
  assert.equal(result.infoForwarding.ready, false);
});

test("absent configured credential skips the version probe instead of substituting a token", async () => {
  const { result, calls } = await run({}, { WOZTELL_DIAGNOSTIC_PROBE: "authentication" });
  assert.equal(result.credentialInspection.configuredPresent, false);
  assert.equal(result.versionProbe.attempted, false);
  assert.equal(
    calls.every((c) => c.url.hostname === "open.api.woztell.com"),
    true,
  );
});

test("malformed and oversized claims remain unknown while opaque credentials stay unchanged", async () => {
  for (const token of [
    "e30.bm90LWpzb24.signature",
    "e30." + "A".repeat(17000) + ".signature",
    "opaque%2Etoken\\nvalue",
  ]) {
    const { result } = await run(
      { expectedCloudToken: token },
      { WOZTELL_CLOUD_ACCESS_TOKEN: token, WOZTELL_DIAGNOSTIC_PROBE: "authentication" },
    );
    assert.equal(result.credentialInspection.claimsReadable, false);
    assert.equal(result.credentialInspection.appClaimMatches, null);
    assert.equal(result.credentialInspection.claimsExpired, null);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test("identity mode reports deprecated field presence without retaining any value", async () => {
  const privateValue = "identity-private-value-never-output";
  const { result, calls } = await run(
    {
      identity: {
        wabaStatus: "connected",
        wabaError: null,
        wabaInfo: {
          wabaId: "1465869128784425",
          phoneNumber: "85224962283",
          phoneNumberId: privateValue,
          namespace: privateValue,
          name: privateValue,
        },
        wabaIntegration: { id: privateValue, namespace: privateValue, name: privateValue },
      },
      environments: [
        {
          envId: privateValue,
          on: true,
          integrationInstalled: true,
          info: {
            integrationId: "whatsapp-cloud",
            build: 3,
            alias: privateValue,
            appIntegrationId: privateValue,
            subscribed: true,
            wabaId: "1465869128784425",
          },
          integration: { _id: privateValue, integrationId: "whatsapp-cloud", build: 3 },
        },
      ],
    },
    { WOZTELL_DIAGNOSTIC_PROBE: "identity", WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425" },
  );
  assert.equal(result.identityInspection.queried, true);
  assert.equal(result.identityInspection.refused, false);
  assert.equal(result.identityInspection.configuredWabaMatches, true);
  assert.equal(result.identityInspection.companyPhoneMatches, true);
  assert.equal(result.identityInspection.wabaInfoHasWabaId, true);
  assert.equal(result.identityInspection.wabaInfoHasPhoneNumberId, true);
  assert.equal(result.identityInspection.wabaInfoHasNamespace, true);
  assert.equal(result.identityInspection.wabaInfoHasName, true);
  assert.equal(result.identityInspection.wabaStatusPresent, true);
  assert.equal(result.identityInspection.wabaStatusConnectedLike, true);
  assert.equal(result.identityInspection.wabaErrorPresent, false);
  assert.equal(result.identityInspection.wabaIntegrationHasId, true);
  assert.deepEqual(result.identityInspection.infoKeyMembers, [
    "integrationId",
    "build",
    "alias",
    "appIntegrationId",
    "subscribed",
    "wabaId",
  ]);
  assert.deepEqual(
    result.requests.map((r) => r.stage),
    ["CHANNEL", "CHANNEL_IDENTITY", "CHANNEL_INTEGRATIONS"],
  );
  assert.equal(
    calls.some((c) => c.url.hostname === "api.whatsapp-cloud.woztell.sanuker.com"),
    false,
  );
  for (const value of [privateValue, "1465869128784425", "85224962283", "whatsapp-cloud"])
    assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(result.ready, false);
  assert.equal(result.infoForwarding.ready, false);
});

test("identity mode fails closed when the deprecated fields are refused or absent", async () => {
  const refused = await run(
    {
      respond: ({ query }) =>
        query?.query?.includes("EarnestForwardingChannelIdentity")
          ? new Response(
              JSON.stringify({ errors: [{ message: 'Field "wabaInfo" is not defined' }] }),
            )
          : undefined,
    },
    { WOZTELL_DIAGNOSTIC_PROBE: "identity" },
  );
  assert.equal(refused.result.identityInspection.queried, true);
  assert.equal(refused.result.identityInspection.refused, true);
  assert.equal(refused.result.identityInspection.wabaInfoPresent, null);
  assert.equal(refused.result.identityInspection.configuredWabaMatches, null);
  assert.equal(refused.result.ready, false);
  const absent = await run({}, { WOZTELL_DIAGNOSTIC_PROBE: "identity" });
  assert.equal(absent.result.identityInspection.refused, false);
  assert.equal(absent.result.identityInspection.wabaInfoPresent, false);
  assert.equal(absent.result.identityInspection.wabaStatusPresent, false);
  assert.equal(absent.result.identityInspection.wabaIntegrationPresent, false);
  assert.deepEqual(absent.result.identityInspection.infoKeyMembers, []);
  assert.equal(absent.result.infoForwarding.ready, false);
});

test("identity mode parses bounded JSON-encoded waba info without echoing it", async () => {
  const encoded = JSON.stringify({
    wabaId: "1465869128784425",
    displayPhoneNumber: "+852 2496 2283",
    private: "encoded-private-never-output",
  });
  const { result } = await run(
    { identity: { wabaInfo: encoded } },
    { WOZTELL_DIAGNOSTIC_PROBE: "identity", WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425" },
  );
  assert.equal(result.identityInspection.configuredWabaMatches, true);
  assert.equal(result.identityInspection.companyPhoneMatches, true);
  for (const value of [encoded, "encoded-private-never-output", "1465869128784425", "85224962283"])
    assert.equal(JSON.stringify(result).includes(value), false);
});

test("a second supplied credential is compared read-only and never grants readiness", async () => {
  const supplied = "owned_second_supplied_cloud_credential";
  const { result, calls } = await run(
    {
      expectedCloudToken: supplied,
      sender: { wabaId: "1465869128784425", phoneNumberId: "1418629391333234" },
      templateWabaId: "1465869128784425",
    },
    {
      WOZTELL_DIAGNOSTIC_CLOUD_TOKEN: supplied,
      WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425",
    },
  );
  assert.deepEqual(
    result.requests.slice(0, 4).map((r) => r.stage),
    ["CHANNEL", "CHANNEL_INTEGRATIONS", "SENDER_DIAGNOSTIC_TOKEN", "TEMPLATES_DIAGNOSTIC_TOKEN"],
  );
  assert.deepEqual(result.tokenProbe, {
    attempted: true,
    distinctFromConfigured: null,
    senderVerified: true,
    companyPhoneMatches: true,
    expectedWabaMatches: true,
    templatesReadable: true,
    templateListed: true,
    templateLanguageApproved: true,
  });
  const senderCall = calls.find((c) => c.url.pathname.endsWith("/waba-info"));
  assert.equal(senderCall.url.searchParams.get("accessToken"), supplied);
  for (const value of [supplied, "waba-one", "1465869128784425"])
    assert.equal(JSON.stringify(result).includes(value), false);
  assert.ok(result.reasonCodes.includes("TOKEN_DIAGNOSTIC_ONLY"));
  assert.equal(result.ready, false);
  assert.equal(result.infoForwarding.ready, false);
});

test("no second credential means no comparison and no diagnostic provider reads", async () => {
  const { result } = await run({}, { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret });
  assert.equal(result.tokenProbe, undefined);
  assert.equal(
    result.requests.some((r) => r.stage === "SENDER_DIAGNOSTIC_TOKEN"),
    false,
  );
  assert.equal(result.ready, false);
});

test("a supplied credential matching the configured one is flagged as reused", async () => {
  const { result } = await run(
    { expectedCloudToken: configuredCloudSecret },
    {
      WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret,
      WOZTELL_DIAGNOSTIC_CLOUD_TOKEN: configuredCloudSecret,
    },
  );
  assert.equal(result.tokenProbe.distinctFromConfigured, false);
  assert.equal(result.ready, false);
});

test("phone mode verifies identity through phoneNumberId endpoints without leaking values", async () => {
  const phoneNumberId = "1418629391333234";
  const { result, calls } = await run(
    {
      environmentId: "env-one",
      phoneNumberId,
      environments: [
        {
          envId: "env-one",
          on: true,
          integrationInstalled: true,
          info: {
            integrationId: "whatsapp-cloud",
            build: 3,
            alias: "prod",
            appIntegrationId: "integration-one",
            subscribed: true,
          },
          integration: { _id: "integration-one", integrationId: "whatsapp-cloud", build: 3 },
        },
      ],
    },
    { WOZTELL_DIAGNOSTIC_PROBE: "phone", WOZTELL_DIAGNOSTIC_PHONE_NUMBER_ID: phoneNumberId },
  );
  assert.deepEqual(
    result.requests.map((r) => r.stage),
    [
      "CHANNEL",
      "CHANNEL_INTEGRATIONS",
      "BUSINESS_PROFILE",
      "CHANNEL_SIGNATURE",
      "DISPLAYNAME_STATUS",
    ],
  );
  assert.deepEqual(result.phoneProbe, {
    attempted: true,
    profileAttempted: true,
    profileValidEnvelope: true,
    profileHasVertical: true,
    profileHasWebsites: true,
    signatureObtained: true,
    displayStatusAttempted: true,
    displayStatusValidEnvelope: true,
    displayStatusPhoneMatchesCompany: true,
    displayStatusIdMatchesConfigured: true,
    displayStatusAccountModeLive: true,
    displayStatusVerifiedNamePresent: true,
  });
  const signed = calls.find((c) => c.url.pathname.endsWith("/whatsapp-displayname-status"));
  assert.equal(
    Buffer.from(signed.init.headers["X-Woztell-SignedContext"].split(".")[1], "base64").toString(),
    JSON.stringify({ app: "app-one", appIntegration: "integration-one", channel: channelId }),
  );
  for (const value of [
    phoneNumberId,
    "signed-context-credential",
    "Earnest Property",
    "85224962283",
    "2496 2283",
    "PROF_SERVICES",
    "https://example.test",
    "integration-one",
    "env-one",
  ])
    assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(result.ready, false);
  assert.equal(result.infoForwarding.ready, false);
});

test("phone mode reports refusal and withheld signature without granting readiness", async () => {
  const phoneNumberId = "1418629391333234";
  const denied = await run(
    {
      phoneNumberId,
      environments: [
        {
          envId: "env-one",
          on: true,
          info: { integrationId: "whatsapp-cloud", build: 3 },
          integration: { _id: "integration-one", integrationId: "whatsapp-cloud", build: 3 },
        },
      ],
      respond: ({ url }) =>
        url.hostname === "api.whatsapp-cloud.woztell.sanuker.com"
          ? new Response(JSON.stringify({ ok: 0, error: "permission denied" }), { status: 500 })
          : undefined,
    },
    { WOZTELL_DIAGNOSTIC_PROBE: "phone", WOZTELL_DIAGNOSTIC_PHONE_NUMBER_ID: phoneNumberId },
  );
  assert.equal(denied.result.phoneProbe.profileValidEnvelope, false);
  assert.equal(denied.result.phoneProbe.profileHasVertical, false);
  assert.equal(denied.result.phoneProbe.displayStatusValidEnvelope, false);
  assert.equal(denied.result.phoneProbe.displayStatusPhoneMatchesCompany, null);
  assert.equal(denied.result.ready, false);
  const unsigned = await run(
    {
      phoneNumberId,
      signature: null,
      environments: [
        {
          envId: "env-one",
          on: true,
          info: { integrationId: "whatsapp-cloud", build: 3 },
          integration: { _id: "integration-one", integrationId: "whatsapp-cloud", build: 3 },
        },
      ],
    },
    { WOZTELL_DIAGNOSTIC_PROBE: "phone", WOZTELL_DIAGNOSTIC_PHONE_NUMBER_ID: phoneNumberId },
  );
  assert.equal(unsigned.result.phoneProbe.profileValidEnvelope, true);
  assert.equal(unsigned.result.phoneProbe.signatureObtained, false);
  assert.equal(unsigned.result.phoneProbe.displayStatusAttempted, false);
  assert.equal(unsigned.result.phoneProbe.displayStatusValidEnvelope, null);
});

test("phone mode stays inert without a valid configured phoneNumberId", async () => {
  const { result, calls } = await run(
    {},
    { WOZTELL_DIAGNOSTIC_PROBE: "phone", WOZTELL_DIAGNOSTIC_PHONE_NUMBER_ID: "not-digits" },
  );
  assert.equal(result.phoneProbe.attempted, false);
  assert.equal(result.phoneProbe.profileAttempted, false);
  assert.equal(
    calls.some((c) => c.url.hostname === "api.whatsapp-cloud.woztell.sanuker.com"),
    false,
  );
  assert.equal(result.infoForwarding.ready, false);
});

test("permission denial probes a distinct channel token without granting readiness or exposing credentials", async () => {
  const { result, calls } = await run(
    {
      respond: ({ url }) => {
        if (!url.pathname.endsWith("/waba-info")) return;
        if (url.searchParams.get("accessToken") === configuredCloudSecret)
          return new Response(JSON.stringify({ ok: 0, error: "permission denied" }), {
            status: 500,
          });
        assert.equal(url.searchParams.get("accessToken"), cloudSecret);
        return new Response(
          JSON.stringify({
            ok: 1,
            result: { phoneNumber: "85224962283", wabaId: "waba-one", phoneNumberId: "phone-one" },
          }),
        );
      },
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret },
  );
  assert.equal(result.tokenDiagnostics.configuredMatchesChannelToken, false);
  assert.equal(result.tokenDiagnostics.comparisonAttempted, true);
  assert.equal(result.tokenDiagnostics.comparisonSenderVerified, true);
  assert.equal(result.ready, false);
  assert.equal(result.channel.senderPhone, null);
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("/waba-info")).length, 2);
  assert.equal(
    calls.some((c) => c.url.pathname.endsWith("/whatsapp-message-templates")),
    false,
  );
  for (const value of [cloudSecret, configuredCloudSecret])
    assert.equal(JSON.stringify(result).includes(value), false);
});

test("identical tokens are never retried after permission denial", async () => {
  const { result, calls } = await run(
    {
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(JSON.stringify({ ok: 0, error: "permission denied" }), { status: 500 })
          : undefined,
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: cloudSecret },
  );
  assert.equal(result.tokenDiagnostics.configuredMatchesChannelToken, true);
  assert.equal(result.tokenDiagnostics.comparisonAttempted, false);
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("/waba-info")).length, 1);
});

test("credential format diagnostics contain booleans only", async () => {
  const value = " Bearer invalid token ";
  const { result } = await run(
    { expectedCloudToken: value.trim() },
    { WOZTELL_CLOUD_ACCESS_TOKEN: value },
  );
  assert.equal(result.tokenDiagnostics.configuredOuterWhitespace, true);
  assert.equal(result.tokenDiagnostics.configuredBearerPrefix, true);
  assert.equal(result.tokenDiagnostics.configuredInternalWhitespace, true);
  assert.equal(JSON.stringify(result).includes(value.trim()), false);
});

test("WABA comparison uses the same token without substituting sender proof", async () => {
  const waba = "1465869128784425";
  const { result, calls } = await run(
    {
      respond: ({ url }) => {
        if (!url.pathname.endsWith("/waba-info")) return;
        assert.equal(url.searchParams.get("accessToken"), configuredCloudSecret);
        if (url.searchParams.has("channelId"))
          return new Response(JSON.stringify({ ok: 0, error: "permission denied" }), {
            status: 500,
          });
        assert.equal(url.searchParams.get("wabaId"), waba);
        return new Response(
          JSON.stringify({
            ok: 1,
            result: { wabaId: waba, phoneNumber: "85224962283", phoneNumberId: "phone-one" },
          }),
        );
      },
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret, WOZTELL_DIAGNOSTIC_WABA_ID: waba },
  );
  assert.equal(result.tokenDiagnostics.wabaComparisonAttempted, true);
  assert.equal(result.tokenDiagnostics.wabaComparisonVerified, true);
  assert.equal(result.tokenDiagnostics.wabaComparisonCompanyPhoneMatches, true);
  assert.equal(result.tokenDiagnostics.comparisonAttempted, false);
  assert.equal(result.ready, false);
  assert.equal(result.channel.senderPhone, null);
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("/waba-info")).length, 2);
});

test("WABA comparison rejects mismatched response identity", async () => {
  const { result } = await run(
    {
      respond: ({ url }) => {
        if (!url.pathname.endsWith("/waba-info")) return;
        return url.searchParams.has("channelId")
          ? new Response(JSON.stringify({ ok: 0, error: "permission denied" }), { status: 500 })
          : new Response(
              JSON.stringify({
                ok: 1,
                result: {
                  wabaId: "999999999",
                  phoneNumber: "85224962283",
                  phoneNumberId: "phone-one",
                },
              }),
            );
      },
    },
    { WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425" },
  );
  assert.equal(result.tokenDiagnostics.wabaComparisonVerified, false);
  assert.equal(result.tokenDiagnostics.wabaComparisonCompanyPhoneMatches, false);
});

test("environment configuration diagnostics expose booleans only and preserve readiness failure", async () => {
  const privateValue = "unknown-environment-credential-never-output";
  const { result } = await run(
    {
      environments: [
        {
          envId: "live-env",
          on: true,
          integrationInstalled: false,
          info: {
            appIntegrationId: "binding-a",
            build: 3,
            subscribed: false,
            wabaId: "1465869128784425",
            accessToken: privateValue,
          },
          integration: { _id: "binding-b", integrationId: "whatsapp-cloud", build: 4 },
        },
      ],
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(JSON.stringify({ ok: 0, error: "permission denied" }), { status: 500 })
          : undefined,
    },
    { WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425" },
  );
  assert.deepEqual(result.environmentConfiguration, [
    {
      enabled: true,
      installed: false,
      subscribed: false,
      bindingMatches: false,
      buildMatches: false,
      configuredWabaMatches: true,
    },
  ]);
  for (const forbidden of [privateValue, "binding-a", "binding-b", "live-env"])
    assert.equal(JSON.stringify(result).includes(forbidden), false);
  assert.equal(result.ready, false);
  assert.equal(result.integrationInspection.selectedEnvironmentVerified, false);
});

test("independent template probe distinguishes Sender denial without granting readiness", async () => {
  const { result, calls } = await run(
    {
      respond: ({ url }) => {
        if (url.pathname.endsWith("/waba-info"))
          return new Response(JSON.stringify({ ok: 0, error: "permission denied" }), {
            status: 500,
          });
        if (url.pathname.endsWith("/whatsapp-message-templates")) {
          assert.equal(url.searchParams.get("wabaId"), "1465869128784425");
          assert.equal(url.searchParams.get("accessToken"), configuredCloudSecret);
          assert.equal(url.searchParams.get("name"), contract.name);
          return new Response(JSON.stringify({ ok: 1, data: [template()] }));
        }
      },
    },
    {
      WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret,
      WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425",
      WOZTELL_DIAGNOSTIC_PROBE: "templates",
    },
  );
  assert.deepEqual(result.templateProbe, {
    attempted: true,
    validResponse: true,
    configuredTemplateListed: true,
    configuredLanguageApproved: true,
  });
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("/waba-info")).length, 1);
  assert.equal(result.template.configuredApproved, false);
  assert.equal(result.template.validationComplete, false);
  assert.equal(result.ready, false);
});

test("template probe refuses malformed success envelopes and does not expose template data", async () => {
  const privateValue = "opaque-provider-content-not-for-audit";
  const { result } = await run(
    {
      respond: ({ url }) => {
        if (url.pathname.endsWith("/waba-info"))
          return new Response(JSON.stringify({ ok: 0, error: "permission denied" }), {
            status: 500,
          });
        if (url.pathname.endsWith("/whatsapp-message-templates"))
          return new Response(JSON.stringify({ ok: 1, data: { name: privateValue } }));
      },
    },
    { WOZTELL_DIAGNOSTIC_WABA_ID: "1465869128784425", WOZTELL_DIAGNOSTIC_PROBE: "templates" },
  );
  assert.deepEqual(result.templateProbe, {
    attempted: true,
    validResponse: false,
    configuredTemplateListed: false,
    configuredLanguageApproved: false,
  });
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

const informationalInstallation = () => ({
  purpose: "enq_forward_info",
  version: 1,
  appId: "app-one",
  channelId,
  schemaVersion: "20261116010000_enquiry_information_scope",
  schemaAvailable: true,
  receiptAdmissionVersion: 1,
  neutralHoldVersion: 1,
  templateTransportVersion: 1,
  runtimeBuildSha: "c".repeat(40),
  verifiedBuildSha: "c".repeat(40),
  releaseAuditId: "11111111-2222-4333-8444-555555555555",
});

test("informational provider readiness is separate from legacy action references and still requires installed isolation", async () => {
  const withoutInstallation = (await run()).result;
  assert.equal(withoutInstallation.ready, true);
  assert.equal(withoutInstallation.infoForwarding.ready, false);
  const { result } = await run(
    {},
    {
      EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: undefined,
      EP_WA_STAFF_CORRELATION_VERIFICATION_REF: undefined,
      EP_WA_STAFF_ASSOCIATION_REVIEW_REF: undefined,
      EP_WA_STAFF_REPLY_CONTEXT_PATH: undefined,
    },
    { informationalInstallation: informationalInstallation() },
  );
  assert.equal(result.ready, false);
  assert.ok(result.reasonCodes.includes("CAPABILITY_REFERENCES_MISSING"));
  assert.equal(result.channel.appId, "app-one");
  assert.equal(result.infoForwarding.ready, true);
  assert.equal(result.infoForwarding.provesWhatsappRegistration, false);
  assert.equal(result.infoForwarding.provesDelivery, false);
});

test("member-id correlation mode accepts a channel whose webhook has no reply context", async () => {
  const { result } = await run(
    {},
    {
      EP_WA_STAFF_CORRELATION_MODE: "member_id",
      EP_WA_STAFF_REPLY_CONTEXT_PATH: undefined,
      EP_WA_STAFF_CORRELATION_VERIFICATION_REF: "receipt:real-staff-reply",
    },
  );
  assert.equal(result.capabilities.replyContext, false);
  assert.equal(result.capabilities.correlationVerification, true);
  assert.ok(!result.reasonCodes.includes("CAPABILITY_REFERENCES_MISSING"));
  assert.equal(result.ready, true);
});

test("informational provider proof preserves explicit archive and scope requirements", async () => {
  const installation = informationalInstallation();
  const unknownArchive = (
    await run(
      { channel: { archived: null } },
      {},
      {
        informationalInstallation: installation,
      },
    )
  ).result;
  assert.equal(unknownArchive.infoForwarding.ready, false);
  assert.ok(unknownArchive.infoForwarding.reasonCodes.includes("INFO_CHANNEL_ARCHIVE_UNVERIFIED"));
  const wrongScope = (
    await run(
      {},
      {},
      {
        informationalInstallation: { ...installation, appId: "other-app" },
      },
    )
  ).result;
  assert.equal(wrongScope.infoForwarding.ready, false);
  assert.ok(wrongScope.infoForwarding.reasonCodes.includes("INFO_RELEASE_SCOPE_UNVERIFIED"));
});

test("the common secret boundary invalidates informational proof after provider fields are redacted", async () => {
  const privateTemplateId = "owned_private_template_key";
  const { result } = await run(
    { templates: [template({ id: privateTemplateId })] },
    {
      WOZTELL_BOT_ACCESS_TOKEN: privateTemplateId,
    },
    { informationalInstallation: informationalInstallation() },
  );
  assert.equal(result.ready, false);
  assert.equal(result.infoForwarding.ready, false);
  assert.ok(result.infoForwarding.reasonCodes.includes("SENSITIVE_PROVIDER_CONTENT_REDACTED"));
  assert.ok(!JSON.stringify(result).includes(privateTemplateId));
});

test("runtime inspection verifies scoped sender and approved four-body template without sending", async () => {
  const { result, calls } = await run();
  assert.equal(result.ready, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.integrationInspection.attempted, false);
  assert.equal(result.integrationInspection.selectedEnvironmentVerified, false);
  assert.equal(result.flags.enquiryMode, "observe");
  assert.equal(result.flags.serviceAutomationEnabled, false);
  assert.equal(result.flags.cloudAccessTokenPresent, false);
  assert.equal(result.cloudAccessTokenSource, "channel_integration");
  assert.equal(result.channel.senderPhone, "85224962283");
  assert.equal(result.channel.companyPhoneMatches, true);
  assert.equal(result.channel.senderDifferentFromFixedCopy, true);
  assert.match(result.channel.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(result.template.configuredApproved, true);
  assert.equal(result.template.validationComplete, true);
  assert.deepEqual(result.template.configured, contract);
  assert.equal(result.template.candidates[0].bodyText, bodyText);
  assert.equal(result.template.candidates[0].paramCount, 4);
  assert.deepEqual(result.members, {
    checked: false,
    complete: false,
    requestedPhoneCount: 0,
    matched: [],
    provesWhatsappRegistration: false,
  });
  assert.ok(calls.every((call) => !call.query?.query.includes("EarnestForwardingMembers")));
  assert.doesNotMatch(JSON.stringify(result), /test-.*(?:credential|secret|proof)/);
});

test("optional Cloud access token is selected explicitly while Open API authentication stays separate", async () => {
  for (const channelToken of [cloudSecret, undefined]) {
    const { result, calls } = await run(
      {
        channel: { appIntegrationAccessToken: channelToken },
        expectedCloudToken: configuredCloudSecret,
      },
      { WOZTELL_CLOUD_ACCESS_TOKEN: `  ${configuredCloudSecret}  ` },
    );
    assert.equal(result.flags.cloudAccessTokenPresent, true);
    assert.equal(result.cloudAccessTokenSource, "configured");
    assert.equal(
      result.ready,
      true,
      "owned provider results still satisfy every existing configuration gate",
    );
    assert.equal(result.members.provesWhatsappRegistration, false);
    const openCalls = calls.filter(({ url }) => url.hostname === "open.api.woztell.com");
    assert.ok(openCalls.every(({ init }) => init.headers.Authorization === `Bearer ${secret}`));
    const cloudCalls = calls.filter(
      ({ url }) => url.hostname === "api.whatsapp-cloud.woztell.sanuker.com",
    );
    assert.equal(cloudCalls.length, 2);
    assert.ok(
      cloudCalls.every(
        ({ url, init }) =>
          url.searchParams.get("accessToken") === configuredCloudSecret && init.method === "GET",
      ),
    );
    assert.ok(!result.reasonCodes.includes("CLOUD_CHANNEL_READ_TOKEN_UNAVAILABLE"));
    assert.ok(!JSON.stringify(result).includes(configuredCloudSecret));
  }
});

test("absent or blank optional Cloud token preserves the original channel fallback", async () => {
  for (const value of [undefined, "", " \t\n "]) {
    const { result, calls } = await run({}, { WOZTELL_CLOUD_ACCESS_TOKEN: value });
    assert.equal(result.flags.cloudAccessTokenPresent, false);
    assert.equal(result.cloudAccessTokenSource, "channel_integration");
    assert.equal(result.ready, true);
    assert.equal(calls.length, 3);
    assert.ok(
      calls
        .filter(({ url }) => url.hostname !== "open.api.woztell.com")
        .every(({ url }) => url.searchParams.get("accessToken") === cloudSecret),
    );
  }
  const { result, calls } = await run(
    { channel: { appIntegrationAccessToken: undefined } },
    { WOZTELL_CLOUD_ACCESS_TOKEN: " " },
  );
  assert.equal(result.cloudAccessTokenSource, "unavailable");
  assert.equal(result.flags.cloudAccessTokenPresent, false);
  assert.equal(result.ready, false);
  assert.equal(calls.length, 1);
  assert.ok(result.reasonCodes.includes("CLOUD_CHANNEL_READ_TOKEN_UNAVAILABLE"));
});

test("a configured Cloud token cannot bypass Open channel or app scope", async () => {
  for (const channel of [{ _id: "other-channel" }, { appId: "other-app" }]) {
    const { result, calls } = await run(
      { channel, expectedCloudToken: configuredCloudSecret },
      { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret },
      { recipientPhones: ["85291005322"] },
    );
    assert.equal(result.flags.cloudAccessTokenPresent, true);
    assert.equal(result.cloudAccessTokenSource, "unavailable");
    assert.equal(calls.length, 1);
    assert.equal(result.ready, false);
    assert.ok(result.reasonCodes.includes("PROVIDER_CHANNEL_SCOPE_MISMATCH"));
    assert.equal(result.members.checked, false);
  }
});

test("configured Cloud token presence never replaces required credentials or readiness evidence", async () => {
  const cases = [
    { options: { channel: { archived: null } }, reason: "PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN" },
    { options: { channel: { archived: true } }, reason: "PROVIDER_CHANNEL_ARCHIVED" },
    { options: { channel: { connected: false } }, reason: "PROVIDER_CHANNEL_NOT_CONNECTED" },
    {
      patch: {
        EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: undefined,
        EP_WA_STAFF_CORRELATION_VERIFICATION_REF: undefined,
        EP_WA_STAFF_ASSOCIATION_REVIEW_REF: undefined,
        EP_WA_STAFF_REPLY_CONTEXT_PATH: undefined,
      },
      reason: "CAPABILITY_REFERENCES_MISSING",
    },
    {
      patch: { EP_WA_STAFF_ALERT_TEMPLATE: undefined },
      reason: "STAFF_TEMPLATE_SELECTION_REQUIRED",
    },
    { options: { templates: [] }, reason: "CONFIGURED_TEMPLATE_NOT_APPROVED_BODY4" },
    { patch: { WOZTELL_BOT_ACCESS_TOKEN: undefined }, reason: "BOT_ACCESS_TOKEN_MISSING" },
    { patch: { WOZTELL_OPEN_API_TOKEN: undefined }, reason: "OPEN_API_TOKEN_MISSING" },
    { patch: { WOZTELL_CHANNEL_SECRET: undefined }, reason: "CHANNEL_SECRET_MISSING" },
    { extra: { recipientPhones: ["not-a-phone"] }, reason: "RECIPIENT_LOOKUP_INPUT_INVALID" },
    {
      options: {
        members: [
          { _id: "owned-member-one", channelId, externalId: "85291005322" },
          { _id: "owned-member-two", channelId, externalId: "85291005322" },
        ],
      },
      extra: { recipientPhones: ["85291005322"] },
      reason: "RECIPIENT_MEMBER_AMBIGUOUS",
    },
    {
      options: { sender: { phoneNumber: "85223962283" } },
      reason: "PROVIDER_SENDER_PHONE_MISMATCH",
    },
    {
      options: { sender: { phoneNumber: "85297987774" } },
      patch: { VITE_CONTACT_WHATSAPP_PHONE: "85297987774" },
      reason: "FIXED_COPY_IS_COMPANY_SENDER",
    },
  ];
  for (const item of cases) {
    const { result } = await run(
      { ...item.options, expectedCloudToken: configuredCloudSecret },
      { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret, ...item.patch },
      item.extra,
    );
    assert.equal(result.flags.cloudAccessTokenPresent, true);
    assert.equal(result.ready, false, item.reason);
    assert.ok(result.reasonCodes.includes(item.reason));
    assert.equal(result.members.provesWhatsappRegistration, false);
  }
});

test("selected and unselected Cloud credentials never leak through malicious provider fields or errors", async () => {
  const unusedChannelToken = "owned_unused_channel_access_token_value";
  const { result } = await run(
    {
      channel: { appIntegrationAccessToken: unusedChannelToken },
      expectedCloudToken: configuredCloudSecret,
      members: [{ _id: unusedChannelToken, channelId, externalId: "85291005322" }],
      templates: [template({ id: configuredCloudSecret })],
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret },
    { recipientPhones: ["85291005322"] },
  );
  assert.equal(result.cloudAccessTokenSource, "configured");
  assert.equal(result.ready, false);
  assert.ok(result.reasonCodes.includes("SENSITIVE_PROVIDER_CONTENT_REDACTED"));
  assert.equal(result.members.matched[0].memberId, "[REDACTED]");
  assert.equal(result.template.candidates[0].providerTemplateId, "[REDACTED]");
  for (const value of [configuredCloudSecret, unusedChannelToken, cloudSecret, secret])
    assert.ok(!JSON.stringify(result).includes(value));
  const failed = await run(
    {
      channel: { appIntegrationAccessToken: unusedChannelToken },
      expectedCloudToken: configuredCloudSecret,
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(
              JSON.stringify({
                ok: 0,
                error: `private-response ${configuredCloudSecret} ${unusedChannelToken}`,
              }),
              { status: 500 },
            )
          : undefined,
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret },
  );
  assert.equal(failed.result.ready, false);
  assert.ok(failed.result.reasonCodes.includes("SENDER_HTTP_FAILED"));
  for (const value of [
    configuredCloudSecret,
    unusedChannelToken,
    "private-response",
    "accessToken=",
  ])
    assert.ok(!JSON.stringify(failed.result).includes(value));
  const thrown = await run(
    {
      expectedCloudToken: configuredCloudSecret,
      respond: ({ url }) => {
        if (url.pathname.endsWith("/waba-info")) throw Error(`private-url ${url}`);
      },
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: configuredCloudSecret },
  );
  assert.equal(thrown.result.ready, false);
  assert.ok(thrown.result.reasonCodes.includes("SENDER_REQUEST_FAILED"));
  for (const value of [configuredCloudSecret, "private-url", "accessToken="])
    assert.ok(!JSON.stringify(thrown.result).includes(value));
});

test("trimmed configured Cloud credentials are redacted even before a scope failure", async () => {
  const { result } = await run(
    { channel: { _id: "other-channel" } },
    {
      WOZTELL_CLOUD_ACCESS_TOKEN: `  ${configuredCloudSecret}  `,
      EP_WA_STAFF_ALERT_TEMPLATE: JSON.stringify({ ...contract, name: configuredCloudSecret }),
    },
  );
  assert.equal(result.cloudAccessTokenSource, "unavailable");
  assert.equal(result.template.configured, null);
  assert.equal(result.ready, false);
  assert.ok(!JSON.stringify(result).includes(configuredCloudSecret));
});

test("connected channels with nullable archive status remain unready without a false disconnect reason", async () => {
  for (const archived of [null, undefined, "false"]) {
    const { result } = await run({ channel: { archived } });
    assert.equal(result.ready, false);
    assert.equal(result.channel.connected, true);
    assert.equal(result.channel.archived, null);
    assert.ok(result.reasonCodes.includes("PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN"));
    assert.ok(!result.reasonCodes.includes("PROVIDER_CHANNEL_NOT_CONNECTED"));
    assert.equal(result.template.configuredApproved, true);
  }
  const archived = (await run({ channel: { archived: true } })).result;
  assert.ok(archived.reasonCodes.includes("PROVIDER_CHANNEL_ARCHIVED"));
  assert.ok(!archived.reasonCodes.includes("PROVIDER_CHANNEL_NOT_CONNECTED"));
  const disconnected = (await run({ channel: { connected: false } })).result;
  assert.ok(disconnected.reasonCodes.includes("PROVIDER_CHANNEL_NOT_CONNECTED"));
  const unknown = (await run({ channel: { connected: null } })).result;
  assert.ok(unknown.reasonCodes.includes("PROVIDER_CHANNEL_CONNECTION_STATUS_UNKNOWN"));
  assert.ok(!unknown.reasonCodes.includes("PROVIDER_CHANNEL_NOT_CONNECTED"));
});

test("a declared live-delivery proof clears only the missing archive field", async () => {
  const proofEnv = {
    EP_WA_CHANNEL_ARCHIVE_PROOF: "live_delivery",
    EP_WA_CHANNEL_ARCHIVE_PROOF_REF: "audit:real-delivery",
  };
  const proven = await run({ channel: { archived: null } }, proofEnv);
  assert.equal(proven.result.channel.archived, null);
  assert.deepEqual(proven.result.channel.archiveProof, {
    mode: "live_delivery",
    reference: "audit:real-delivery",
  });
  assert.ok(!proven.result.reasonCodes.includes("PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN"));
  assert.equal(proven.result.ready, true);

  const declaredOnly = await run(
    { channel: { archived: null } },
    { EP_WA_CHANNEL_ARCHIVE_PROOF: "live_delivery", EP_WA_CHANNEL_ARCHIVE_PROOF_REF: undefined },
  );
  assert.equal(declaredOnly.result.channel.archiveProof, null);
  assert.ok(declaredOnly.result.reasonCodes.includes("PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN"));

  const disconnected = await run({ channel: { archived: null, connected: false } }, proofEnv);
  assert.equal(disconnected.result.channel.archiveProof, null);
  assert.ok(disconnected.result.reasonCodes.includes("PROVIDER_CHANNEL_NOT_CONNECTED"));

  const archived = await run({ channel: { archived: true } }, proofEnv);
  assert.equal(archived.result.channel.archiveProof, null);
  assert.ok(archived.result.reasonCodes.includes("PROVIDER_CHANNEL_ARCHIVED"));
  assert.equal(archived.result.ready, false);
});

test("HTTP failure observations retain status and safe shape without provider text or credentials", async () => {
  for (const status of [401, 403, 429, 404, 500]) {
    const { result, calls } = await run({
      channel: { archived: null },
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(
              JSON.stringify({
                ok: 0,
                error: `private-response ${secret} ${cloudSecret}`,
                accessToken: cloudSecret,
              }),
              { status },
            )
          : undefined,
    });
    assert.equal(
      calls.length,
      3,
      "sender failures add only the read-only integration metadata query",
    );
    assert.equal(result.ready, false);
    assert.equal(result.channel.connected, true);
    assert.equal(result.channel.senderPhone, null);
    assert.ok(result.reasonCodes.includes("PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN"));
    assert.ok(!result.reasonCodes.includes("PROVIDER_CHANNEL_NOT_CONNECTED"));
    assert.deepEqual(result.requests[1], {
      stage: "SENDER",
      httpStatus: status,
      jsonBody: true,
      hasError: true,
      providerOk: false,
      providerError: { shape: "string", knownName: null, signals: [] },
    });
    const suffix =
      status === 401 || status === 403
        ? "AUTH_DENIED"
        : status === 429
          ? "RATE_LIMITED"
          : "HTTP_FAILED";
    assert.ok(result.reasonCodes.includes(`SENDER_${suffix}`));
    const serialized = JSON.stringify(result);
    for (const forbidden of [secret, cloudSecret, "private-response", "accessToken=", "waba-info?"])
      assert.ok(!serialized.includes(forbidden));
  }
  for (const status of [200, 500]) {
    const { result } = await run({
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(`private-response ${cloudSecret}`, { status })
          : undefined,
    });
    assert.equal(result.ready, false);
    assert.deepEqual(result.requests[1], {
      stage: "SENDER",
      httpStatus: status,
      jsonBody: false,
      hasError: false,
      providerOk: null,
    });
    assert.ok(
      result.reasonCodes.includes(
        status === 200 ? "SENDER_INVALID_RESPONSE" : "SENDER_HTTP_FAILED",
      ),
    );
    assert.ok(!JSON.stringify(result).includes(cloudSecret));
  }
});

test("sender errors expose only finite observations and never relax failed readiness", async () => {
  const cases = [
    ["Invalid access token", null, ["invalid_token"]],
    ["jwt must be provided", null, ["missing_token"]],
    [
      "TypeError: Cannot read property 'private-field' of undefined",
      "TypeError",
      ["null_property_access"],
    ],
    [{ name: "TokenExpiredError", message: "jwt expired" }, "TokenExpiredError", ["expired_token"]],
    [
      { code: "INVALID_SIGNATURE", message: "jwt malformed" },
      null,
      ["malformed_token", "invalid_signature"],
    ],
    [
      { name: "TypeError", message: "Cannot read properties of null (reading 'private-field')" },
      "TypeError",
      ["null_property_access"],
    ],
    [
      { type: "OAuthException", message: "permission denied" },
      "OAuthException",
      ["permission_denied"],
    ],
    [
      "Channel not found. Integration not found.",
      null,
      ["channel_not_found", "integration_not_found"],
    ],
    [
      {
        name: "PrivateException",
        message: "private-unknown",
        code: 123456789,
        stack: "invalid token",
      },
      null,
      [],
    ],
    [[{ message: "invalid token" }], null, []],
    [{ message: "x".repeat(4097) + "invalid token" }, null, []],
  ];
  for (const [error, knownName, signals] of cases) {
    const { result } = await run(
      {
        respond: ({ url }) =>
          url.pathname.endsWith("/waba-info")
            ? new Response(JSON.stringify({ ok: 0, error }), { status: 500 })
            : undefined,
      },
      {},
      { informationalInstallation: informationalInstallation() },
    );
    assert.deepEqual(result.requests[1].providerError, {
      shape: typeof error === "string" ? "string" : Array.isArray(error) ? "array" : "object",
      knownName,
      signals,
    });
    assert.equal(result.infoForwarding.ready, false);
    assert.equal(result.channel.senderPhone, null);
    assert.equal(result.template.validationComplete, false);
    assert.ok(result.reasonCodes.includes("SENDER_HTTP_FAILED"));
    const serialized = JSON.stringify(result);
    for (const forbidden of ["private-field", "PrivateException", "private-unknown", "123456789"])
      assert.ok(!serialized.includes(forbidden));
  }
});

test("sender errors array fallback inspects only its first bounded error", async () => {
  const { result } = await run({
    respond: ({ url }) =>
      url.pathname.endsWith("/waba-info")
        ? new Response(
            JSON.stringify({
              ok: 0,
              errors: [{ message: "jwt must be provided" }, { message: "invalid signature" }],
            }),
            { status: 500 },
          )
        : undefined,
  });
  assert.deepEqual(result.requests[1].providerError, {
    shape: "object",
    knownName: null,
    signals: ["missing_token"],
  });
  assert.equal(result.ready, false);
});

test("error observations mask raw and encoded known credentials before matching", async () => {
  const privateCredential = "invalid token / permission denied";
  const { result } = await run(
    {
      expectedCloudToken: privateCredential,
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(
              JSON.stringify({
                ok: 0,
                error: {
                  name: "unknown",
                  message: `${privateCredential} ${encodeURIComponent(privateCredential)}`,
                },
              }),
              { status: 500 },
            )
          : undefined,
    },
    { WOZTELL_CLOUD_ACCESS_TOKEN: `  ${privateCredential}  ` },
  );
  assert.deepEqual(result.requests[1].providerError, {
    shape: "object",
    knownName: null,
    signals: [],
  });
  assert.ok(!JSON.stringify(result).includes(privateCredential));
  assert.ok(!JSON.stringify(result).includes(encodeURIComponent(privateCredential)));
});

test("sender failure inspects only scoped environment integration identifiers without claiming a selected environment", async () => {
  const targetPhone = "85298887777",
    memberId = "owned-staff-member";
  const { result, calls } = await run(
    {
      members: [{ _id: memberId, externalId: targetPhone, channelId }],
      environments: [
        {
          envId: "live-one",
          integration: { integrationId: "whatsapp-cloud", info: { accessToken: cloudSecret } },
          info: secret,
        },
        { envId: "sandbox-two", integration: { integrationId: "other-platform" } },
      ],
      respond: ({ url }) =>
        url.pathname.endsWith("/waba-info")
          ? new Response(JSON.stringify({ ok: 0, error: `private ${cloudSecret}` }), {
              status: 500,
            })
          : undefined,
    },
    {},
    { recipientPhones: [targetPhone] },
  );
  assert.equal(result.ready, false);
  assert.equal(result.channel.senderPhone, null);
  assert.equal(result.template.validationComplete, false);
  assert.equal(result.members.matched[0].memberId, memberId);
  assert.deepEqual(result.integrationInspection, {
    attempted: true,
    checked: true,
    complete: true,
    environmentCount: 2,
    cloudIntegrationCount: 1,
    otherIntegrationCount: 1,
    unknownIntegrationCount: 0,
    selectedEnvironmentVerified: false,
  });
  assert.deepEqual(
    result.requests.map(({ stage }) => stage),
    ["CHANNEL", "MEMBERS", "SENDER", "CHANNEL_INTEGRATIONS"],
  );
  const metadataCall = calls.at(-1);
  assert.deepEqual(metadataCall.query.variables, { app: "app-one", channel: channelId });
  assert.match(
    metadataCall.query.query,
    /environments\s*\{\s*envId\s+on\s+integrationInstalled\s+info\s+integration\s*\{_id\s+integrationId\s+build\}/,
  );
  assert.doesNotMatch(
    metadataCall.query.query,
    /\b(unmaskToken|signature|secret|appIntegrationSignature|appIntegrationAccessToken)\b|\benvironment\s*\(/,
  );
  for (const forbidden of [
    secret,
    cloudSecret,
    "private ",
    "accessToken=",
    "live-one",
    "sandbox-two",
    "other-platform",
  ])
    assert.ok(!JSON.stringify(result).includes(forbidden));
});

test("unavailable or ambiguous environment metadata preserves the original sender failure without exposing provider data", async () => {
  const variants = [
    {
      respondMetadata: () => new Response(JSON.stringify({ error: secret }), { status: 403 }),
      checked: false,
    },
    {
      respondMetadata: () => new Response(JSON.stringify({ errors: [{ message: cloudSecret }] })),
      checked: false,
    },
    { integrationChannel: { _id: "other-channel" }, checked: false },
    { integrationChannel: { appId: "other-app" }, checked: false },
    { integrationChannel: { environments: null }, checked: false },
    {
      environments: Array.from({ length: 21 }, (_, i) => ({
        envId: `env-${i}`,
        integration: null,
      })),
      checked: true,
    },
    {
      environments: [
        { envId: "same", integration: null },
        { envId: "same", integration: null },
      ],
      checked: true,
    },
    { environments: [{ envId: null, integration: null }], checked: true },
    {
      environments: [{ envId: "one", integration: { integrationId: `private ${secret}` } }],
      checked: true,
    },
  ];
  for (const variant of variants) {
    const { result } = await run({
      ...variant,
      respond: ({ url, query }) => {
        if (url.pathname.endsWith("/waba-info"))
          return new Response(JSON.stringify({ ok: 0, error: cloudSecret }), { status: 500 });
        if (query?.query.includes("EarnestForwardingChannelIntegrations"))
          return variant.respondMetadata?.();
      },
    });
    assert.equal(result.ready, false);
    assert.equal(result.channel.connected, true);
    assert.equal(result.channel.senderPhone, null);
    assert.ok(result.reasonCodes.includes("SENDER_HTTP_FAILED"));
    assert.equal(result.integrationInspection.attempted, true);
    assert.equal(result.integrationInspection.checked, variant.checked);
    assert.equal(result.integrationInspection.complete, false);
    assert.equal(result.integrationInspection.environmentCount, 0);
    assert.equal(result.integrationInspection.cloudIntegrationCount, 0);
    assert.equal(result.integrationInspection.selectedEnvironmentVerified, false);
    for (const forbidden of [secret, cloudSecret, "private "])
      assert.ok(!JSON.stringify(result).includes(forbidden));
  }
  const { result } = await run({
    environments: [],
    respond: ({ url }) =>
      url.pathname.endsWith("/waba-info")
        ? new Response(JSON.stringify({ ok: 0 }), { status: 500 })
        : undefined,
  });
  assert.equal(result.integrationInspection.complete, true);
  assert.equal(result.integrationInspection.environmentCount, 0);
  assert.equal(result.integrationInspection.cloudIntegrationCount, 0);
  assert.equal(result.integrationInspection.selectedEnvironmentVerified, false);
  assert.equal(result.ready, false);
});

test("missing capability references do not prevent read-only inspection or fabricate evidence", async () => {
  const { result, calls } = await run(
    {},
    {
      EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: undefined,
      EP_WA_STAFF_CORRELATION_VERIFICATION_REF: undefined,
      EP_WA_STAFF_ASSOCIATION_REVIEW_REF: undefined,
      EP_WA_STAFF_REPLY_CONTEXT_PATH: undefined,
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(result.ready, false);
  assert.ok(Object.values(result.capabilities).every((present) => !present));
  assert.ok(result.reasonCodes.includes("CAPABILITY_REFERENCES_MISSING"));
  assert.equal(result.template.configuredApproved, true);
});

test("approved BODY4 candidates never imply an owner-selected template or semantic field order", async () => {
  const { result } = await run({}, { EP_WA_STAFF_ALERT_TEMPLATE: undefined });
  assert.equal(result.ready, false);
  assert.equal(result.template.selectionRequired, true);
  assert.equal(result.template.configured, null);
  assert.equal(result.template.configuredApproved, false);
  assert.equal(result.template.candidates.length, 1);
  assert.equal("params" in result.template.candidates[0], false);
  assert.equal("ownerApproved" in result.template.candidates[0], false);
});

test("approval is per language and contradictory language status is rejected", async () => {
  const mixed = template({
    statuses: [
      { language: "zh_HK", status: "APPROVED" },
      { language: "en_US", status: "PENDING" },
    ],
    templates: [
      { language: "zh_HK", status: "APPROVED", components: [{ type: "BODY", text: bodyText }] },
      { language: "en_US", status: "APPROVED", components: [{ type: "BODY", text: bodyText }] },
    ],
  });
  const { result } = await run(
    { templates: [mixed] },
    { EP_WA_STAFF_ALERT_TEMPLATE: JSON.stringify({ ...contract, language: "en_US" }) },
  );
  assert.equal(result.ready, false);
  assert.equal(result.template.configuredApproved, false);
  assert.deepEqual(
    result.template.candidates.map((item) => item.language),
    ["zh_HK"],
  );
});

test("only the exact four positional placeholders are accepted", async () => {
  for (const text of [
    "{{1}} {{2}} {{3}}",
    "{{1}} {{2}} {{3}} {{4}} {{5}}",
    "{{1}} {{2}} {{4}} {{5}}",
    "{{2}} {{1}} {{3}} {{4}}",
    "{{1}} {{1}} {{3}} {{4}}",
    "{{name}} {{source}} {{phone}} {{link}}",
    "{{ 1 }} {{2}} {{3}} {{4}}",
  ]) {
    const item = template({
      templates: [{ language: "zh_HK", status: "APPROVED", components: [{ type: "BODY", text }] }],
    });
    const { result } = await run({ templates: [item] });
    assert.equal(result.template.candidates.length, 0, `reject ${text}`);
    assert.equal(result.template.configuredApproved, false);
    assert.equal(result.ready, false);
  }
});

test("media headers and dynamic buttons require unavailable parameters", async () => {
  for (const extra of [
    { type: "HEADER", format: "IMAGE" },
    { type: "HEADER", format: "TEXT", text: "{{1}}" },
    { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.invalid/{{1}}" }] },
  ]) {
    const item = template({
      templates: [
        {
          language: "zh_HK",
          status: "APPROVED",
          components: [{ type: "BODY", text: bodyText }, extra],
        },
      ],
    });
    const { result } = await run({ templates: [item] });
    assert.equal(result.ready, false);
    assert.equal(result.template.candidates.length, 0);
  }
  const item = template({
    templates: [
      {
        language: "zh_HK",
        status: "APPROVED",
        components: [
          { type: "BODY", text: bodyText },
          { type: "HEADER", format: "TEXT", text: "新查詢" },
        ],
      },
    ],
  });
  assert.equal((await run({ templates: [item] })).result.ready, true);
});

test("channel and app scope mismatches stop before any integration token is used", async () => {
  for (const channel of [{ _id: "other-channel" }, { appId: "other-app" }]) {
    const { result, calls } = await run({ channel }, {}, { recipientPhones: ["85291005322"] });
    assert.equal(calls.length, 1);
    assert.equal(result.members.checked, false);
    assert.deepEqual(result.members.matched, []);
    assert.deepEqual(
      result.requests.map(({ stage }) => stage),
      ["CHANNEL"],
    );
    assert.equal(result.ready, false);
    assert.ok(result.reasonCodes.includes("PROVIDER_CHANNEL_SCOPE_MISMATCH"));
    assert.equal(result.channel.proofHash, null);
  }
});

test("a disconnected channel or missing read token is never ready", async () => {
  assert.equal((await run({ channel: { connected: false } })).result.ready, false);
  assert.equal((await run({ channel: { archived: true } })).result.ready, false);
  const { result, calls } = await run({ channel: { appIntegrationAccessToken: undefined } });
  assert.equal(calls.length, 1);
  assert.ok(result.reasonCodes.includes("CLOUD_CHANNEL_READ_TOKEN_UNAVAILABLE"));
});

test("actual sender mismatch and the fixed-copy self-send collision block readiness", async () => {
  const mismatch = (await run({ sender: { phoneNumber: "85223962283" } })).result;
  assert.equal(mismatch.channel.companyPhoneMatches, false);
  assert.equal(mismatch.ready, false);
  assert.ok(mismatch.reasonCodes.includes("PROVIDER_SENDER_PHONE_MISMATCH"));
  const collision = (
    await run(
      { sender: { phoneNumber: "85297987774" } },
      { VITE_CONTACT_WHATSAPP_PHONE: "85297987774" },
    )
  ).result;
  assert.equal(collision.channel.companyPhoneMatches, true);
  assert.equal(collision.channel.senderDifferentFromFixedCopy, false);
  assert.equal(collision.ready, false);
});

test("provider auth errors and thrown URLs return fixed reasons without secrets or raw responses", async () => {
  const denied = await run({
    respond: () => new Response(JSON.stringify({ error: `private ${secret}` }), { status: 403 }),
  });
  assert.deepEqual(denied.result.reasonCodes, ["CHANNEL_AUTH_DENIED"]);
  const thrown = await inspectEnquiryForwardingProvider({
    env: env(),
    fetch: async () => {
      throw Error(`https://example.invalid/?accessToken=${secret}`);
    },
  });
  assert.deepEqual(thrown.reasonCodes, ["CHANNEL_REQUEST_FAILED"]);
  assert.doesNotMatch(
    JSON.stringify([denied.result, thrown]),
    /accessToken=|test-open-credential|example.invalid|private/,
  );
});

test("partial GraphQL errors and oversized bodies cannot become readiness proof", async () => {
  const errors = await run({
    respond: () =>
      new Response(
        JSON.stringify({
          data: { apiViewer: { channel: { _id: channelId } } },
          errors: [{ message: secret }],
        }),
      ),
  });
  assert.deepEqual(errors.result.reasonCodes, ["CHANNEL_QUERY_REFUSED"]);
  const large = await run({
    respond: () => new Response("{}", { headers: { "Content-Length": "1048577" } }),
  });
  assert.deepEqual(large.result.reasonCodes, ["CHANNEL_RESPONSE_TOO_LARGE"]);
});

test("pagination is bounded and incomplete results stay blocked", async () => {
  const pages = [1, 2, 3].map((page) => ({
    ok: 1,
    data: [template()],
    paging: { hasNext: true, cursors: { after: `cursor-${page}` } },
  }));
  const { result, calls } = await run({ pages });
  assert.equal(calls.length, 5);
  assert.equal(result.template.validationComplete, false);
  assert.equal(result.ready, false);
  assert.ok(result.reasonCodes.includes("TEMPLATE_INSPECTION_INCOMPLETE"));
  const missing = (await run({ pages: [{ ok: 1, data: [template()] }] })).result;
  assert.equal(missing.template.validationComplete, false);
  assert.ok(missing.reasonCodes.includes("TEMPLATE_PAGINATION_INVALID"));
});

test("secret echoes and overlong body text are excluded from candidate output", async () => {
  for (const text of [
    `${bodyText} ${secret}`,
    `${bodyText} ${cloudSecret}`,
    `${bodyText}${"x".repeat(1024)}`,
  ]) {
    const item = template({
      templates: [{ language: "zh_HK", status: "APPROVED", components: [{ type: "BODY", text }] }],
    });
    const { result } = await run({ templates: [item] });
    assert.equal(result.template.candidates.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /test-open-credential|test-channel-credential/);
  }
});

test("candidate output is capped and existing configured order is preserved", async () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    template({ id: `template-${index}`, name: `candidate_${index}` }),
  );
  const { result } = await run({ templates: many }, { EP_WA_STAFF_ALERT_TEMPLATE: undefined });
  assert.equal(result.template.candidates.length, 20);
  const configured = { ...contract, params: ["source", "name", "phone", "link"] };
  assert.deepEqual(
    (await run({}, { EP_WA_STAFF_ALERT_TEMPLATE: JSON.stringify(configured) })).result.template
      .configured.params,
    configured.params,
  );
});

test("member association survives Cloud sender failure without weakening readiness or inventing delivery", async () => {
  const recipient = "85291005322";
  for (const missingCloudToken of [false, true]) {
    const { result, calls } = await run(
      {
        channel: {
          archived: null,
          ...(missingCloudToken ? { appIntegrationAccessToken: undefined } : {}),
        },
        members: [{ _id: "opaque-provider-association-A", channelId, externalId: recipient }],
        respond: ({ url }) =>
          url.pathname.endsWith("/waba-info")
            ? new Response(JSON.stringify({ ok: 0, error: "Owned sender failure" }), {
                status: 500,
              })
            : undefined,
      },
      {
        EP_WA_STAFF_WHATSAPP_VERIFICATION_REF: undefined,
        EP_WA_STAFF_CORRELATION_VERIFICATION_REF: undefined,
        EP_WA_STAFF_ASSOCIATION_REVIEW_REF: undefined,
        EP_WA_STAFF_REPLY_CONTEXT_PATH: undefined,
        EP_WA_STAFF_ALERT_TEMPLATE: undefined,
      },
      { recipientPhones: ["+852 9100 5322", "0085291005322", "91005322"] },
    );
    assert.equal(result.ready, false);
    assert.equal(result.members.checked, true);
    assert.equal(result.members.complete, true);
    assert.equal(result.members.requestedPhoneCount, 1);
    assert.equal(result.members.provesWhatsappRegistration, false);
    assert.deepEqual(
      result.members.matched.map(({ phone, memberId }) => ({ phone, memberId })),
      [{ phone: recipient, memberId: "opaque-provider-association-A" }],
    );
    assert.match(result.members.matched[0].proofHash, /^[a-f0-9]{64}$/);
    assert.equal(result.channel.senderPhone, null);
    assert.equal(result.channel.proofHash, null);
    assert.equal(result.template.configuredApproved, false);
    assert.equal(result.template.validationComplete, false);
    for (const code of [
      "CAPABILITY_REFERENCES_MISSING",
      "STAFF_TEMPLATE_SELECTION_REQUIRED",
      "PROVIDER_CHANNEL_ARCHIVE_STATUS_UNKNOWN",
      missingCloudToken ? "CLOUD_CHANNEL_READ_TOKEN_UNAVAILABLE" : "SENDER_HTTP_FAILED",
    ])
      assert.ok(result.reasonCodes.includes(code));
    assert.deepEqual(
      result.requests.map(({ stage }) => stage),
      missingCloudToken
        ? ["CHANNEL", "MEMBERS"]
        : ["CHANNEL", "MEMBERS", "SENDER", "CHANNEL_INTEGRATIONS"],
    );
    const memberCall = calls.find((call) => call.query?.query.includes("EarnestForwardingMembers"));
    assert.deepEqual(memberCall.query.variables, {
      app: "app-one",
      channel: channelId,
      phones: [recipient],
    });
    assert.ok(
      calls.every(
        (call) =>
          !call.url.pathname.includes("sendResponses") &&
          (!call.query || !/mutation/i.test(call.query.query)),
      ),
    );
  }
});

test("a completed empty member query supplies no identity proof or registration gate", async () => {
  const { result, calls } = await run({}, {}, { recipientPhones: ["85291005322"] });
  assert.deepEqual(result.members, {
    checked: true,
    complete: true,
    requestedPhoneCount: 1,
    matched: [],
    provesWhatsappRegistration: false,
  });
  assert.equal(
    result.ready,
    true,
    "configuration readiness does not require an existing provider member for recipientId",
  );
  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(
    result.requests.map(({ stage }) => stage),
    ["CHANNEL", "MEMBERS", "SENDER", "TEMPLATES"],
  );
  assert.equal(calls.length, 4);
});

test("member authentication, partial GraphQL and malformed responses cannot become association proof", async () => {
  const recipient = "85291005322";
  const matching = {
    data: {
      apiViewer: {
        members: {
          edges: [
            { node: { _id: "opaque-should-not-be-trusted", channelId, externalId: recipient } },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    },
  };
  for (const response of [
    () => new Response(JSON.stringify({ error: "Owned denied" }), { status: 401 }),
    () =>
      new Response(
        JSON.stringify({ ...matching, errors: [{ message: "Owned partial GraphQL error" }] }),
      ),
    () => new Response(JSON.stringify({ data: { apiViewer: { members: null } } })),
    () =>
      new Response(JSON.stringify({ data: { apiViewer: { members: { edges: "malformed" } } } })),
  ]) {
    const { result } = await run(
      {
        respond: ({ query }) =>
          query?.query.includes("EarnestForwardingMembers") ? response() : undefined,
      },
      {},
      { recipientPhones: [recipient] },
    );
    assert.equal(result.members.checked, false);
    assert.equal(result.members.complete, false);
    assert.deepEqual(result.members.matched, []);
    assert.equal(result.members.provesWhatsappRegistration, false);
    assert.equal(result.ready, false);
    assert.ok(result.reasonCodes.includes("RECIPIENT_MEMBERSHIP_UNVERIFIED"));
    if (result.requests.find(({ stage }) => stage === "MEMBERS").httpStatus === 401)
      assert.ok(result.reasonCodes.includes("MEMBERS_AUTH_DENIED"));
    assert.equal(
      result.template.configuredApproved,
      true,
      "independent sender/template inspection still completes",
    );
  }
});

test("invalid or oversized member lookup input does not issue a member query", async () => {
  for (const recipientPhones of [
    ["not-a-phone"],
    Array.from({ length: 41 }, (_, index) => `8529${1000000 + index}`),
  ]) {
    const { result, calls } = await run({}, {}, { recipientPhones });
    assert.equal(result.members.checked, false);
    assert.deepEqual(result.members.matched, []);
    assert.ok(result.reasonCodes.includes("RECIPIENT_LOOKUP_INPUT_INVALID"));
    assert.equal(result.ready, false);
    assert.ok(calls.every((call) => !call.query?.query.includes("EarnestForwardingMembers")));
  }
});

test("incomplete member pagination and invalid identities stay unverified", async () => {
  const recipient = "85291005322";
  for (const members of [
    {
      edges: [{ node: { _id: "opaque-partial-member", channelId, externalId: recipient } }],
      pageInfo: { hasNextPage: true },
    },
    { edges: [], pageInfo: {} },
    {
      edges: [{ node: { _id: null, channelId, externalId: recipient } }],
      pageInfo: { hasNextPage: false },
    },
    {
      edges: [{ node: { _id: "wrong-phone-member", channelId, externalId: "85298887777" } }],
      pageInfo: { hasNextPage: false },
    },
  ]) {
    const { result } = await run(
      {
        respond: ({ query }) =>
          query?.query.includes("EarnestForwardingMembers")
            ? new Response(JSON.stringify({ data: { apiViewer: { members } } }))
            : undefined,
      },
      {},
      { recipientPhones: [recipient] },
    );
    assert.equal(result.members.checked, true);
    assert.equal(result.members.complete, false);
    assert.equal(result.ready, false);
    assert.equal(result.members.provesWhatsappRegistration, false);
    assert.ok(
      result.reasonCodes.some((code) =>
        ["RECIPIENT_INSPECTION_INCOMPLETE", "RECIPIENT_MEMBER_SCOPE_MISMATCH"].includes(code),
      ),
    );
    assert.ok(
      result.members.matched.every(
        (item) => item.phone === recipient && item.memberId === "opaque-partial-member",
      ),
    );
  }
});

test("optional member lookups use external phone IDs and require the configured channel", async () => {
  const phones = ["85297987774", "85266442444"];
  const f = await run(
    {
      members: [
        { _id: "real-member-one", channelId, externalId: phones[0] },
        { _id: "foreign-member", channelId: "other-channel", externalId: phones[1] },
      ],
    },
    {},
    { recipientPhones: phones },
  );
  const memberCall = f.calls.find((call) => call.query?.query.includes("EarnestForwardingMembers"));
  assert.deepEqual(memberCall.query.variables.phones, phones);
  assert.equal(memberCall.query.variables.channel, channelId);
  assert.deepEqual(
    f.result.members.matched.map((item) => item.memberId),
    ["real-member-one"],
  );
  assert.equal(f.result.members.complete, false);
  assert.equal(f.result.members.provesWhatsappRegistration, false);
  assert.equal(f.result.ready, false);
});

test("conflicting provider contracts cannot attest the same configured template selector", async () => {
  const conflict = template({
    templates: [
      {
        language: "zh_HK",
        status: "APPROVED",
        components: [{ type: "BODY", text: `不同內容 ${bodyText}` }],
      },
    ],
  });
  const { result } = await run({ templates: [template(), conflict] });
  assert.equal(result.ready, false);
  assert.equal(result.template.configuredApproved, false);
  assert.deepEqual(result.template.candidates, []);
  assert.ok(result.reasonCodes.includes("TEMPLATE_CONTRACT_CONFLICT"));
});

test("ambiguous member IDs are never selected for an approved phone", async () => {
  const recipient = "85297987774";
  const { result } = await run(
    {
      members: [
        { _id: "member-one", channelId, externalId: recipient },
        { _id: "member-two", channelId, externalId: recipient },
      ],
    },
    {},
    { recipientPhones: [recipient] },
  );
  assert.equal(result.members.complete, false);
  assert.deepEqual(result.members.matched, []);
  assert.ok(result.reasonCodes.includes("RECIPIENT_MEMBER_AMBIGUOUS"));
});

test("absent open token and malformed channel configuration perform no network calls", async () => {
  for (const patch of [
    { WOZTELL_OPEN_API_TOKEN: undefined },
    { WOZTELL_CHANNEL_ID: "https://untrusted.invalid" },
  ]) {
    const { result, calls } = await run({}, patch);
    assert.equal(result.ready, false);
    assert.equal(calls.length, 0);
  }
});
