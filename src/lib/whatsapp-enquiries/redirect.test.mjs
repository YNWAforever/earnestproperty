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
