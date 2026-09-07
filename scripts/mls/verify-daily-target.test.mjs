import test from "node:test";
import assert from "node:assert/strict";
import { verifyDailyTarget } from "./verify-daily-target.mjs";

test("daily apply requires the exact approved direct Neon endpoint", () => {
  const host = "ep-approved.ap-southeast-1.aws.neon.tech";
  const uri = `postgresql://owner:example-secret@${host}/neondb?sslmode=require`;
  assert.equal(verifyDailyTarget(uri, host), true);
  for (const [value, expected] of [
    [uri, ""],
    [uri + "&host=ep-other.ap-southeast-1.aws.neon.tech", host],
    [uri + "&database=other", host],
    [uri + "&options=endpoint%3Dep-other", host],
    [uri, "ep-other.ap-southeast-1.aws.neon.tech"],
    [uri.replace("ep-approved.", "ep-approved-pooler."), host],
    [uri.replace("/neondb", "/other"), host],
    ["not-a-connection-example-secret", host],
    [uri.replace("postgresql:", "https:"), host],
  ]) {
    assert.throws(
      () => verifyDailyTarget(value, expected),
      (error) => {
        assert.equal(error.message, "DAILY_DATABASE_TARGET_UNVERIFIED");
        assert.ok(!error.message.includes("example-secret"));
        return true;
      },
    );
  }
});
