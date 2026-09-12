import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateServiceSchedule,
  draftServicePolicy,
  unresolvedServicePolicy,
} from "./service-policy.ts";
import { renderServiceCopy, SERVICE_COPY } from "./service-copy.ts";
const hypothetical = () => ({
  ...draftServicePolicy(),
  id: "fixture",
  status: "approved",
  approvedBy: "fixture-approver",
  effectiveAt: "2026-01-01T00:00:00Z",
  copyVersion: "fixture-v1",
  copy: { afterHours: "測試已批准非辦公時間訊息" },
  rules: {
    timezone: "Asia/Hong_Kong",
    weekdays: [1, 2, 3, 4, 5],
    holidays: [],
    openMinute: 480,
    closeMinute: 1320,
    durationMode: "opening",
    beforeOpen: "overnight",
    atOpen: "daytime",
    atClose: "overnight",
    crossClosing: "opening",
    reception: "excluded",
    suppressSurveyAfterHuman: false,
    freshnessSeconds: 3600,
    surveyExpirySeconds: 86400,
    workerLagSeconds: 120,
    managerStaffId: "fixture-manager",
  },
});
function intake(hour, date = "2026-09-14") {
  const time = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString();
  return { occurredAt: time, receivedAt: time, entryPointType: "sales" };
}
function calc(p, h, date) {
  const i = intake(h, date);
  return calculateServiceSchedule(p, i, new Date(i.receivedAt));
}
test("AT38 draft or incomplete rules never create service obligations", () => {
  assert.equal(calc(draftServicePolicy(), 8).status, "unresolved");
  const p = hypothetical();
  p.rules.atClose = null;
  assert.equal(calc(p, 8).status, "unresolved");
});
test("AT39/40 hypothetical opening-hours boundaries keep overnight survey separate", () => {
  const p = hypothetical();
  for (const [hour, response, survey] of [
    [7, "2026-09-14T03:00:00.000Z", "2026-09-14T02:00:00.000Z"],
    [8, "2026-09-14T03:00:00.000Z", "2026-09-14T03:00:00.000Z"],
    [21, "2026-09-15T02:00:00.000Z", "2026-09-15T02:00:00.000Z"],
    [22, "2026-09-15T03:00:00.000Z", "2026-09-15T02:00:00.000Z"],
    [23, "2026-09-15T03:00:00.000Z", "2026-09-15T02:00:00.000Z"],
  ]) {
    const r = calc(p, hour);
    assert.equal(r.status, "ready");
    assert.equal(r.responseDueAt, response, `response ${hour}`);
    assert.equal(r.surveyDueAt, survey, `survey ${hour}`);
  }
});
test("AT39 holidays and weekends advance to approved next working day", () => {
  const p = hypothetical();
  p.rules.holidays = ["2026-09-14"];
  const r = calc(p, 23, "2026-09-11");
  assert.equal(r.responseDueAt, "2026-09-15T03:00:00.000Z");
  assert.equal(r.surveyDueAt, "2026-09-15T02:00:00.000Z");
});
test("elapsed cross-closing is distinct from proposed opening-hour calculation", () => {
  const p = hypothetical();
  p.rules.durationMode = "elapsed";
  p.rules.crossClosing = "elapsed";
  assert.equal(calc(p, 21).responseDueAt, "2026-09-14T16:00:00.000Z");
});
test("AT41 invalid future stale or pre-policy intake is unresolved, never refreshed to now", () => {
  const p = hypothetical();
  const i = intake(8);
  for (const time of [null, "invalid", "2026-09-15T00:00:00Z", "2025-01-01T00:00:00Z"])
    assert.equal(
      calculateServiceSchedule(p, { ...i, occurredAt: time }, new Date(i.receivedAt)).status,
      "unresolved",
    );
});
test("reception applicability remains explicit", () => {
  const p = hypothetical(),
    i = intake(8);
  assert.equal(
    calculateServiceSchedule(p, { ...i, entryPointType: "reception" }, new Date(i.receivedAt))
      .status,
    "not_applicable",
  );
});
test("approved source copy is exact and arbitrary/unapproved purpose is refused", () => {
  assert.equal(
    SERVICE_COPY.survey,
    "多謝選用晉誠地產，距離您發送樓盤查詢已有一段時間，\n請問您滿意我們的服務或需要進一步協助嗎?\n1.滿意\n2.需要進一步協助",
  );
  assert.equal(
    renderServiceCopy("survey_thanks", hypothetical()),
    "多謝您滿意我們的服務，希望能繼續為閣下服務",
  );
  assert.equal(
    renderServiceCopy("manager_ack", hypothetical()),
    "我們的分行經理會盡快與您聯絡提供進一步協助",
  );
  assert.throws(() => renderServiceCopy("survey", draftServicePolicy()));
  assert.throws(() => renderServiceCopy("marketing", hypothetical()));
});

test("AT41 every string timestamp requires an explicit offset and a real calendar date", () => {
  const p = hypothetical(),
    i = intake(8),
    now = new Date(i.receivedAt);
  for (const invalid of [
    "2026-09-14T08:00:00",
    "2026-02-30T08:00:00+08:00",
    "2026-09-14T24:00:00+08:00",
    "2026-09-14T08:00:00+24:00",
  ]) {
    assert.equal(
      calculateServiceSchedule(p, { ...i, occurredAt: invalid }, now).status,
      "unresolved",
      `occurredAt ${invalid}`,
    );
    assert.equal(
      calculateServiceSchedule(p, { ...i, receivedAt: invalid }, now).status,
      "unresolved",
      `receivedAt ${invalid}`,
    );
    assert.equal(
      calculateServiceSchedule({ ...p, effectiveAt: invalid }, i, now).status,
      "unresolved",
      `effectiveAt ${invalid}`,
    );
  }
  const impossible = "2026-02-30T08:00:00+08:00";
  assert.equal(
    calculateServiceSchedule(
      p,
      { ...i, occurredAt: impossible, receivedAt: impossible },
      new Date(impossible),
    ).status,
    "unresolved",
  );
  assert.equal(
    calculateServiceSchedule(p, { ...i, receivedAt: "2026-09-15T00:00:00Z" }, now).status,
    "unresolved",
  );
  assert.equal(calculateServiceSchedule(p, i, new Date(NaN)).status, "unresolved");
});

test("AT41 equivalent explicit offsets and valid leap days remain usable", () => {
  const p = hypothetical(),
    i = intake(8),
    now = new Date(i.receivedAt);
  assert.deepEqual(
    calculateServiceSchedule(p, i, now),
    calculateServiceSchedule(
      p,
      { ...i, occurredAt: "2026-09-14T08:00:00+08:00", receivedAt: "2026-09-14T08:00:00+08:00" },
      now,
    ),
  );
  const leap = "2028-02-29T08:00:00.123+08:00";
  assert.equal(
    calculateServiceSchedule(p, { ...i, occurredAt: leap, receivedAt: leap }, new Date(leap))
      .status,
    "ready",
  );
});

test("AT39 later opening calendars use a future workday 10:00 survey", () => {
  const p = hypothetical();
  p.rules.openMinute = 720;
  assert.equal(calc(p, 11).surveyDueAt, "2026-09-15T02:00:00.000Z");
  assert.equal(calc(p, 10).surveyDueAt, "2026-09-15T02:00:00.000Z");
  assert.equal(calc(p, 9).surveyDueAt, "2026-09-14T02:00:00.000Z");
  p.rules.holidays = ["2026-09-14"];
  const r = calc(p, 11, "2026-09-11");
  assert.equal(r.status, "ready");
  assert.equal(r.responseDueAt, "2026-09-11T07:00:00.000Z");
  assert.equal(r.surveyDueAt, "2026-09-15T02:00:00.000Z");
});

test("routing-only approval does not require or authorize customer service", () => {
  const p = {
    ...hypothetical(),
    copy: { afterHours: null },
    rules: {
      ...draftServicePolicy().rules,
      purpose: "routing_notifications",
      managerStaffId: "11111111-1111-4111-8111-111111111111",
      freshnessSeconds: 300,
    },
  };
  assert.deepEqual(unresolvedServicePolicy(p), []);
  assert.deepEqual(calc(p, 8), { status: "not_applicable", reason: "ROUTING_ONLY_POLICY" });
  p.rules.managerStaffId = null;
  assert.ok(unresolvedServicePolicy(p).includes("POLICY_MISSING_managerStaffId"));
  p.rules.freshnessSeconds = null;
  assert.ok(unresolvedServicePolicy(p).includes("POLICY_INVALID_freshnessSeconds"));
  p.status = "draft";
  assert.ok(unresolvedServicePolicy(p).includes("POLICY_NOT_APPROVED"));
});
