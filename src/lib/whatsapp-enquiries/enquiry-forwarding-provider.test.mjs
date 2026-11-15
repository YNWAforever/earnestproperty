import assert from "node:assert/strict";
import test from "node:test";
import { inspectEnquiryForwardingProvider } from "./enquiry-forwarding-provider.server.ts";

const channelId = "company-channel";
const secret = "test-open-credential-never-return";
const cloudSecret = "test-channel-credential-never-return";
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
      if (query.query.includes("EarnestForwardingMembers")) {
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
      assert.equal(url.searchParams.get("accessToken"), cloudSecret);
      if (url.pathname.endsWith("/waba-info")) {
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
        assert.equal(url.searchParams.get("wabaId"), "waba-one");
        assert.equal(url.searchParams.get("first"), "100");
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

test("runtime inspection verifies scoped sender and approved four-body template without sending", async () => {
  const { result, calls } = await run();
  assert.equal(result.ready, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.flags.enquiryMode, "observe");
  assert.equal(result.flags.serviceAutomationEnabled, false);
  assert.equal(result.channel.senderPhone, "85224962283");
  assert.equal(result.channel.companyPhoneMatches, true);
  assert.equal(result.channel.senderDifferentFromFixedCopy, true);
  assert.match(result.channel.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(result.template.configuredApproved, true);
  assert.equal(result.template.validationComplete, true);
  assert.deepEqual(result.template.configured, contract);
  assert.equal(result.template.candidates[0].bodyText, bodyText);
  assert.equal(result.template.candidates[0].paramCount, 4);
  assert.equal(result.members.provesWhatsappRegistration, false);
  assert.doesNotMatch(JSON.stringify(result), /test-.*(?:credential|secret|proof)/);
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
    const { result, calls } = await run({ channel });
    assert.equal(calls.length, 1);
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
