import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
async function report() {
  assert.ok(
    existsSync(new URL("./reporting.ts", import.meta.url)),
    "aggregate reporting model must exist",
  );
  return import("./reporting.ts");
}
test("unconfigured provider is unavailable rather than fabricated zero traffic/conversions", async () => {
  const { buildMeasurementSummary } = await report();
  const r = buildMeasurementSummary(null, [
    { day: "2026-09-05", inquiries: 3, linkedLeads: 3, unassignedInquiries: 2 },
  ]);
  assert.equal(r.traffic, null);
  assert.equal(r.operational.inquiries, 3);
  assert.equal(r.operational.unassignedInquiries, 2);
});
test("aggregate summary rejects raw records, unknown dimensions, negative and nonfinite counts", async () => {
  const { buildMeasurementSummary } = await report();
  for (const row of [
    {
      day: "2026-09-05",
      inquiries: 1,
      linkedLeads: 1,
      unassignedInquiries: 0,
      email: "person@example.com",
    },
    { day: "2026-09-05", inquiries: -1, linkedLeads: 1, unassignedInquiries: 0 },
    { day: "2026-09-05", inquiries: Infinity, linkedLeads: 1, unassignedInquiries: 0 },
  ])
    assert.throws(() => buildMeasurementSummary(null, [row]));
});
test("bounded aggregate counts expose denominators and avoid claiming cohort conversion", async () => {
  const { buildMeasurementSummary } = await report();
  const r = buildMeasurementSummary(
    [{ day: "2026-09-05", pageViews: 10, whatsappClicks: 4, inquiryConversions: 2 }],
    [{ day: "2026-09-05", inquiries: 3, linkedLeads: 3, unassignedInquiries: 2 }],
  );
  assert.equal(r.traffic.inquiryEventsPerPageView, 0.2);
  assert.equal(r.traffic.pageViews, 10);
  assert.equal(r.operational.inquiries, 3);
  assert.throws(() =>
    buildMeasurementSummary(
      Array.from({ length: 91 }, () => ({
        day: "2026-09-05",
        pageViews: 1,
        whatsappClicks: 0,
        inquiryConversions: 0,
      })),
      [],
    ),
  );
});
