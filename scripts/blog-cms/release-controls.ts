import { canonical } from "../../src/lib/blog/reconcile";

type Target = Readonly<{
  projectId: string;
  branchId: string;
  endpointId: string;
  host: string;
  port: number;
  database: string;
  role: string;
  systemIdentifier: string;
  serverVersion: number;
}>;

export type ReleaseControls = Readonly<{
  packetSha256: string;
  target: Target;
  approval: { packetSha256: string; startsAt: number; expiresAt: number };
  backup: { target: Target; archiveSha256: string; restoreReceiptSha256: string };
  fence: { target: Target; generation: string; receiptSha256: string };
}>;

type Observation = ReleaseControls & {
  session: {
    database: string;
    currentRole: string;
    sessionRole: string;
    systemIdentifier: string;
    serverVersion: number;
    backendPid: number;
    tlsHost: string;
    tlsPort: number;
  };
};

const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);

/** Consistency checks only. This does not authenticate evidence, connect or issue a capability. */
export function assertReleaseControls(
  expected: ReleaseControls,
  observed: Partial<Observation>,
  pinnedBackendPid: number,
  now: number,
) {
  const { target, packetSha256, approval, backup, fence } = expected;
  if (!observed.target || canonical(observed.target) !== canonical(target))
    throw new Error("RELEASE_TARGET");
  if (
    !digest(packetSha256) ||
    observed.packetSha256 !== packetSha256 ||
    approval?.packetSha256 !== packetSha256 ||
    !observed.approval ||
    canonical(observed.approval) !== canonical(approval) ||
    ![now, approval.startsAt, approval.expiresAt].every(Number.isFinite) ||
    now < approval.startsAt ||
    now >= approval.expiresAt
  )
    throw new Error("RELEASE_APPROVAL");
  if (
    !backup ||
    !observed.backup ||
    !digest(backup.archiveSha256) ||
    !digest(backup.restoreReceiptSha256) ||
    canonical(backup.target) !== canonical(target) ||
    canonical(observed.backup) !== canonical(backup)
  )
    throw new Error("RELEASE_BACKUP");
  if (
    !fence?.generation ||
    !observed.fence ||
    !digest(fence.receiptSha256) ||
    canonical(fence.target) !== canonical(target) ||
    canonical(observed.fence) !== canonical(fence)
  )
    throw new Error("RELEASE_FENCE");
  const s = observed.session;
  if (
    !s ||
    s.database !== target.database ||
    s.currentRole !== target.role ||
    s.sessionRole !== target.role ||
    s.systemIdentifier !== target.systemIdentifier ||
    s.serverVersion !== target.serverVersion ||
    s.tlsHost !== target.host ||
    s.tlsPort !== target.port ||
    !Number.isInteger(pinnedBackendPid) ||
    pinnedBackendPid <= 0 ||
    s.backendPid !== pinnedBackendPid
  )
    throw new Error("RELEASE_SESSION");
}
