import assert from "node:assert/strict";
import type { HostedInput } from "./hosted-contract";

export type RecoveryEvidence = {
  target: { origin: string; deploymentId: string; commit: string };
  faultId: string;
  failures: { name: "pageServer" | "articleServer"; status: number }[];
  pages: {
    path: string;
    unavailableStatus: number;
    unavailableVisible: boolean;
    retryVisible: boolean;
    recoveredStatus: number;
    recoveredTitle: string;
  }[];
  restored: boolean;
  elapsedMs: number;
};
export function validateRecovery(
  p: HostedInput,
  result: RecoveryEvidence,
  expected: { path: string; title: string }[],
) {
  assert.deepEqual(
    result.target,
    { origin: p.target.origin, deploymentId: p.target.deploymentId, commit: p.target.commit },
    "RECOVERY_TARGET",
  );
  assert.equal(result.faultId, p.recovery.id, "RECOVERY_FAULT_BINDING");
  assert.equal(result.restored, true, "RECOVERY_NOT_RESTORED");
  assert.ok(
    result.elapsedMs >= 0 && result.elapsedMs <= p.recovery.maxDurationMs,
    "RECOVERY_DEADLINE",
  );
  assert.deepEqual(
    result.failures,
    [
      { name: "pageServer", status: 503 },
      { name: "articleServer", status: 503 },
    ],
    "RECOVERY_REAL_UNAVAILABLE_REQUIRED",
  );
  assert.deepEqual(
    result.pages,
    expected.map((v) => ({
      path: v.path,
      unavailableStatus: 500,
      unavailableVisible: true,
      retryVisible: true,
      recoveredStatus: 200,
      recoveredTitle: v.title,
    })),
    "RECOVERY_BROWSER_EVIDENCE_REQUIRED",
  );
}

/** Fixed sequencing used by native browser recovery and local tests. No fulfilled/mock response counts as failure. */
export async function exerciseRecovery(
  p: HostedInput,
  expected: { path: string; title: string }[],
  io: {
    enable(): Promise<void>;
    restore(): Promise<void>;
    failedRpc(name: "pageServer" | "articleServer"): Promise<number>;
    unavailable(
      path: string,
    ): Promise<Omit<RecoveryEvidence["pages"][number], "recoveredStatus" | "recoveredTitle">>;
    recover(
      path: string,
      title: string,
    ): Promise<{ recoveredStatus: number; recoveredTitle: string }>;
    now(): number;
  },
) {
  const start = io.now();
  const guard = () => assert.ok(io.now() - start <= p.recovery.maxDurationMs, "RECOVERY_DEADLINE");
  const failures: RecoveryEvidence["failures"] = [],
    pages: RecoveryEvidence["pages"] = [];
  const unavailable: Awaited<ReturnType<typeof io.unavailable>>[] = [];
  // Always restore even when enable's response is lost or a probe fails.
  try {
    await io.enable();
    guard();
    for (const name of ["pageServer", "articleServer"] as const) {
      const status = await io.failedRpc(name);
      guard();
      assert.equal(status, 503, "RECOVERY_REAL_UNAVAILABLE_REQUIRED");
      failures.push({ name, status });
    }
    for (const v of expected) {
      unavailable.push(await io.unavailable(v.path));
      guard();
    }
  } finally {
    await io.restore();
  }
  for (const [i, v] of expected.entries()) {
    guard();
    pages.push({ ...unavailable[i], ...(await io.recover(v.path, v.title)) });
  }
  const result: RecoveryEvidence = {
    target: {
      origin: p.target.origin,
      deploymentId: p.target.deploymentId,
      commit: p.target.commit,
    },
    faultId: p.recovery.id,
    failures,
    pages,
    restored: true,
    elapsedMs: io.now() - start,
  };
  validateRecovery(p, result, expected);
  return result;
}
