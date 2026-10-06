import assert from "node:assert/strict";
import test from "node:test";
import { trackedRedirect } from "../neon/whatsapp-enquiries.server.ts";
test("AT-15/19 normal registered redirect writes only reference and rate evidence", async () => {
  const old = { ...process.env };
  Object.assign(process.env, {
    EP_WA_TRACKED_LINKS_ENABLED: "true",
    EP_WA_COMPANY_CHANNEL_ID: "fixture",
    EP_WA_COMPANY_PHONE: "85212345678",
  });
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("request_count")) return [{ request_count: 1 }];
    if (sql.includes("JOIN whatsapp_tracking_link_versions"))
      return [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "abcdefghijklmnop",
          version: 1,
          channel_id: "fixture",
          placement_source: "youtube",
          entry_point_type: "reception",
          enabled: true,
        },
      ];
    return [];
  };
  try {
    const r = await trackedRedirect(
      new Request("https://fixture/w/abcdefghijklmnop?phone=999&url=https://evil"),
      "abcdefghijklmnop",
      query,
    );
    assert.equal(r.status, 302);
    assert.match(r.headers.get("location"), /^https:\/\/wa.me\/85212345678/);
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.equal(calls.filter((x) => x.sql.includes("INSERT INTO whatsapp_link_opens")).length, 1);
    assert.ok(calls.every((x) => !/INSERT INTO (crm_contacts|crm_leads|inquiries)/.test(x.sql)));
    assert.equal(
      calls.some((x) => x.params?.includes("999")),
      false,
    );
    calls.length = 0;
    await trackedRedirect(
      new Request("https://fixture", { method: "HEAD" }),
      "abcdefghijklmnop",
      query,
    );
    assert.equal(calls.length, 0);
  } finally {
    process.env = old;
  }
});
test("AT-26 unavailable offering produces honest general company fallback, no reference", async () => {
  const old = { ...process.env };
  Object.assign(process.env, {
    EP_WA_TRACKED_LINKS_ENABLED: "true",
    EP_WA_COMPANY_CHANNEL_ID: "fixture",
    EP_WA_COMPANY_PHONE: "85212345678",
  });
  let writes = 0;
  try {
    const r = await trackedRedirect(
      new Request("https://fixture"),
      "abcdefghijklmnop",
      async (sql) => {
        if (sql.includes("request_count")) return [{ request_count: 1 }];
        if (sql.includes("JOIN whatsapp_tracking_link_versions")) return [{ property_id: "p" }];
        if (sql.includes("INSERT INTO whatsapp_link_opens")) writes++;
        return [];
      },
    );
    assert.equal(writes, 0);
    assert.equal(r.status, 302);
    assert.ok(!r.headers.get("location").includes("EPWA"));
  } finally {
    process.env = old;
  }
});

test("AT-37 viewer and cross-conversation agent cannot inspect enquiry IDs", async () => {
  const { listEnquiries } = await import("../neon/whatsapp-enquiries.server.ts");
  let reads = 0;
  const query = async () => {
    reads++;
    return [];
  };
  const actor = { staffId: "fixture", roles: ["viewer"] };
  await assert.rejects(listEnquiries("foreign", actor, query), (e) => e.status === 403);
  assert.equal(reads, 0);
  await assert.rejects(
    listEnquiries("foreign", { ...actor, roles: ["agent"] }, query),
    (e) => e.status === 403,
  );
  assert.equal(reads, 1);
});

// FX-10a (C-08): a tracked /w/ link must never answer 500. Any failure falls
// back to the company WhatsApp number from settings (or /contact) and logs one
// PII-free line naming the stage and reason only.
const GENERAL_TEXT = "您好，我想向晉誠地產查詢。樓盤供應請向職員確認。";
const FALLBACK_LOG = "WA_TRACKED_REDIRECT_FALLBACK";
const DB_ERROR = "connect ECONNREFUSED postgres://owner:s3cret@db.internal/neondb";
const fallbackPayloads = [];

async function withTrackedEnv(t, overrides, fn) {
  const old = { ...process.env };
  Object.assign(process.env, {
    EP_WA_TRACKED_LINKS_ENABLED: "true",
    EP_WA_COMPANY_CHANNEL_ID: "fixture",
    EP_WA_COMPANY_PHONE: "85212345678",
  });
  delete process.env.VITE_CONTACT_WHATSAPP_PHONE;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const errors = t.mock.method(console, "error", () => {});
  try {
    return await fn({ errors });
  } finally {
    for (const call of errors.mock.calls) {
      if (call.arguments[0] === FALLBACK_LOG) fallbackPayloads.push(call.arguments[1]);
    }
    errors.mock.restore();
    process.env = old;
  }
}

const registeredRow = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "abcdefghijklmnop",
  version: 1,
  channel_id: "fixture",
  placement_source: "youtube",
  entry_point_type: "listing",
  enabled: true,
  property_id: "22222222-2222-4222-8222-222222222222",
  public_listing_no: "A074714",
  deal_type: "sale",
  requested_staff_id: "33333333-3333-4333-8333-333333333333",
  reference_mapping_id: "44444444-4444-4444-8444-444444444444",
  phone: "85299999999",
};

const MARKERS = [
  "request_count",
  "JOIN whatsapp_tracking_link_versions",
  "FROM properties",
  "staff_external_references",
  "INSERT INTO whatsapp_link_opens",
];

function registeredQuery({ throwOn = null, throwOnCall = 1 } = {}) {
  const calls = [];
  const counts = {};
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const marker = MARKERS.find((m) => sql.includes(m));
    counts[marker] = (counts[marker] ?? 0) + 1;
    if (marker && marker === throwOn && counts[marker] === throwOnCall) throw new Error(DB_ERROR);
    if (marker === "request_count") return [{ request_count: 1 }];
    if (marker === "JOIN whatsapp_tracking_link_versions") return [{ ...registeredRow }];
    if (marker === "FROM properties")
      return [
        {
          id: registeredRow.property_id,
          title_zh: "Fixture Court",
          agent_id: "55555555-5555-4555-8555-555555555555",
        },
      ];
    if (marker === "staff_external_references")
      return [
        {
          namespace: "fixture",
          external_reference: "fixture-ref",
          staff_id: registeredRow.requested_staff_id,
          mapping_version: 1,
        },
      ];
    return [];
  };
  return { query, calls };
}

function decodedText(location) {
  return new URL(location).searchParams.get("text") ?? "";
}

test("DB error → 302 to wa.me fallback", async (t) => {
  await withTrackedEnv(t, {}, async ({ errors }) => {
    let calls = 0;
    const r = await trackedRedirect(
      new Request("https://fixture/w/abcdefghijklmnop"),
      "abcdefghijklmnop",
      async () => {
        calls++;
        throw new Error(DB_ERROR);
      },
    );
    assert.equal(calls, 1);
    assert.equal(r.status, 302);
    const location = r.headers.get("location");
    assert.ok(location.startsWith("https://wa.me/85212345678?text="), "company wa.me fallback");
    assert.equal(decodedText(location), GENERAL_TEXT);
    assert.ok(!location.includes("EPWA"));
    assert.equal(r.headers.get("x-wa-tracking"), "untracked");
    assert.match(r.headers.get("cache-control"), /no-store/);
    assert.equal(errors.mock.callCount(), 1);
    assert.deepEqual(errors.mock.calls[0].arguments, [
      FALLBACK_LOG,
      '{"reason":"unexpected","stage":"rate","errorName":"Error"}',
    ]);
  });
});

test("missing company channel → fallback", async (t) => {
  for (const channel of [undefined, "c".repeat(161)]) {
    await withTrackedEnv(t, { EP_WA_COMPANY_CHANNEL_ID: channel }, async ({ errors }) => {
      let calls = 0;
      const r = await trackedRedirect(
        new Request("https://fixture/w/abcdefghijklmnop"),
        "abcdefghijklmnop",
        async () => {
          calls++;
          return [];
        },
      );
      assert.equal(calls, 0);
      assert.equal(r.status, 302);
      assert.ok(r.headers.get("location").startsWith("https://wa.me/85212345678?"));
      assert.equal(r.headers.get("x-wa-tracking"), "untracked");
      assert.equal(errors.mock.callCount(), 1);
      assert.deepEqual(errors.mock.calls[0].arguments, [
        FALLBACK_LOG,
        '{"reason":"company_channel_missing","stage":"config","errorName":"Error"}',
      ]);
    });
  }
});

test("a failure at every stage falls back to the company number only", async (t) => {
  const cases = [
    { throwOn: "request_count", throwOnCall: 1, stage: "rate" },
    { throwOn: "JOIN whatsapp_tracking_link_versions", throwOnCall: 1, stage: "link" },
    { throwOn: "FROM properties", throwOnCall: 1, stage: "offer" },
    { throwOn: "request_count", throwOnCall: 2, stage: "rate" },
    { throwOn: "staff_external_references", throwOnCall: 1, stage: "alias" },
    { throwOn: "INSERT INTO whatsapp_link_opens", throwOnCall: 1, stage: "open" },
  ];
  for (const c of cases) {
    await withTrackedEnv(t, {}, async ({ errors }) => {
      const { query } = registeredQuery(c);
      const r = await trackedRedirect(
        new Request("https://fixture/w/abcdefghijklmnop?phone=85299999999&to=85299999999"),
        "abcdefghijklmnop",
        query,
      );
      const label = `${c.throwOn}#${c.throwOnCall}`;
      assert.ok(r.status < 500, label);
      assert.equal(r.status, 302, label);
      const location = r.headers.get("location");
      assert.ok(location.startsWith("https://wa.me/85212345678?"), label);
      assert.ok(!location.includes("99999999"), label);
      assert.equal(errors.mock.callCount(), 1, label);
      const [name, payload] = errors.mock.calls[0].arguments;
      assert.equal(name, FALLBACK_LOG, label);
      assert.ok(!payload.includes("99999999"), label);
      assert.equal(JSON.parse(payload).stage, c.stage, label);
    });
  }
});

test("a malformed or missing company phone falls back without throwing", async (t) => {
  const malformed = "+852 1234 5678";
  for (const [vite, expected] of [
    ["85291234567", "https://wa.me/85291234567?"],
    [undefined, "/contact"],
    ["85200000000", "/contact"],
  ]) {
    await withTrackedEnv(
      t,
      { EP_WA_COMPANY_PHONE: malformed, VITE_CONTACT_WHATSAPP_PHONE: vite },
      async ({ errors }) => {
        const { query, calls } = registeredQuery();
        const r = await trackedRedirect(
          new Request("https://fixture/w/abcdefghijklmnop"),
          "abcdefghijklmnop",
          query,
        );
        assert.equal(r.status, 302);
        const location = r.headers.get("location");
        if (expected === "/contact") assert.equal(location, "/contact");
        else assert.ok(location.startsWith(expected), location);
        assert.equal(errors.mock.callCount(), 1);
        assert.deepEqual(JSON.parse(errors.mock.calls[0].arguments[1]), {
          reason: "company_phone_invalid",
          stage: "phone",
          errorName: "Error",
        });
        assert.equal(
          calls.filter((x) => x.sql.includes("INSERT INTO whatsapp_link_opens")).length,
          0,
        );
      },
    );
  }
  // Unregistered link: the plain fallback itself must not throw on a bad phone.
  await withTrackedEnv(
    t,
    { EP_WA_COMPANY_PHONE: malformed, VITE_CONTACT_WHATSAPP_PHONE: "85291234567" },
    async () => {
      const r = await trackedRedirect(
        new Request("https://fixture/w/abcdefghijklmnop"),
        "abcdefghijklmnop",
        async (sql) => (sql.includes("request_count") ? [{ request_count: 1 }] : []),
      );
      assert.equal(r.status, 302);
      assert.ok(r.headers.get("location").startsWith("https://wa.me/85291234567?"));
    },
  );
});

test("the fallback log never contains the link code, request URL, phone numbers or error text", () => {
  assert.ok(fallbackPayloads.length >= 12, `collected ${fallbackPayloads.length} payloads`);
  for (const payload of fallbackPayloads) {
    assert.match(
      payload,
      /^\{"reason":"(company_channel_missing|company_phone_invalid|unexpected)","stage":"(config|rate|link|offer|phone|alias|open)","errorName":"[A-Za-z]{1,40}"\}$/,
    );
    for (const secret of [
      "abcdefghijklmnop",
      "s3cret",
      "postgres",
      "85299999999",
      "85212345678",
      "fixture/w",
    ])
      assert.ok(!payload.includes(secret), `${payload} contains ${secret}`);
  }
});

test("companyFallbackLocation prefers EP_WA_COMPANY_PHONE, then VITE_CONTACT_WHATSAPP_PHONE, and reads nothing else", async () => {
  const { companyFallbackLocation } = await import("../neon/whatsapp-enquiries.server.ts");
  const ep = companyFallbackLocation({
    EP_WA_COMPANY_PHONE: "85212345678",
    VITE_CONTACT_WHATSAPP_PHONE: "85291234567",
  });
  assert.ok(ep.startsWith("https://wa.me/85212345678?text="));
  assert.equal(decodedText(ep), GENERAL_TEXT);
  assert.ok(
    companyFallbackLocation({
      EP_WA_COMPANY_PHONE: "",
      VITE_CONTACT_WHATSAPP_PHONE: "85291234567",
    }).startsWith("https://wa.me/85291234567?text="),
  );
  assert.equal(companyFallbackLocation({ EP_WA_COMPANY_PHONE: "85226882988" }), "/contact");
  assert.equal(companyFallbackLocation({}), "/contact");
  assert.equal(
    companyFallbackLocation({ phone: "85299999999", EP_WA_PHONE: "85299999999" }),
    "/contact",
  );
  for (const bad of [undefined, "abc", "+85212345678"]) {
    assert.doesNotThrow(() => companyFallbackLocation({ EP_WA_COMPANY_PHONE: bad }));
    assert.equal(companyFallbackLocation({ EP_WA_COMPANY_PHONE: bad }), "/contact");
  }
});

test("prefetch, disabled tracking and the happy path are unchanged", async (t) => {
  await withTrackedEnv(t, {}, async ({ errors }) => {
    let calls = 0;
    const r = await trackedRedirect(
      new Request("https://fixture/w/abcdefghijklmnop", { method: "HEAD" }),
      "abcdefghijklmnop",
      async () => {
        calls++;
        return [];
      },
    );
    assert.equal(r.status, 204);
    assert.equal(calls, 0);
    assert.equal(errors.mock.callCount(), 0);
  });
  await withTrackedEnv(t, { EP_WA_TRACKED_LINKS_ENABLED: "false" }, async ({ errors }) => {
    let calls = 0;
    const r = await trackedRedirect(
      new Request("https://fixture/w/abcdefghijklmnop"),
      "abcdefghijklmnop",
      async () => {
        calls++;
        return [];
      },
    );
    assert.equal(r.status, 302);
    assert.ok(r.headers.get("location").startsWith("https://wa.me/85212345678?"));
    assert.equal(calls, 0);
    assert.equal(errors.mock.callCount(), 0);
  });
  await withTrackedEnv(t, {}, async ({ errors }) => {
    const { query, calls } = registeredQuery();
    const r = await trackedRedirect(
      new Request("https://fixture/w/abcdefghijklmnop"),
      "abcdefghijklmnop",
      query,
    );
    assert.equal(r.status, 302);
    assert.ok(r.headers.get("location").startsWith("https://wa.me/85212345678?"));
    assert.match(decodedText(r.headers.get("location")), /EPWA:/);
    assert.equal(calls.filter((x) => x.sql.includes("INSERT INTO whatsapp_link_opens")).length, 1);
    assert.equal(errors.mock.callCount(), 0);
  });
});
