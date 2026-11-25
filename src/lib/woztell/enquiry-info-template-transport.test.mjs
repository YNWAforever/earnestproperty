import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import {
  createEnquiryInfoTemplateTransport,
  enquiryInfoTemplateDigest,
} from "./enquiry-info-template-transport.server.ts";
import { buildStaffTemplateResponse } from "./staff-alert-template.ts";

// Every permitted request below uses its own owned fake. Accidental default network is fatal.
const network = mock.method(globalThis, "fetch", () => {
  throw Error("Owned informational transport forbids external requests");
});
after(() => network.mock.restore());
const uuid = (n) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TOKEN = "owned-information-fixture-bearer";
const UNSELECTED = "owned-unselected-private-credential-002";
const contract = {
  name: "owned_enquiry_info",
  language: "zh_HK",
  params: ["name", "source", "phone", "link"],
};
const template = buildStaffTemplateResponse(contract, {
  name: "合成客戶",
  source: "網站查詢 · OWNED001",
  phone: "+852 5555 0101",
  link: "https://owned.invalid/admin/leads/owned",
});
const base = {
  purpose: "enq_forward_info",
  version: 1,
  appId: "owned-info-app",
  channelId: "owned-info-channel",
  companySenderPhone: "85224962283",
  recipientPhone: "85297987774",
  attemptId: uuid(1),
  operationId: uuid(2),
  armId: uuid(3),
  providerProofAuditId: uuid(4),
  recipientVersion: 7,
  frozenEvidenceHash: "a".repeat(64),
  templateDigest: enquiryInfoTemplateDigest(contract, template),
};
function input() {
  return {
    binding: structuredClone(base),
    templateContract: structuredClone(contract),
    template: structuredClone(template),
    beforeSend: async () => {},
  };
}
function owned(options = {}) {
  const calls = [];
  const events = [];
  const runtime = {
    enabled: true,
    appId: base.appId,
    channelId: base.channelId,
    companySenderPhone: base.companySenderPhone,
    botAccessToken: TOKEN,
    ...options.runtime,
  };
  const resolvePermit = async (request) => {
    events.push("permit");
    assert.equal(Object.isFrozen(request), true);
    return options.resolvePermit ? options.resolvePermit(request) : { ...request };
  };
  const fetch = async (url, init) => {
    events.push("fetch");
    assert.equal(String(url), "https://bot.api.woztell.com/sendResponses");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${TOKEN}`);
    assert.ok(init.signal instanceof AbortSignal);
    calls.push(JSON.parse(init.body));
    if (options.fetch) return options.fetch(url, init);
    const body = options.body ?? { ok: 1, messageId: "owned-provider-operation" };
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: options.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const transport = createEnquiryInfoTemplateTransport({
    resolvePermit,
    fetch,
    runtime: () => ({ ...runtime }),
    privateValues: [UNSELECTED],
    timeoutMs: options.timeoutMs ?? 1000,
  });
  return { transport, calls, events, runtime };
}
const isBlocked = (error) => {
  assert.equal(error.code, "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED");
  assert.equal(error.message, "STAFF_NOTIFICATION_PREFLIGHT_BLOCKED");
  assert.equal(String(error).includes(TOKEN), false);
  assert.equal(String(error).includes(UNSELECTED), false);
  return true;
};

test("one frozen four-parameter TEMPLATE uses recipientId only after both guarded boundaries", async () => {
  const fixture = owned();
  const request = input();
  request.beforeSend = async () => {
    fixture.events.push("beforeSend");
    assert.equal(fixture.calls.length, 0);
  };
  const result = await fixture.transport.sendTemplateByPhone(request);
  assert.deepEqual(fixture.events, ["beforeSend", "permit", "fetch"]);
  assert.deepEqual(fixture.calls, [
    { channelId: base.channelId, recipientId: base.recipientPhone, response: [template] },
  ]);
  assert.equal(Object.hasOwn(fixture.calls[0], "memberId"), false);
  assert.deepEqual(result, {
    state: "accepted",
    evidenceKind: "provider_accepted",
    providerOperationId: "owned-provider-operation",
  });
  assert.equal(Object.hasOwn(result, "delivered"), false);
  assert.deepEqual(Object.keys(fixture.transport), ["sendTemplateByPhone"]);
});

test("the context template sends the reviewed excerpt and rejects a changed body", async () => {
  const request = input();
  request.templateContract = {
    name: "staff_enquiry_followup_context",
    language: "zh_HK",
    params: ["name", "source", "phone", "context", "link"],
  };
  request.template = buildStaffTemplateResponse(request.templateContract, {
    name: "測試",
    source: "網站查詢",
    phone: "測試電話",
    context: "星期六\n可以睇樓嗎？",
    link: "https://owned.invalid/admin/leads",
  });
  request.binding.templateDigest = enquiryInfoTemplateDigest(
    request.templateContract,
    request.template,
  );
  const valid = owned();
  assert.equal((await valid.transport.sendTemplateByPhone(request)).state, "accepted");
  assert.equal(valid.calls[0].response[0].components[0].parameters[3].text, "星期六 可以睇樓嗎？");
  request.template.components[0].parameters[3].text = "另一宗查詢";
  const changed = owned();
  await assert.rejects(() => changed.transport.sendTemplateByPhone(request), isBlocked);
  assert.equal(changed.calls.length, 0);
});

test("a claimed ready flag or reference strings cannot replace the mandatory permit port", async () => {
  for (const options of [undefined, {}, { ready: true }, { resolvePermit: true }])
    assert.throws(() => createEnquiryInfoTemplateTransport(options), isBlocked);
  for (const permit of [
    null,
    undefined,
    true,
    { ready: true },
    { providerProofAuditId: uuid(4) },
  ]) {
    const fixture = owned({ resolvePermit: async () => permit });
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(input()), isBlocked);
    assert.equal(fixture.calls.length, 0);
  }
});

const mismatches = {
  purpose: "staff_notification",
  version: 2,
  appId: "other-app",
  channelId: "other-channel",
  companySenderPhone: "85229999999",
  recipientPhone: "85255550102",
  attemptId: uuid(11),
  operationId: uuid(12),
  armId: uuid(13),
  providerProofAuditId: uuid(14),
  recipientVersion: 8,
  frozenEvidenceHash: "b".repeat(64),
  templateDigest: "c".repeat(64),
};
for (const [key, value] of Object.entries(mismatches))
  test(`a permit for another ${key} cannot authorize the frozen request`, async () => {
    const fixture = owned({ resolvePermit: async (request) => ({ ...request, [key]: value }) });
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(input()), isBlocked);
    assert.equal(fixture.calls.length, 0);
  });

test("denied, stale and throwing DB permit checks never reach fetch or expose private errors", async () => {
  for (const resolvePermit of [
    async () => null,
    async () => {
      throw Error(`https://private.invalid/?accessToken=${UNSELECTED}`);
    },
    async (request) => ({ ...request, stale: true }),
  ]) {
    const fixture = owned({ resolvePermit });
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(input()), isBlocked);
    assert.equal(fixture.calls.length, 0);
  }
});

test("the beforeSend fence is mandatory, and its failure cannot obtain a permit or send", async () => {
  for (const change of [
    (request) => delete request.beforeSend,
    (request) => (request.beforeSend = null),
    (request) =>
      (request.beforeSend = async () => {
        throw Error(`lease expired ${TOKEN}`);
      }),
  ]) {
    const fixture = owned();
    const request = input();
    change(request);
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(request), isBlocked);
    assert.deepEqual(fixture.events, []);
  }
});

test("cross-runtime scope, a disabled switch or a missing Bot credential blocks before I/O", async () => {
  for (const runtime of [
    { enabled: false },
    { appId: "other-app" },
    { channelId: "other-channel" },
    { companySenderPhone: "85229999999" },
    { botAccessToken: null },
  ]) {
    const fixture = owned({ runtime });
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(input()), isBlocked);
    assert.deepEqual(fixture.events, []);
  }
});

test("a runtime or credential change during the final DB check cannot retarget the send", async () => {
  for (const change of [
    (runtime) => (runtime.channelId = "changed-channel"),
    (runtime) => (runtime.botAccessToken = "changed-private-credential"),
    (runtime) => (runtime.enabled = false),
  ]) {
    let fixture;
    fixture = owned({
      resolvePermit: async (request) => {
        change(fixture.runtime);
        return { ...request };
      },
    });
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(input()), isBlocked);
    assert.equal(fixture.calls.length, 0);
  }
});

test("mutating caller-owned scope, semantic order or body while awaiting cannot change the frozen request", async () => {
  const fixture = owned();
  const request = input();
  request.beforeSend = async () => {
    request.binding.recipientPhone = "85255550103";
    request.binding.armId = uuid(99);
    request.templateContract.params.reverse();
    request.template.elementName = "changed_template";
    request.template.components[0].parameters[0].text = "changed customer";
  };
  assert.equal((await fixture.transport.sendTemplateByPhone(request)).state, "accepted");
  assert.equal(fixture.calls[0].recipientId, base.recipientPhone);
  assert.deepEqual(fixture.calls[0].response, [template]);
});

test("self-send, noncanonical phones, forged identity references and changed body fail closed", async () => {
  const changes = [
    (r) => (r.binding.companySenderPhone = base.recipientPhone),
    (r) => (r.binding.recipientPhone = base.companySenderPhone),
    (r) => (r.binding.recipientPhone = "+852 9798 7774"),
    (r) => (r.binding.recipientPhone = "opaque-member"),
    (r) => (r.binding.recipientPhone = "8613812345678"),
    (r) => (r.binding.armId = "present-reference-is-not-an-id"),
    (r) => (r.binding.recipientVersion = 0),
    (r) => (r.binding.frozenEvidenceHash = "present"),
    (r) => (r.template.components[0].parameters[0].text = "changed body"),
  ];
  for (const change of changes) {
    const fixture = owned();
    const request = input();
    change(request);
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(request), isBlocked);
    assert.equal(fixture.calls.length, 0);
  }
});

test("member, TEXT, interactive actions, extra fields and malformed semantic bodies are not supported", async () => {
  const changes = [
    (r) => (r.memberId = "actual-member-still-not-this-transport"),
    (r) => (r.message = "free form"),
    (r) => (r.action = "assign"),
    (r) => (r.binding.ready = true),
    (r) => (r.template.type = "TEXT"),
    (r) => (r.template.buttons = [{ action: "acknowledge" }]),
    (r) => r.template.components.push({ type: "button", parameters: [] }),
    (r) => (r.template.components[0].parameters[0].action = "customer_reply"),
    (r) => (r.template.components.action = "assign"),
    (r) => r.template.components[0].parameters.pop(),
    (r) => (r.templateContract.params = ["name", "source", "phone", "phone"]),
    (r) => (r.templateContract.params.action = "assign"),
    (r) => (r.template.components[0].parameters[0].text = "bad\nparameter"),
  ];
  for (const change of changes) {
    const fixture = owned();
    const request = input();
    change(request);
    await assert.rejects(() => fixture.transport.sendTemplateByPhone(request), isBlocked);
    assert.equal(fixture.calls.length, 0);
  }
});

test("the caller must explicitly supply its private-value set", () => {
  assert.throws(
    () => createEnquiryInfoTemplateTransport({ resolvePermit: async (request) => request }),
    isBlocked,
  );
});

test("a semantic contract cannot use toJSON to disguise an executable value", async () => {
  const fixture = owned();
  const request = input();
  let conversions = 0;
  request.templateContract.name = {
    toJSON() {
      conversions++;
      return contract.name;
    },
  };
  await assert.rejects(() => fixture.transport.sendTemplateByPhone(request), isBlocked);
  assert.equal(conversions, 0);
  assert.equal(fixture.calls.length, 0);
});

test("accessors are rejected without invoking them", async () => {
  const fixture = owned();
  const request = input();
  let reads = 0;
  Object.defineProperty(request.binding, "recipientPhone", {
    enumerable: true,
    get() {
      reads++;
      return base.recipientPhone;
    },
  });
  await assert.rejects(() => fixture.transport.sendTemplateByPhone(request), isBlocked);
  assert.equal(reads, 0);
  assert.equal(fixture.calls.length, 0);
});

test("a claim is never locally reused after a possible send, including concurrent callers", async () => {
  const fixture = owned({ body: { ok: 1 } });
  const outcomes = await Promise.allSettled([
    fixture.transport.sendTemplateByPhone(input()),
    fixture.transport.sendTemplateByPhone(input()),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(fixture.calls.length, 1);
  await assert.rejects(() => fixture.transport.sendTemplateByPhone(input()), isBlocked);
  assert.equal(fixture.calls.length, 1);
});

for (const [name, body, status, state] of [
  ["documented definitive refusal", { ok: 0, err_code: 131, err: TOKEN }, 500, "failed"],
  ["execution without a correlation id", { ok: 1 }, 200, "unknown"],
  [
    "conflicting ids",
    { ok: 1, messageId: "id-one", data: { messageId: "id-two" } },
    200,
    "unknown",
  ],
  ["possible acceptance with refusal", { ok: 0, messageId: "possible-id" }, 500, "unknown"],
  ["non-2xx acceptance", { ok: 1, messageId: "possible-id" }, 500, "unknown"],
  ["unreadable rate-limit body", "<html>private gateway</html>", 429, "unknown"],
  ["Bot credential echo as id", { ok: 1, messageId: TOKEN }, 200, "unknown"],
  ["unselected private value as id", { ok: 1, messageId: UNSELECTED }, 200, "unknown"],
  [
    "encoded unselected private value as id",
    { ok: 1, messageId: `wamid.${Buffer.from(UNSELECTED).toString("base64")}` },
    200,
    "unknown",
  ],
  ["URL as id", { ok: 1, messageId: `https://private.invalid/?token=${TOKEN}` }, 200, "unknown"],
  ["oversized id", { ok: 1, messageId: "x".repeat(200) }, 200, "unknown"],
])
  test(`${name} has only a safe outcome and no automatic retry`, async () => {
    const fixture = owned({ body, status });
    const result = await fixture.transport.sendTemplateByPhone(input());
    assert.deepEqual(result, { state });
    assert.equal(fixture.calls.length, 1);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(JSON.stringify(result).includes(UNSELECTED), false);
  });

test("nested one-message acceptance preserves only its bounded provider correlation", async () => {
  const fixture = owned({
    body: {
      ok: 1,
      sendResult: { ok: 1, result: [{ messageEvent: { messageId: "wamid.T1dORUQ=" } }] },
    },
  });
  assert.deepEqual(await fixture.transport.sendTemplateByPhone(input()), {
    state: "accepted",
    evidenceKind: "provider_accepted",
    providerOperationId: "wamid.T1dORUQ=",
  });
});

test("a private value in the body is blocked rather than silently changing an approved digest", async () => {
  const fixture = owned();
  const request = input();
  request.template.components[0].parameters[0].text = UNSELECTED;
  request.binding.templateDigest = enquiryInfoTemplateDigest(
    request.templateContract,
    request.template,
  );
  await assert.rejects(() => fixture.transport.sendTemplateByPhone(request), isBlocked);
  assert.equal(fixture.calls.length, 0);
});

test("provider exceptions and streamed private failures remain unknown without error leakage", async () => {
  for (const fetch of [
    async () => {
      throw Error(`https://provider.invalid/?accessToken=${TOKEN}`);
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(Error(UNSELECTED));
          },
        }),
      ),
  ]) {
    const fixture = owned({ fetch });
    assert.deepEqual(await fixture.transport.sendTemplateByPhone(input()), { state: "unknown" });
    assert.equal(fixture.calls.length, 1);
  }
});

test("the entire request is bounded even when a provider ignores abort", async () => {
  let signal;
  const fixture = owned({
    timeoutMs: 10,
    fetch: async (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  assert.deepEqual(await fixture.transport.sendTemplateByPhone(input()), { state: "unknown" });
  assert.equal(signal.aborted, true);
  assert.equal(fixture.calls.length, 1);
});

test("an oversized streamed body is unknown and cannot leak provider content", async () => {
  const fixture = owned({ body: "x".repeat(262145) });
  assert.deepEqual(await fixture.transport.sendTemplateByPhone(input()), { state: "unknown" });
  assert.equal(fixture.calls.length, 1);
});
