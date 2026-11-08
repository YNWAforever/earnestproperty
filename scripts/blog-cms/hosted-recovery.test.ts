import { test, expect } from "bun:test";
import { fixture } from "./hosted-test-fixture";
import { exerciseRecovery } from "./hosted-recovery";

function localSeam() {
  const p = fixture(),
    expected = [
      { path: "/blog", title: "Main" },
      { path: "/blog/" + p.articles[0].slug, title: "Article" },
    ];
  let restored = 0,
    time = 0;
  const io = {
    enable: async () => {},
    restore: async () => {
      restored++;
    },
    failedRpc: async () => 503,
    now: () => time,
    unavailable: async (path: string) => ({
      path,
      unavailableStatus: 500,
      unavailableVisible: true,
      retryVisible: true,
    }),
    recover: async (_path: string, title: string) => ({
      recoveredStatus: 200,
      recoveredTitle: title,
    }),
  };
  return {
    p,
    expected,
    io,
    restored: () => restored,
    expire: () => {
      time = 60001;
    },
  };
}
test("LOCAL_SEAM: two successful requests are not unavailable/recovery evidence", async () => {
  const s = localSeam();
  s.io.failedRpc = async () => 200;
  await expect(exerciseRecovery(s.p, s.expected, s.io)).rejects.toThrow(
    "RECOVERY_REAL_UNAVAILABLE_REQUIRED",
  );
  expect(s.restored()).toBe(1);
});
test("LOCAL_SEAM: failure or deadline always restores, missing browser recovery fails", async () => {
  const s = localSeam();
  s.io.unavailable = async () => {
    throw new Error("unavailable UI missing");
  };
  await expect(exerciseRecovery(s.p, s.expected, s.io)).rejects.toThrow("unavailable UI missing");
  expect(s.restored()).toBe(1);
  const timed = localSeam();
  timed.io.failedRpc = async () => {
    timed.expire();
    return 503;
  };
  await expect(exerciseRecovery(timed.p, timed.expected, timed.io)).rejects.toThrow(
    "RECOVERY_DEADLINE",
  );
  expect(timed.restored()).toBe(1);
  const noRecovery = localSeam();
  noRecovery.io.recover = async () => ({ recoveredStatus: 503, recoveredTitle: "unavailable" });
  await expect(exerciseRecovery(noRecovery.p, noRecovery.expected, noRecovery.io)).rejects.toThrow(
    "RECOVERY_BROWSER_EVIDENCE_REQUIRED",
  );
});
