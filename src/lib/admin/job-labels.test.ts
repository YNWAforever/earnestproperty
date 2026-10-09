import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DELIVERY_JOB_TYPES,
  JOB_FAILURE_REASONS,
  JOB_TYPE_LABELS,
  NON_DELIVERY_JOB_TYPES,
  jobCommandDescription,
  jobFailureReason,
  jobTypeLabel,
} from "./job-labels";

const handlersSource = readFileSync(
  new URL("../control-plane/job-handlers.server.ts", import.meta.url),
  "utf8",
);
const leadAlertSource = readFileSync(
  new URL("../neon/lead-alert-enqueue.js", import.meta.url),
  "utf8",
);
const jobsServerSource = readFileSync(
  new URL("../control-plane/jobs.server.ts", import.meta.url),
  "utf8",
);

/** Every job type the registry can register: literals, the staff loop, and the lead-alert pair. */
function registeredJobTypes(): string[] {
  const types = new Set<string>();
  for (const match of handlersSource.matchAll(/jobType: "([a-z.]+)"/g)) types.add(match[1]);
  const loop = handlersSource.match(/for \(const jobType of \[\s*((?:"[a-z.]+",?\s*)+)\]/)?.[1];
  for (const match of (loop ?? "").matchAll(/"([a-z.]+)"/g)) types.add(match[1]);
  for (const match of leadAlertSource.matchAll(
    /export const LEAD_ALERT(?:_RECONCILE)?_JOB_TYPE = "([a-z.]+)"/g,
  ))
    types.add(match[1]);
  return [...types].sort();
}

test("every registered job type has a label", () => {
  const registered = registeredJobTypes();
  // 15 types: the reader found the staff loop and the lead-alert pair, not only literals.
  expect(registered).toHaveLength(15);
  expect(Object.keys(JOB_TYPE_LABELS).sort()).toEqual(registered);
  for (const type of registered) expect(jobTypeLabel(type)).not.toBe("其他工作");
});

test("every code the job runner can store has a reason", () => {
  const codes = [
    "JOB_HANDLER_FAILED",
    "LEASE_EXPIRED",
    "JOB_DEFERRED",
    "WOZTELL_PROVIDER_TIMEOUT",
    "WOZTELL_PROVIDER_UNAVAILABLE",
    "WOZTELL_CONFIGURATION_UNAVAILABLE",
    "WOZTELL_DELIVERY_INCOMPLETE",
    "WOZTELL_CAMPAIGN_PAUSED",
  ];
  for (const code of codes) {
    expect(JOB_FAILURE_REASONS[code]).toBeTruthy();
    expect(jobFailureReason(code, "failed")).toBe(JOB_FAILURE_REASONS[code]);
  }
  // The runner itself stores these beside safeJobErrorCode's output.
  expect(jobsServerSource).toContain("LEASE_EXPIRED");
  expect(jobsServerSource).toContain("JOB_DEFERRED");
  expect(jobsServerSource).toContain("JOB_HANDLER_FAILED");
});

test("unknown and null codes fall back", () => {
  expect(jobFailureReason(null, "failed")).toBe("失敗，未有記錄原因。");
  expect(jobFailureReason("SOMETHING_NEW", "failed")).toBe("處理失敗（未分類原因）。");
  expect(jobFailureReason("WOZTELL_PROVIDER_TIMEOUT", "queued")).toBe(
    "WhatsApp 服務沒有及時回應。",
  );
  expect(jobFailureReason(null, "queued")).toBeNull();
  expect(jobFailureReason("JOB_HANDLER_FAILED", "succeeded")).toBeNull();
  expect(jobTypeLabel("not.a.job")).toBe("其他工作");
  expect(jobTypeLabel("constructor")).toBe("其他工作");
  expect(
    jobCommandDescription({
      jobType: "woztell.campaign.deliver",
      status: "failed",
      errorCode: "WOZTELL_PROVIDER_TIMEOUT",
    }),
  ).toBe("推廣活動發送：WhatsApp 服務沒有及時回應。");
});

test("every registered job type is classified as sending WhatsApp or not, so the retry warning cannot miss one", () => {
  const registered = registeredJobTypes();
  expect([...DELIVERY_JOB_TYPES, ...NON_DELIVERY_JOB_TYPES].sort()).toEqual(registered);
  expect(DELIVERY_JOB_TYPES.filter((type) => NON_DELIVERY_JOB_TYPES.includes(type))).toEqual([]);
  // Campaign delivery, reply send, lead alert and staff notifications all warn.
  for (const type of [
    "woztell.campaign.deliver",
    "woztell.reply.deliver",
    "lead.staff.alert",
    "woztell.enquiry.staff.notify",
  ])
    expect(DELIVERY_JOB_TYPES).toContain(type);
});
