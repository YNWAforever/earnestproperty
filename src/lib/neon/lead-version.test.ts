import { expect, test } from "bun:test";
import { isLeadVersion, LEAD_VERSION_PATTERN, leadVersionSql } from "./lead-version";

test("leadVersionSql emits the exact to_char expression and rejects unsafe aliases", () => {
  expect(leadVersionSql("l")).toBe(
    `to_char(l.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );
  expect(leadVersionSql("old_lead")).toBe(
    `to_char(old_lead.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );
  expect(() => leadVersionSql("l; drop")).toThrow();
  expect(() => leadVersionSql("")).toThrow();
  expect(() => leadVersionSql("L")).toThrow();
});

test("isLeadVersion accepts only the microsecond UTC form", () => {
  expect(isLeadVersion("2026-10-06T03:04:05.123456Z")).toBe(true);
  expect(LEAD_VERSION_PATTERN.test("2026-10-06T03:04:05.123456Z")).toBe(true);
  for (const value of [
    "2026-10-06T03:04:05.123Z",
    "2026-10-06T03:04:05Z",
    "",
    null,
    undefined,
    1696561445123,
  ]) {
    expect(isLeadVersion(value)).toBe(false);
  }
});
