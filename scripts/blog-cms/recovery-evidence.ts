import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { canonical, fingerprint } from "../../src/lib/blog/reconcile";
import { productionTargetSchema } from "./production-evidence";
import {
  referenceManifestSchema,
  uploadReferenceSchema,
  validateReferenceManifest,
} from "./recovery-reference-manifest";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z
  .string()
  .min(1)
  .max(256)
  .refine((v) => v.trim() === v && !/[{}<>\r\n]/.test(v));
const time = z.number().int().positive().safe();
const count = z.number().int().nonnegative().safe();
const host = z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/);
const key = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (v) =>
      !v.startsWith("/") &&
      !/[\\%?#]/.test(v) &&
      ![...v].some((c) => c.charCodeAt(0) < 32) &&
      !v.split("/").some((s) => s === "." || s === ".." || !s),
  );
const prefix = z
  .string()
  .max(1024)
  .refine((v) => v === "" || (v.endsWith("/") && key.safeParse(v.slice(0, -1)).success));
const target = productionTargetSchema
  .extend({
    projectId: text,
    branchId: text,
    endpointId: text,
    host,
    database: text,
    role: text,
  })
  .strict();
const destination = z
  .object({
    strategy: z.enum(["separate-store", "approved-prefix"]),
    storeId: text,
    host,
    prefix,
  })
  .strict();
const contextSchema = z
  .object({
    format: z.literal("blog-recovery-context-v2"),
    target,
    packetSha256: hash,
    releaseHead: z.string().regex(/^[a-f0-9]{40}$/),
    startsAt: time,
    expiresAt: time,
    evidencePublicKey: z.string().max(4096),
    approvalSha256: hash,
    cleanupApprovalSha256: hash,
    tableNames: z.array(text).min(1),
    mediaTarget: z.object({ storeId: text, host, prefix, count, bytes: count }).strict(),
    destination,
    snapshotId: text,
    restoredTarget: target,
    cleanupIdentity: z.object({ target, destination, deletedKeys: z.array(key) }).strict(),
    excludedReferenceValues: z.array(z.string().min(1)),
    snapshotName: text,
    restoreBranchName: text,
    isolationLabel: text,
  })
  .strict();
const table = z.object({ name: text, rows: count, sha256: hash }).strict();
const databaseState = z.object({ schemaSha256: hash, tables: z.array(table).min(1) }).strict();
const object = z.object({ key, bytes: count, sha256: hash, metadataSha256: hash }).strict();
const recordSchema = z
  .object({
    format: z.literal("blog-recovery-evidence-v2"),
    contextSha256: hash,
    startsAt: time,
    expiresAt: time,
    fence: z.object({ drainedAt: time, receiptSha256: hash }).strict(),
    snapshot: z
      .object({
        kind: z.literal("neon-provider-snapshot"),
        id: text,
        name: text,
        state: z.literal("ready"),
        createdAt: time,
        readyAt: time,
        historyStartAt: time,
        historyEndAt: time,
        retainUntil: time,
        lsn: z.string().regex(/^[0-9A-F]+\/[0-9A-F]+$/),
        providerEvidenceSha256: hash,
      })
      .strict(),
    restore: z
      .object({
        operation: z.literal("restore-new-branch"),
        snapshotId: text,
        name: text,
        target,
        createdAt: time,
        readyAt: time,
        isolationLabel: text,
        applicationBindings: z.array(z.never()).length(0),
        providerEvidenceSha256: hash,
        isolationEvidenceSha256: hash,
      })
      .strict(),
    database: z
      .object({
        scope: z.literal("full-database"),
        capturedAt: time,
        catalogSha256: hash,
        baseline: databaseState,
        restored: databaseState,
        privacy: z
          .object({
            articleRows: count,
            revisionRows: count,
            baselineSha256: hash,
            restoredSha256: hash,
          })
          .strict(),
        verificationArchiveSha256: hash,
      })
      .strict(),
    media: z
      .object({
        inventoriedAt: time,
        objects: z.array(object),
        inventoryArchiveSha256: hash,
        referenceManifest: referenceManifestSchema,
        uploads: z
          .object({
            rows: count,
            pending: count,
            rowsSha256: hash,
            dispositionArchiveSha256: hash,
            references: z.array(uploadReferenceSchema),
          })
          .strict(),
        restore: z
          .object({
            completedAt: time,
            destination,
            objects: z.array(object.extend({ sourceKey: key }).strict()),
            readbackArchiveSha256: hash,
            isolationEvidenceSha256: hash,
          })
          .strict(),
      })
      .strict(),
    cleanup: z
      .object({
        completedAt: time,
        branchId: text,
        target,
        destination,
        deletedKeys: z.array(key),
        remainingObjects: z.literal(0),
        branchState: z.literal("deleted"),
        approvalSha256: hash,
        evidenceSha256: hash,
      })
      .strict(),
  })
  .strict();
const envelopeSchema = z
  .object({ record: recordSchema, signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) })
  .strict();
const MAX_WINDOW = 21600000;
const REQUIRED_TABLES = [
  "app_migrations",
  "articles",
  "cms_content_revisions",
  "blog_categories",
  "blog_settings",
  "blog_featured_articles",
  "blog_legacy_category_map",
  "media_assets",
  "media_upload_intents",
].map((n) => "public." + n);
const fail = (condition: boolean, code: string) => {
  if (!condition) throw new Error("RECOVERY_" + code);
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const unique = (values: string[]) => new Set(values).size === values.length;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Pure offline verification. The context/public key must be reviewed independently of the submitted evidence. */
export function createRecoveryReceipt(
  untrustedEvidence: unknown,
  trustedContext: unknown,
  artifacts: ReadonlyMap<string, Uint8Array>,
  now = Date.now(),
) {
  fail(Number.isSafeInteger(now) && now > 0, "CLOCK");
  const parsedContext = contextSchema.safeParse(trustedContext);
  const parsedEvidence = envelopeSchema.safeParse(untrustedEvidence);
  fail(parsedContext.success && parsedEvidence.success, "SCHEMA");
  if (!parsedContext.success || !parsedEvidence.success) throw new Error("RECOVERY_SCHEMA");
  const c = parsedContext.data,
    e = parsedEvidence.data,
    r = e.record;
  // Never authenticate a normalized/rebuilt representation in place of the signed input.
  fail(same(c, trustedContext) && same(e, untrustedEvidence), "NONCANONICAL");
  const originalRecord = (untrustedEvidence as { record: unknown }).record;
  fail(r.contextSha256 === fingerprint(c), "CONTEXT_BINDING");
  try {
    fail(c.evidencePublicKey.startsWith("-----BEGIN PUBLIC KEY-----"), "AUTHORITY");
    const publicKey = createPublicKey(c.evidencePublicKey);
    const signature = Buffer.from(e.signature, "base64");
    fail(
      publicKey.asymmetricKeyType === "ed25519" &&
        signature.toString("base64") === e.signature &&
        verify(null, Buffer.from(canonical(originalRecord)), publicKey, signature),
      "SIGNATURE",
    );
  } catch {
    throw new Error("RECOVERY_SIGNATURE");
  }
  for (const w of [c, r])
    fail(
      w.startsAt <= now && now < w.expiresAt && w.expiresAt - w.startsAt <= MAX_WINDOW,
      "WINDOW",
    );
  fail(r.startsAt >= c.startsAt && r.expiresAt <= c.expiresAt, "WINDOW");
  const { snapshot: s, restore: d, database: db, media: m, cleanup } = r;
  const observed = [
    r.fence.drainedAt,
    s.createdAt,
    s.readyAt,
    d.createdAt,
    d.readyAt,
    db.capturedAt,
    m.inventoriedAt,
    m.restore.completedAt,
    cleanup.completedAt,
  ];
  fail(
    observed.every((t) => t >= r.startsAt && t <= now),
    "OBSERVATION_WINDOW",
  );
  fail(
    r.fence.drainedAt <= s.createdAt &&
      s.createdAt <= s.readyAt &&
      s.readyAt <= d.createdAt &&
      d.createdAt <= d.readyAt &&
      d.readyAt <= db.capturedAt &&
      db.capturedAt <= cleanup.completedAt,
    "DB_SEQUENCE",
  );
  fail(
    s.historyStartAt <= s.createdAt &&
      s.createdAt <= s.historyEndAt &&
      s.historyEndAt <= s.readyAt &&
      s.historyEndAt - s.historyStartAt <= MAX_WINDOW &&
      s.retainUntil > now,
    "SNAPSHOT_WINDOW",
  );
  fail(
    s.name === c.snapshotName &&
      s.id === c.snapshotId &&
      d.snapshotId === c.snapshotId &&
      d.name === c.restoreBranchName,
    "SNAPSHOT_BINDING",
  );
  fail(
    same(d.target, c.restoredTarget) &&
      same(cleanup.target, c.cleanupIdentity.target) &&
      same(c.cleanupIdentity.target, c.restoredTarget) &&
      same(cleanup.destination, c.cleanupIdentity.destination) &&
      same(c.cleanupIdentity.destination, c.destination) &&
      same(cleanup.deletedKeys, c.cleanupIdentity.deletedKeys),
    "APPROVED_IDENTITIES",
  );
  const validHost = (t: z.infer<typeof target>) =>
    t.host.startsWith(t.endpointId + ".") && t.host.endsWith(".neon.tech");
  fail(
    validHost(c.target) &&
      validHost(d.target) &&
      Math.floor(c.target.serverVersion / 10000) === 18 &&
      d.target.serverVersion === c.target.serverVersion &&
      d.target.projectId === c.target.projectId &&
      d.target.database === c.target.database &&
      d.target.branchId !== c.target.branchId &&
      d.target.endpointId !== c.target.endpointId &&
      d.target.host !== c.target.host &&
      d.isolationLabel === c.isolationLabel,
    "RESTORE_ISOLATION",
  );
  // System identity is recorded exactly for both targets. Physical clones may share it: it is NOT an isolation test.
  fail(
    unique(c.tableNames) &&
      REQUIRED_TABLES.every((n) => c.tableNames.includes(n)) &&
      c.tableNames.some((n) => !REQUIRED_TABLES.includes(n)),
    "FULL_CATALOG",
  );
  for (const state of [db.baseline, db.restored]) {
    const names = state.tables.map((t) => t.name);
    fail(unique(names) && same([...names].sort(), [...c.tableNames].sort()), "TABLE_COVERAGE");
  }
  const sortedState = (state: z.infer<typeof databaseState>) => ({
    ...state,
    tables: [...state.tables].sort((a, b) => a.name.localeCompare(b.name)),
  });
  fail(same(sortedState(db.baseline), sortedState(db.restored)), "DATABASE_MISMATCH");
  const rows = (name: string) => db.baseline.tables.find((t) => t.name === "public." + name)!.rows;
  fail(
    db.privacy.articleRows === rows("articles") &&
      db.privacy.revisionRows === rows("cms_content_revisions") &&
      db.privacy.baselineSha256 === db.privacy.restoredSha256,
    "PRIVACY",
  );
  fail(
    r.fence.drainedAt <= m.inventoriedAt &&
      m.inventoriedAt <= s.createdAt &&
      s.readyAt <= m.restore.completedAt &&
      m.restore.completedAt <= cleanup.completedAt,
    "MEDIA_SEQUENCE",
  );
  fail(
    unique(m.objects.map((o) => o.key)) &&
      m.objects.length === c.mediaTarget.count &&
      m.objects.reduce((n, o) => n + o.bytes, 0) === c.mediaTarget.bytes &&
      m.objects.every((o) => o.key.startsWith(c.mediaTarget.prefix)),
    "MEDIA_INVENTORY",
  );
  fail(
    same(m.restore.destination, c.destination) && same(cleanup.destination, c.destination),
    "MEDIA_DESTINATION",
  );
  const dest = c.destination;
  if (dest.strategy === "separate-store") {
    fail(
      dest.storeId !== c.mediaTarget.storeId && dest.host !== c.mediaTarget.host,
      "MEDIA_ISOLATION",
    );
  } else {
    fail(
      dest.storeId === c.mediaTarget.storeId &&
        dest.host === c.mediaTarget.host &&
        dest.prefix.length > 0 &&
        !m.objects.some((o) => o.key.startsWith(dest.prefix)) &&
        (c.mediaTarget.prefix === "" ||
          (!dest.prefix.startsWith(c.mediaTarget.prefix) &&
            !c.mediaTarget.prefix.startsWith(dest.prefix))),
      "MEDIA_ISOLATION",
    );
  }
  const refs = m.uploads.references;
  fail(
    m.uploads.rows === rows("media_upload_intents") &&
      refs.length === m.uploads.rows &&
      unique(refs.map((v) => v.uploadId)) &&
      refs.filter((v) => v.state === "held").length === m.uploads.pending &&
      refs.every(
        (v) =>
          (v.state === "held" || v.objectKey !== null) &&
          (v.objectKey === null || m.objects.some((o) => o.key === v.objectKey)),
      ),
    "UPLOAD_COVERAGE",
  );
  const referenceArchiveHashes = validateReferenceManifest({
    tables: db.baseline.tables,
    artifacts,
    source: c.mediaTarget,
    objects: m.objects,
    excludedReferenceValues: c.excludedReferenceValues,
    manifest: m.referenceManifest,
    uploads: m.uploads,
  });
  const copies = m.restore.objects;
  fail(
    copies.length === m.objects.length &&
      unique(copies.map((o) => o.sourceKey)) &&
      unique(copies.map((o) => o.key)),
    "MEDIA_COPY_COVERAGE",
  );
  for (const original of m.objects) {
    const copy = copies.find((o) => o.sourceKey === original.key);
    fail(
      !!copy &&
        copy.key === dest.prefix + original.key.slice(c.mediaTarget.prefix.length) &&
        copy.sha256 === original.sha256 &&
        copy.bytes === original.bytes &&
        copy.metadataSha256 === original.metadataSha256,
      "MEDIA_COPY",
    );
  }
  fail(
    cleanup.branchId === d.target.branchId &&
      cleanup.approvalSha256 === c.cleanupApprovalSha256 &&
      unique(cleanup.deletedKeys) &&
      same([...cleanup.deletedKeys].sort(), copies.map((o) => o.key).sort()),
    "CLEANUP",
  );
  const archiveHashes = [
    c.approvalSha256,
    c.cleanupApprovalSha256,
    r.fence.receiptSha256,
    s.providerEvidenceSha256,
    d.providerEvidenceSha256,
    d.isolationEvidenceSha256,
    db.catalogSha256,
    db.verificationArchiveSha256,
    m.inventoryArchiveSha256,
    m.uploads.dispositionArchiveSha256,
    m.restore.readbackArchiveSha256,
    m.restore.isolationEvidenceSha256,
    cleanup.evidenceSha256,
    ...referenceArchiveHashes,
    ...m.objects.map((o) => o.sha256),
  ];
  for (const digest of archiveHashes) {
    const bytes = artifacts.get(digest);
    fail(bytes instanceof Uint8Array && sha256(bytes) === digest, "ARTIFACT");
  }
  for (const o of m.objects) fail(artifacts.get(o.sha256)!.byteLength === o.bytes, "MEDIA_BYTES");
  const receipt = {
    format: "blog-recovery-receipt-v2" as const,
    status: "OFFLINE_EVIDENCE_VALIDATED" as const,
    productionAuthorized: false as const,
    closure: "REQUIRES_INDEPENDENT_REVIEW" as const,
    issuedAt: now,
    expiresAt: Math.min(c.expiresAt, r.expiresAt, s.retainUntil),
    packetSha256: c.packetSha256,
    releaseHead: c.releaseHead,
    target: c.target,
    contextSha256: fingerprint(c),
    evidenceSha256: fingerprint(e),
    artifactHashes: [...new Set(archiveHashes)].sort(),
  };
  return { record: receipt, sha256: fingerprint(receipt) };
}

/** A receipt is a checksum-sealed offline result, not a signature or a production-executor capability. */
export function verifyRecoveryReceipt(
  untrustedReceipt: unknown,
  evidence: unknown,
  context: unknown,
  artifacts: ReadonlyMap<string, Uint8Array>,
  now = Date.now(),
) {
  const current = createRecoveryReceipt(evidence, context, artifacts, now);
  const parsed = z
    .object({ record: z.object({ issuedAt: time }).passthrough(), sha256: hash })
    .strict()
    .safeParse(untrustedReceipt);
  fail(parsed.success, "RECEIPT");
  if (!parsed.success) throw new Error("RECOVERY_RECEIPT");
  fail(parsed.data.record.issuedAt <= now, "RECEIPT_WINDOW");
  const expected = createRecoveryReceipt(evidence, context, artifacts, parsed.data.record.issuedAt);
  fail(current.record.expiresAt > now && same(expected, untrustedReceipt), "RECEIPT");
}
