import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonical, fingerprint } from "../../src/lib/blog/reconcile";
import * as recovery from "./recovery-evidence";
import { runRecoveryCli } from "./recovery-receipt";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const now = Date.parse("2026-11-06T13:00:00Z");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const keys = generateKeyPairSync("ed25519");
const target = {
  projectId: "dawn-meadow-79190048",
  branchId: "br-polished-sea-aom4i1ct",
  endpointId: "ep-synthetic-production",
  host: "ep-synthetic-production.ap-southeast-1.aws.neon.tech",
  port: 5432,
  database: "neondb",
  role: "synthetic_observer",
  systemIdentifier: "123456789",
  serverVersion: 180000,
};

export function fixture() {
  const artifacts = new Map<string, Uint8Array>();
  const artifact = (text: string) => {
    artifacts.set(digest(text), Buffer.from(text));
    return digest(text);
  };
  const tableNames = [
    "public.app_migrations",
    "public.articles",
    "public.blog_categories",
    "public.blog_settings",
    "public.blog_featured_articles",
    "public.blog_legacy_category_map",
    "public.cms_content_revisions",
    "public.media_assets",
    "public.media_upload_intents",
    "public.properties",
  ];
  const tables = tableNames.map((name) => ({ name, rows: 2, sha256: digest(name) }));
  const state = { schemaSha256: digest("schema"), tables };
  const mediaTarget = {
    storeId: "store_sEHe3hQ90qGByxQA",
    host: "synthetic.public.blob.vercel-storage.com",
    prefix: "",
    count: 1,
    bytes: 5,
  };
  const destination = {
    strategy: "separate-store",
    storeId: "store_synthetic_isolated",
    host: "isolated.public.blob.vercel-storage.com",
    prefix: "recovery/",
  };
  const context = {
    format: "blog-recovery-context-v1",
    target: structuredClone(target),
    packetSha256: digest("packet"),
    releaseHead: "8".repeat(40),
    startsAt: now - 3600000,
    expiresAt: now + 3600000,
    evidencePublicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    approvalSha256: artifact("synthetic snapshot and restore approval"),
    cleanupApprovalSha256: artifact("synthetic separate cleanup approval"),
    tableNames,
    mediaTarget,
    destination,
    snapshotName: "blog-cms-synthetic-snapshot",
    restoreBranchName: "blog-cms-synthetic-restore",
    isolationLabel: "blog-cms-synthetic",
  };
  const object = {
    key: "image.png",
    bytes: 5,
    sha256: artifact("image"),
    metadataSha256: digest("image metadata"),
  };
  const record = {
    format: "blog-recovery-evidence-v1",
    contextSha256: fingerprint(context),
    startsAt: now - 3600000,
    expiresAt: now + 1800000,
    fence: { drainedAt: now - 3000000, receiptSha256: artifact("fence and drain evidence") },
    snapshot: {
      kind: "neon-provider-snapshot",
      id: "snap-synthetic",
      name: context.snapshotName,
      state: "ready",
      createdAt: now - 2900000,
      readyAt: now - 2800000,
      historyStartAt: now - 21600000,
      historyEndAt: now - 2800000,
      retainUntil: now + 3600000,
      lsn: "0/123AB",
      providerEvidenceSha256: artifact("snapshot ready readback"),
    },
    restore: {
      operation: "restore-new-branch",
      snapshotId: "snap-synthetic",
      name: context.restoreBranchName,
      target: {
        ...target,
        branchId: "br-synthetic-restore",
        endpointId: "ep-synthetic-restore",
        host: "ep-synthetic-restore.ap-southeast-1.aws.neon.tech",
      },
      createdAt: now - 2700000,
      readyAt: now - 2600000,
      isolationLabel: context.isolationLabel,
      applicationBindings: [],
      providerEvidenceSha256: artifact("new branch provider operation"),
      isolationEvidenceSha256: artifact("branch access rules and empty application bindings"),
    },
    database: {
      scope: "full-database",
      capturedAt: now - 2500000,
      catalogSha256: artifact("independently reviewed full database table catalog"),
      baseline: structuredClone(state),
      restored: structuredClone(state),
      privacy: {
        articleRows: 2,
        revisionRows: 2,
        baselineSha256: digest("all private and published rows"),
        restoredSha256: digest("all private and published rows"),
      },
      verificationArchiveSha256: artifact(
        "schema ledger all rows all revisions privacy and unaffected tables",
      ),
    },
    media: {
      inventoriedAt: now - 2950000,
      objects: [object],
      inventoryArchiveSha256: artifact("complete media inventory with pagination evidence"),
      uploads: {
        rows: 2,
        pending: 1,
        rowsSha256: digest("upload rows"),
        dispositionArchiveSha256: artifact("pending upload held and referenced objects resolved"),
        references: [
          { uploadId: "upload-1", state: "completed", objectKey: "image.png" },
          { uploadId: "upload-2", state: "held", objectKey: null },
        ],
      },
      restore: {
        completedAt: now - 2400000,
        destination: structuredClone(destination),
        objects: [{ ...object, sourceKey: object.key, key: "recovery/image.png" }],
        readbackArchiveSha256: artifact("destination bytes and metadata readback"),
        isolationEvidenceSha256: artifact(
          "isolated store no application binding or shared write access",
        ),
      },
    },
    cleanup: {
      completedAt: now - 2300000,
      branchId: "br-synthetic-restore",
      destination: structuredClone(destination),
      deletedKeys: ["recovery/image.png"],
      remainingObjects: 0,
      branchState: "deleted",
      approvalSha256: context.cleanupApprovalSha256,
      evidenceSha256: artifact("cleanup audit and post-cleanup readbacks"),
    },
  };
  const seal = () => ({
    record,
    signature: sign(null, Buffer.from(canonical(record)), keys.privateKey).toString("base64"),
  });
  return { context, record, artifacts, seal };
}

test("complete signed synthetic recovery yields expiring offline receipt, never production authority", () => {
  const f = fixture();
  const receipt = recovery.createRecoveryReceipt(f.seal(), f.context, f.artifacts, now);
  expect(receipt.record.status).toBe("OFFLINE_EVIDENCE_VALIDATED");
  expect(receipt.record.productionAuthorized).toBe(false);
  expect(receipt.record.expiresAt).toBe(now + 1800000);
  expect(
    recovery.verifyRecoveryReceipt(receipt, f.seal(), f.context, f.artifacts, now + 1),
  ).toBeUndefined();
});

const mutations: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    "local blog snapshots cannot stand in for provider backup",
    (f) => {
      Object.assign(f.record.snapshot, { kind: "local-blog-table-snapshot" });
    },
  ],
  [
    "boolean backup assertions",
    (f) => {
      Object.assign(f.record.snapshot, { backup: true });
    },
  ],
  [
    "boolean restore assertions",
    (f) => {
      Object.assign(f.record.restore, { restored: true });
    },
  ],
  [
    "boolean isolation assertions",
    (f) => {
      Object.assign(f.record.media.restore, { isolated: true });
    },
  ],
  [
    "boolean cleanup assertions",
    (f) => {
      Object.assign(f.record.cleanup, { cleaned: true });
    },
  ],
  [
    "snapshot not ready",
    (f) => {
      f.record.snapshot.state = "creating";
    },
  ],
  [
    "snapshot outside history",
    (f) => {
      f.record.snapshot.historyStartAt = now;
    },
  ],
  [
    "backup before fence drain",
    (f) => {
      f.record.snapshot.createdAt = f.record.fence.drainedAt - 1;
    },
  ],
  [
    "snapshot retention expired",
    (f) => {
      f.record.snapshot.retainUntil = now;
    },
  ],
  [
    "restore wrong snapshot",
    (f) => {
      f.record.restore.snapshotId = "snap-other";
    },
  ],
  [
    "restore production branch",
    (f) => {
      f.record.restore.target.branchId = target.branchId;
    },
  ],
  [
    "restore production endpoint",
    (f) => {
      f.record.restore.target.endpointId = target.endpointId;
    },
  ],
  [
    "restore wrong project",
    (f) => {
      f.record.restore.target.projectId = "other";
    },
  ],
  [
    "restore finalize operation",
    (f) => {
      f.record.restore.operation = "finalize-restore";
    },
  ],
  [
    "restore public app binding",
    (f) => {
      Object.assign(f.record.restore, { applicationBindings: ["production"] });
    },
  ],
  [
    "restore isolation label drift",
    (f) => {
      f.record.restore.isolationLabel = "other";
    },
  ],
  [
    "restore future timestamp",
    (f) => {
      f.record.restore.readyAt = now + 1;
    },
  ],
  [
    "database limited scope",
    (f) => {
      f.record.database.scope = "blog-tables";
    },
  ],
  [
    "missing unaffected tables",
    (f) => {
      f.record.database.restored.tables.pop();
    },
  ],
  [
    "duplicate coverage",
    (f) => {
      f.record.database.restored.tables.push(f.record.database.restored.tables[0]);
    },
  ],
  [
    "migration ledger mismatch",
    (f) => {
      f.record.database.restored.tables[0].sha256 = digest("bad ledger");
    },
  ],
  [
    "private revision omission",
    (f) => {
      f.record.database.privacy.revisionRows = 1;
    },
  ],
  [
    "private state drift",
    (f) => {
      f.record.database.privacy.restoredSha256 = digest("bad privacy");
    },
  ],
  [
    "media inventory omitted",
    (f) => {
      f.record.media.objects = [];
    },
  ],
  [
    "media duplicate objects",
    (f) => {
      f.record.media.objects.push(f.record.media.objects[0]);
    },
  ],
  [
    "unresolved referenced object",
    (f) => {
      f.record.media.uploads.references[0].objectKey = "missing.png";
    },
  ],
  [
    "missing held upload",
    (f) => {
      f.record.media.uploads.references.pop();
    },
  ],
  [
    "destination checksum drift",
    (f) => {
      f.record.media.restore.objects[0].sha256 = digest("bad bytes");
    },
  ],
  [
    "destination metadata drift",
    (f) => {
      f.record.media.restore.objects[0].metadataSha256 = digest("bad metadata");
    },
  ],
  [
    "destination path escape",
    (f) => {
      f.record.media.restore.objects[0].key = "recovery/../production.png";
    },
  ],
  [
    "destination production resource",
    (f) => {
      f.record.media.restore.destination.storeId = f.context.mediaTarget.storeId;
    },
  ],
  [
    "cleanup wrong branch",
    (f) => {
      f.record.cleanup.branchId = target.branchId;
    },
  ],
  [
    "cleanup objects remain",
    (f) => {
      f.record.cleanup.remainingObjects = 1;
    },
  ],
  [
    "cleanup incomplete key list",
    (f) => {
      f.record.cleanup.deletedKeys = [];
    },
  ],
  [
    "cleanup before byte verification",
    (f) => {
      f.record.cleanup.completedAt = f.record.media.restore.completedAt - 1;
    },
  ],
  [
    "cleanup approval substituted",
    (f) => {
      f.record.cleanup.approvalSha256 = digest("unapproved");
    },
  ],
  [
    "missing archive bytes",
    (f) => {
      f.artifacts.delete(f.record.snapshot.providerEvidenceSha256);
    },
  ],
  [
    "tampered archive bytes",
    (f) => {
      f.artifacts.set(f.record.snapshot.providerEvidenceSha256, Buffer.from("tampered"));
    },
  ],
  [
    "packet substitution",
    (f) => {
      f.context.packetSha256 = digest("different packet");
    },
  ],
  [
    "system identity substitution",
    (f) => {
      f.context.target.systemIdentifier = "987654321";
    },
  ],
  [
    "expired evidence",
    (f) => {
      f.record.expiresAt = now;
    },
  ],
  [
    "unbounded evidence",
    (f) => {
      f.record.expiresAt = now + 86400000;
    },
  ],
  [
    "future evidence",
    (f) => {
      f.record.startsAt = now + 1;
    },
  ],
];
for (const [name, mutate] of mutations)
  test("rejects " + name, () => {
    const f = fixture();
    mutate(f);
    expect(() => recovery.createRecoveryReceipt(f.seal(), f.context, f.artifacts, now)).toThrow();
  });

test("rejects unsigned or attacker-signed evidence and receipt tampering/replay", () => {
  const f = fixture();
  const sealed = f.seal();
  sealed.record.snapshot.id = "tampered";
  expect(() => recovery.createRecoveryReceipt(sealed, f.context, f.artifacts, now)).toThrow();
  const g = fixture();
  const attacker = generateKeyPairSync("ed25519");
  const forged = {
    record: g.record,
    signature: sign(null, Buffer.from(canonical(g.record)), attacker.privateKey).toString("base64"),
  };
  expect(() => recovery.createRecoveryReceipt(forged, g.context, g.artifacts, now)).toThrow();
  const receipt = recovery.createRecoveryReceipt(g.seal(), g.context, g.artifacts, now);
  expect(() =>
    recovery.verifyRecoveryReceipt(receipt, g.seal(), g.context, g.artifacts, now + 1800000),
  ).toThrow();
  receipt.record.packetSha256 = digest("other packet");
  expect(() =>
    recovery.verifyRecoveryReceipt(receipt, g.seal(), g.context, g.artifacts, now),
  ).toThrow();
});

test("untrusted malformed inputs, invalid clock and missing trust fail closed", () => {
  const f = fixture();
  for (const bad of [
    null,
    {},
    true,
    { backup: true, restored: true, isolated: true, cleaned: true },
  ])
    expect(() => recovery.createRecoveryReceipt(bad, f.context, f.artifacts, now)).toThrow();
  expect(() => recovery.createRecoveryReceipt(f.seal(), {}, f.artifacts, now)).toThrow();
  expect(() => recovery.createRecoveryReceipt(f.seal(), f.context, f.artifacts, NaN)).toThrow();
});

test("rehashed receipt edits cannot extend evidence validity or swap candidate binding", () => {
  const f = fixture();
  for (const edit of [
    (r: ReturnType<typeof recovery.createRecoveryReceipt>["record"]) => {
      r.expiresAt += 3600000;
    },
    (r: ReturnType<typeof recovery.createRecoveryReceipt>["record"]) => {
      r.packetSha256 = digest("replacement");
    },
    (r: ReturnType<typeof recovery.createRecoveryReceipt>["record"]) => {
      r.target.branchId = "br-other";
    },
  ]) {
    const receipt = recovery.createRecoveryReceipt(f.seal(), f.context, f.artifacts, now);
    edit(receipt.record);
    receipt.sha256 = fingerprint(receipt.record);
    expect(() =>
      recovery.verifyRecoveryReceipt(receipt, f.seal(), f.context, f.artifacts, now),
    ).toThrow("RECOVERY_RECEIPT");
  }
});

test("full catalog, restored schema and media copy coverage cannot be reduced", () => {
  const a = fixture();
  a.context.tableNames = a.context.tableNames.filter((n) => n !== "public.properties");
  a.record.contextSha256 = fingerprint(a.context);
  expect(() => recovery.createRecoveryReceipt(a.seal(), a.context, a.artifacts, now)).toThrow(
    "RECOVERY_FULL_CATALOG",
  );
  const b = fixture();
  b.record.database.restored.schemaSha256 = digest("changed schema");
  expect(() => recovery.createRecoveryReceipt(b.seal(), b.context, b.artifacts, now)).toThrow(
    "RECOVERY_DATABASE_MISMATCH",
  );
  const c = fixture();
  c.record.media.restore.objects = [];
  expect(() => recovery.createRecoveryReceipt(c.seal(), c.context, c.artifacts, now)).toThrow(
    "RECOVERY_MEDIA_COPY_COVERAGE",
  );
});

test("invalid CLI invocation exits nonzero without echoing input or loading environment files", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "run",
      "--no-env-file",
      "scripts/blog-cms/recovery-receipt.ts",
      "--apply",
      "PRIVATE_SENTINEL_DO_NOT_ECHO",
    ],
    {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toContain("RECOVERY_REJECTED");
  expect(result.stderr.toString()).not.toContain("PRIVATE_SENTINEL_DO_NOT_ECHO");
});

test("the published context template remains incomplete and cannot issue a receipt", () => {
  const context = JSON.parse(
    readFileSync("docs/superpowers/evidence/blog-cms/recovery-context.template.json", "utf8"),
  );
  const f = fixture();
  expect(() => recovery.createRecoveryReceipt(f.seal(), context, f.artifacts, now)).toThrow(
    "RECOVERY_SCHEMA",
  );
});

test("explicit prefix isolation succeeds only with a complete collision-free inventory", () => {
  const f = fixture();
  const d = {
    strategy: "approved-prefix",
    storeId: f.context.mediaTarget.storeId,
    host: f.context.mediaTarget.host,
    prefix: "drill/",
  };
  f.context.destination = structuredClone(d);
  f.record.media.restore.destination = structuredClone(d);
  f.record.cleanup.destination = structuredClone(d);
  f.record.media.restore.objects[0].key = "drill/image.png";
  f.record.cleanup.deletedKeys = ["drill/image.png"];
  f.record.contextSha256 = fingerprint(f.context);
  expect(
    recovery.createRecoveryReceipt(f.seal(), f.context, f.artifacts, now).record
      .productionAuthorized,
  ).toBe(false);
  f.record.media.objects[0].key = "drill/existing.png";
  expect(() => recovery.createRecoveryReceipt(f.seal(), f.context, f.artifacts, now)).toThrow(
    "RECOVERY_MEDIA_ISOLATION",
  );
});

test("CLI issues and re-verifies receipts, refuses overwrite, path escape, unknown options and invalid evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "blog-recovery-offline-"));
  try {
    const f = fixture();
    const artifactsDir = join(root, "artifacts");
    mkdirSync(artifactsDir);
    for (const [sha, bytes] of f.artifacts) writeFileSync(join(artifactsDir, sha), bytes);
    writeFileSync(join(root, "context.json"), JSON.stringify(f.context));
    writeFileSync(join(root, "evidence.json"), JSON.stringify(f.seal()));
    const receiptPath = join(root, ".private-sync-evidence/blog-recovery/receipt.json");
    const args = [
      "--context",
      join(root, "context.json"),
      "--evidence",
      join(root, "evidence.json"),
      "--artifacts",
      artifactsDir,
      "--receipt",
      receiptPath,
    ];
    expect(runRecoveryCli(["issue", ...args], root, now).status).toBe("OFFLINE_EVIDENCE_VALIDATED");
    expect(runRecoveryCli(["verify", ...args], root, now + 1).status).toBe(
      "OFFLINE_RECEIPT_VERIFIED",
    );
    const before = readFileSync(receiptPath, "utf8");
    expect(() => runRecoveryCli(["issue", ...args], root, now)).toThrow();
    expect(readFileSync(receiptPath, "utf8")).toBe(before);
    expect(() =>
      runRecoveryCli(["issue", ...args.slice(0, -1), join(root, "outside.json")], root, now),
    ).toThrow();
    expect(existsSync(join(root, "outside.json"))).toBe(false);
    expect(() => runRecoveryCli(["issue", ...args, "--apply", "true"], root, now)).toThrow();
    expect(() => runRecoveryCli(["issue", ...args, "--context", "other"], root, now)).toThrow();
    writeFileSync(join(root, "evidence.json"), '{"backup":true}');
    const rejectedPath = join(root, ".private-sync-evidence/blog-recovery/rejected.json");
    expect(() =>
      runRecoveryCli(["issue", ...args.slice(0, -1), rejectedPath], root, now),
    ).toThrow();
    expect(existsSync(rejectedPath)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
