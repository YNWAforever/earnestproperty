import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import * as reporting from "./reporting.ts";
const request = new Request("https://example.test/admin/analytics");
const range = { start: "2026-09-01", end: "2026-09-05" };
const row = {
  day: "2026-09-01",
  inquiries: 3,
  linkedLeads: 2,
  unassignedInquiries: 1,
  leads: 2,
  unassignedLeads: 1,
  conversations: 4,
  unassignedConversations: 2,
  openConversations: 3,
};
function completeRows() {
  return Array.from({ length: 5 }, (_, index) =>
    index === 0
      ? { ...row }
      : {
          day: `2026-09-0${index + 1}`,
          ...Object.fromEntries(reporting.OPERATIONAL_METRICS.map((key) => [key, 0])),
        },
  );
}
async function server() {
  assert.ok(
    existsSync(new URL("./reporting.server.ts", import.meta.url)),
    "authenticated aggregate server must exist",
  );
  return import("./reporting.server.ts");
}
test("date contract rejects malformed, reversed, oversized and unexpected input", () => {
  assert.equal(typeof reporting.parseAnalyticsDateRange, "function");
  assert.deepEqual(reporting.parseAnalyticsDateRange(range), range);
  for (const input of [
    { start: "2026-02-30", end: "2026-03-01" },
    { start: "2026-09-05", end: "2026-09-01" },
    { start: "2026-01-01", end: "2026-09-05" },
    { ...range, contactId: "private" },
    null,
  ])
    assert.throws(() => reporting.parseAnalyticsDateRange(input));
});
test("aggregate server requires admin/manager and denies agent/viewer/revoked/unauthenticated before queries", async () => {
  const { fetchOperationalAnalytics } = await server();
  let reads = 0;
  for (const role of ["admin", "manager", "agent", "viewer", "revoked", "unauthenticated"]) {
    const ports = {
      requireAccess: async (_request, roles) => {
        assert.deepEqual(roles, ["admin", "manager"]);
        if (role === "revoked" || role === "unauthenticated")
          throw new Response("Forbidden", { status: 403 });
        return { roles: [role] };
      },
      query: async () => {
        reads++;
        return completeRows();
      },
    };
    if (role === "admin" || role === "manager")
      await fetchOperationalAnalytics(range, request, ports);
    else await assert.rejects(fetchOperationalAnalytics(range, request, ports));
  }
  assert.equal(reads, 2);
});
test("aggregate output never exposes customer rows or IDs and separates unavailable GA4 from operational zero", async () => {
  const { fetchOperationalAnalytics } = await server();
  let query;
  const data = await fetchOperationalAnalytics(range, request, {
    requireAccess: async () => ({ roles: ["admin"] }),
    query: async (sql, params) => {
      query = { sql, params };
      return completeRows().map((item) => ({
        ...item,
        name: "private person",
        contact_id: "secret",
        phone: "91234567",
      }));
    },
  });
  assert.equal(data.provider.status, "reporting_unconfigured");
  assert.equal(data.provider.pageViews, null);
  assert.equal(data.summary.inquiries, 3);
  assert.equal(data.days.length, 5);
  assert.doesNotMatch(JSON.stringify(data), /private person|secret|91234567|contact_id/);
  assert.deepEqual(query.params, ["2026-09-01", "2026-09-05"]);
  assert.match(query.sql, /generate_series/);
  assert.match(query.sql, /Asia\/Hong_Kong/);
  assert.match(query.sql, /crm_leads/);
  assert.match(query.sql, /whatsapp_conversations/);
  assert.doesNotMatch(query.sql, /SELECT\s+\*/i);
});
test("database failure is unavailable and does not fabricate zero metrics or leak SQL", async () => {
  const { fetchOperationalAnalytics } = await server();
  await assert.rejects(
    fetchOperationalAnalytics(range, request, {
      requireAccess: async () => ({ roles: ["admin"] }),
      query: async () => {
        throw Error("postgres credentials customer secret");
      },
    }),
    (error) => error instanceof Response && error.status === 503,
  );
});
test("admin view has bounded date controls and explicit unavailable GA4 output", () => {
  const url = new URL("../../routes/admin.analytics.tsx", import.meta.url);
  assert.ok(existsSync(url), "analytics admin view must exist");
  const src = readFileSync(url, "utf8");
  assert.match(src, /fetchOperationalAnalytics/);
  assert.match(src, /type="date"/);
  assert.match(src, /GA4/);
  assert.match(src, /noindex/);
  assert.match(src, /未連接|未接駁/);
});

test("serverfn carries bearer headers, validates range and unwraps denied Response", async () => {
  const ts = (await import("typescript")).default;
  const src = readFileSync(new URL("./reporting-client.ts", import.meta.url), "utf8");
  let validator,
    received,
    headers = 0;
  const builder = {
    inputValidator: (fn) => {
      validator = fn;
      return builder;
    },
    handler: () => async (input) => {
      received = input;
      return new Response("Forbidden", { status: 403 });
    },
  };
  const exports = {};
  const code = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { unwrapServerFnResponse } = await import("../neon/server-fn-response.ts");
  new Function("exports", "require", code)(
    exports,
    (name) =>
      ({
        "@tanstack/react-start": { createServerFn: () => builder },
        "@tanstack/react-start/server": { getRequest: () => request },
        "@/auth": {
          withStaffAuthHeaders: async (options) => {
            headers++;
            return { ...options, headers: new Headers({ authorization: "Bearer synthetic-only" }) };
          },
        },
        "../neon/server-fn-response.ts": { unwrapServerFnResponse },
        "./reporting.ts": reporting,
      })[name],
  );
  assert.throws(() => validator({ ...range, email: "secret" }));
  await assert.rejects(exports.fetchOperationalAnalytics(range), (e) => e.status === 403);
  assert.equal(headers, 1);
  assert.equal(received.headers.get("authorization"), "Bearer synthetic-only");
});
test("rendered aggregate view shows real zero counts and unavailable GA4 without customer details", async () => {
  const ts = (await import("typescript")).default,
    React = await import("react"),
    jsx = await import("react/jsx-runtime"),
    { renderToStaticMarkup } = await import("react-dom/server");
  const report = {
    range,
    days: [{ ...row, inquiries: 0, linkedLeads: 0, unassignedInquiries: 0 }],
    summary: { ...row, inquiries: 0, linkedLeads: 0, unassignedInquiries: 0 },
    provider: {
      status: "reporting_unconfigured",
      pageViews: null,
      whatsappClicks: null,
      inquiryConversions: null,
    },
  };
  const states = [range, range, 0, report, false, null];
  let index = 0,
    definition;
  const passthrough = ({ children }) => React.createElement("div", null, children);
  const code = ts.transpileModule(
    readFileSync(new URL("../../routes/admin.analytics.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const dependencies = {
    react: { ...React, useState: () => [states[index++], () => {}], useEffect: () => {} },
    "react/jsx-runtime": jsx,
    "@tanstack/react-router": {
      createFileRoute: () => (options) => {
        definition = options;
        return {};
      },
      Link: ({ children, to }) => React.createElement("a", { href: to }, children),
    },
    "@/components/admin/AdminShell": { AdminShell: passthrough, AdminError: passthrough },
    "@/components/ui/button": { Button: passthrough },
    "@/components/ui/input": { Input: (props) => React.createElement("input", props) },
    "@/components/ui/label": { Label: (props) => React.createElement("label", props) },
    "@/components/ui/skeleton": { Skeleton: passthrough },
    "@/lib/analytics/reporting-client": { fetchOperationalAnalytics: () => {} },
    "@/lib/analytics/reporting": reporting,
  };
  new Function("exports", "require", code)({}, (name) => dependencies[name]);
  const html = renderToStaticMarkup(React.createElement(definition.component));
  assert.match(html, /GA4 流量及轉換報表未接駁/);
  assert.match(html, /並非 0/);
  assert.match(html, />0</);
  assert.match(html, /2026-09-01/);
  assert.doesNotMatch(html, /contact_id|phone|email|private person/);
});

test("an unexpectedly empty or incomplete aggregate result is unavailable rather than a zero report", async () => {
  const { fetchOperationalAnalytics } = await server();
  for (const rows of [[], [row]])
    await assert.rejects(
      fetchOperationalAnalytics(range, request, {
        requireAccess: async () => ({ roles: ["admin"] }),
        query: async () => rows,
      }),
      (e) => e instanceof Response && e.status === 503,
    );
});
