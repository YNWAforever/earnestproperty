import { expect, test } from "bun:test";
import { assertReleaseControls, type ReleaseControls } from "./release-controls";

const digest = (char: string) => char.repeat(64);
const now = Date.parse("2026-11-05T12:00:00Z");
const target = {
  projectId: "fixture-project",
  branchId: "fixture-branch",
  endpointId: "fixture-endpoint",
  host: "fixture.invalid",
  port: 5432,
  database: "fixture-db",
  role: "fixture-role",
  systemIdentifier: "123456789",
  serverVersion: 180006,
};
const fixture: ReleaseControls = {
  packetSha256: digest("a"),
  target,
  approval: { packetSha256: digest("a"), expiresAt: now + 120_000, startsAt: now - 1000 },
  backup: { target, archiveSha256: digest("b"), restoreReceiptSha256: digest("c") },
  fence: { target, generation: "fixture-generation", receiptSha256: digest("d") },
};
const observed = {
  ...structuredClone(fixture),
  session: {
    database: target.database,
    currentRole: target.role,
    sessionRole: target.role,
    systemIdentifier: target.systemIdentifier,
    serverVersion: target.serverVersion,
    backendPid: 10,
    tlsHost: target.host,
    tlsPort: target.port,
  },
};

test("matches independent evidence for one pinned session", () => {
  expect(() => assertReleaseControls(fixture, observed, 10, now)).not.toThrow();
});

for (const [control, error] of [
  ["target", "RELEASE_TARGET"],
  ["approval", "RELEASE_APPROVAL"],
  ["backup", "RELEASE_BACKUP"],
  ["fence", "RELEASE_FENCE"],
  ["session", "RELEASE_SESSION"],
] as const) {
  test("refuses absent " + control, () => {
    expect(() =>
      assertReleaseControls(fixture, { ...observed, [control]: undefined }, 10, now),
    ).toThrow(error);
  });
}

for (const [name, edit, error] of [
  [
    "rehashed packet",
    (x) => {
      x.packetSha256 = digest("e");
    },
    "RELEASE_APPROVAL",
  ],
  [
    "target mapping",
    (x) => {
      x.target.branchId = "other-branch";
    },
    "RELEASE_TARGET",
  ],
  [
    "expired approval",
    (x) => {
      x.approval.expiresAt = now;
    },
    "RELEASE_APPROVAL",
  ],
  [
    "backup restore",
    (x) => {
      x.backup.restoreReceiptSha256 = digest("e");
    },
    "RELEASE_BACKUP",
  ],
  [
    "fence generation",
    (x) => {
      x.fence.generation = "later";
    },
    "RELEASE_FENCE",
  ],
  [
    "session database",
    (x) => {
      x.session.database = "other";
    },
    "RELEASE_SESSION",
  ],
  [
    "session role",
    (x) => {
      x.session.sessionRole = "other";
    },
    "RELEASE_SESSION",
  ],
  [
    "session system",
    (x) => {
      x.session.systemIdentifier = "other";
    },
    "RELEASE_SESSION",
  ],
  [
    "server version",
    (x) => {
      x.session.serverVersion = 170006;
    },
    "RELEASE_SESSION",
  ],
  [
    "TLS host",
    (x) => {
      x.session.tlsHost = "other.invalid";
    },
    "RELEASE_SESSION",
  ],
  [
    "different backend",
    (x) => {
      x.session.backendPid++;
    },
    "RELEASE_SESSION",
  ],
] satisfies [string, (value: typeof observed) => void, string][]) {
  test("rejects " + name, () => {
    const candidate = structuredClone(observed);
    edit(candidate);
    expect(() => assertReleaseControls(fixture, candidate, 10, now)).toThrow(error);
  });
}
