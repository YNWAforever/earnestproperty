import { z } from "zod";

// Trusted review baseline, not loaded from the submitted register or caller options.
// Changing this active generation requires code review of the evidence bytes/capture
// provenance and validity window. Revision 02 fixes the packet, NOT its freshness.
const reviewedProposal = {
  generation: "blog-cms-writer-proposal-20261106-02",
  observedAt: "2026-11-06T20:40:47.6592322+08:00",
  expiresAt: "2026-11-07T12:40:47Z",
  observations: [
    {
      path: "writer-read-only-observations.json",
      capturedAt: "2026-11-06T20:40:47.6592322+08:00",
      sha256: "d8b4cd2f2cf9832c3bfac4aff65372156b7978789d7eba0324d528655fbcead7",
    },
    {
      path: "release-provider-metadata.json",
      capturedAt: "2026-11-05T12:48:55.205Z",
      sha256: "f1081ba76f6b850eaf0dd5d1fa8555276f5a7b7344c2a78ba1bdc32b17ce616b",
    },
    {
      path: "recovery-blob-metadata.json",
      capturedAt: null, // No capture timestamp in the evidence; never fabricate freshness.
      sha256: "74dbe44a20bfead1a9e6e35a5430ffb86cf1deba1564fc81aa9429af7f1d8a98",
    },
  ],
} as const;

// Reviewed coverage is independent of the submitted register. Newly discovered resources
// require a reviewed catalog revision, not an extra self-declared "covered" row.
const resourcesByWriter: Readonly<Record<string, readonly string[]>> = {
  "vercel-current": ["earnestproperty-iatgxp51a-ynwaforevers-projects.vercel.app"],
  "vercel-alias-1": ["www.earnestproperty.com"],
  "vercel-alias-2": ["earnestproperty.vercel.app"],
  "vercel-alias-3": ["earnestproperty.com"],
  "vercel-alias-4": ["earnestproperty-ynwaforevers-projects.vercel.app"],
  "vercel-alias-5": ["earnestproperty-git-main-ynwaforevers-projects.vercel.app"],
  "vercel-other": ["prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5"],
  "github-owner": [".github/workflows/property-sync-daily.yml#owner-publish"],
  "github-pipeline": [
    ".github/workflows/property-sync-daily.yml#preflight,collect,ingest,publish,verify",
  ],
  "github-record": [".github/workflows/property-sync-daily.yml#record"],
  "github-migration-drift": [".github/workflows/migration-drift.yml"],
  "github-watchdog": [".github/workflows/property-sync-watchdog.yml"],
  "github-price-status": [".github/workflows/property-price-status-sync.yml"],
  "github-ci": [".github/workflows/ci.yml"],
  "github-acceptance": [".github/workflows/property-sync-acceptance.yml"],
  "github-dispatch": ["YNWAforever/earnestproperty"],
  "cloudflare-cron": ["earnestproperty-cron"],
  "cloudflare-wake-consumers": ["JOB_WAKE:service", "JOB_WAKE:general"],
  "cloudflare-mls": ["earnest-mls-container", "earnest-mls-runner"],
  "db-owner": ["neondb_owner"],
  "db-runtime": ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "IMPORT_DATABASE_URL"],
  "db-privileged": ["cloud_admin", "neon_service"],
  "db-other-roles": ["neon_auth", "migration_monitor"],
  "db-sessions": ["neondb"],
  "direct-tools": [
    "scripts/neon/apply-migrations.mjs",
    "scripts/blog-cms/production-executor.ts",
    "scripts/mls/owner-publication.mjs",
  ],
  "provider-consoles": [
    "Neon:dawn-meadow-79190048",
    "Vercel:prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5",
    "GitHub:YNWAforever/earnestproperty",
    "Cloudflare:e387dfbeded3deb5b8f0023a78a660b5",
  ],
  "cms-generic": ["cms_mutate:save,publish,restore,archive"],
  "cms-copilot": ["content-copilot:proposals,drafts,publish,audit"],
  "blog-articles": ["blog_save_article", "blog_project_article_revision"],
  "blog-settings-features": ["blog_save_settings", "blog_prune_features"],
  "blog-categories": ["blog_save_category"],
  "staff-access": ["staff_users", "staff_roles", "neon_auth.session"],
  "blob-upload": ["/api/admin/media/upload"],
  "blob-finalization": ["media_upload_intents", "media_assets"],
  "blob-variants": ["scripts/media/backfill-remote-variants.mjs", "media_variant_sets"],
  "blob-delete-console": ["store_sEHe3hQ90qGByxQA"],
};

const text = z.string().trim().min(1).max(2048);
const list = z.array(text).min(1).max(100);
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const writerSchema = z
  .object({
    id: text,
    owner: z.literal("Willy"),
    resources: list,
    sources: list,
    preState: z
      .object({
        status: z.literal("partial"),
        basis: z.literal("repository-and-captured-provider"),
        facts: list,
        gaps: list,
      })
      .strict(),
    control: z.object({ status: z.literal("proposed"), steps: list }).strict(),
    proofSteps: list,
    drainCriteria: list,
    retainedEvidence: list,
    reopenSteps: list,
  })
  .strict();

// This version models a blocked proposal only. It deliberately cannot be promoted to
// an active fence by filling in approval/proof booleans or an owner's name.
const schema = z
  .object({
    format: z.literal("earnest-writer-control-proposal-v1"),
    state: z.literal("BLOCKED_NOT_ACTIVATED"),
    owner: z.literal("Willy"),
    sourceHead: z.literal("52fe2f456d993fd3b0b715d846c45322a5e04526"),
    generation: z.string().regex(/^blog-cms-writer-proposal-[0-9]{8}-[0-9]{2,}$/),
    observedAt: timestamp,
    expiresAt: timestamp,
    target: z
      .object({
        vercelProject: z.literal("prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5"),
        vercelTeam: z.literal("team_qvzlsFmfCsLkgItSypqHjw3z"),
        githubRepository: z.literal("YNWAforever/earnestproperty"),
        neonProject: z.literal("dawn-meadow-79190048"),
        neonBranch: z.literal("br-polished-sea-aom4i1ct"),
        database: z.literal("neondb"),
        blobStore: z.literal("store_sEHe3hQ90qGByxQA"),
      })
      .strict(),
    activationApproval: z.null(),
    acceptanceAccess: z
      .object({
        action: z.literal("ADMIT-ACCEPTANCE-ONLY"),
        status: z.literal("BLOCKED_SEPARATE_APPROVAL_REQUIRED"),
        before: z.literal("REOPEN-WRITERS"),
        maxDurationMinutes: z.literal(30),
        generalWritersEnabled: z.literal(false),
        inspectedDeploymentId: z.literal("dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5"),
        releaseDeploymentId: z.null(),
        proposedActors: z
          .array(
            z
              .object({
                name: z.literal("Willy"),
                staffId: z.null(),
                authUserId: z.null(),
                sourceIp: z.null(),
              })
              .strict(),
          )
          .length(1),
        approval: z.null(),
        permittedOperations: list,
        preservedExclusions: list,
        auditEvidence: list,
        closeConditions: list,
      })
      .strict(),
    reopenApproval: z.null(),
    inventoryComplete: z.literal(false),
    observations: z
      .array(
        z
          .object({
            path: z.enum([
              "writer-read-only-observations.json",
              "release-provider-metadata.json",
              "recovery-blob-metadata.json",
            ]),
            sha256: digest,
            capturedAt: timestamp.nullable(),
          })
          .strict(),
      )
      .length(3),
    writerVariables: z
      .object({
        IMPORT_BLOB_TARGET_ENV: z.literal("production"),
        IMPORT_TARGET_ENV: z.literal("production"),
        OWNER_PUBLICATION_DAILY_ENABLED: z.literal("true"),
        OWNER_PUBLICATION_MANUAL_APPLY_ENABLED: z.literal("true"),
        PROPERTY_SYNC_DAILY_ENABLED: z.literal("true"),
        PROPERTY_SYNC_EXPECTED_BRANCH: z.literal("main"),
        PROPERTY_SYNC_OBSERVABILITY_ENABLED: z.literal("true"),
      })
      .strict(),
    writers: z.array(writerSchema).min(1).max(200),
  })
  .strict();

/** Pure, offline proposal validation. No I/O, credentials, signing or execution capability.
 * A valid proposal is NOT complete inventory, verified proof or authorization. Expiry stops
 * further use of this proposal; it never releases external controls or reopens traffic.
 */
export function assessWriterControlRegister(input: unknown, now: number) {
  const errors: string[] = [];
  const blockers = [
    "ACTIVATION_APPROVAL_MISSING",
    "LIVE_FENCE_UNPROVEN",
    "ACCEPTANCE_ACCESS_REQUIRES_SEPARATE_APPROVAL",
    "INVENTORY_INCOMPLETE",
    "REOPEN_REQUIRES_SEPARATE_APPROVAL",
  ];
  const parsed = schema.safeParse(input);
  if (!parsed.success) errors.push("INVALID_REGISTER");
  else {
    const register = parsed.data;
    if (register.generation !== reviewedProposal.generation) errors.push("UNREVIEWED_GENERATION");
    if (
      register.observedAt !== reviewedProposal.observedAt ||
      register.expiresAt !== reviewedProposal.expiresAt
    )
      errors.push("UNREVIEWED_WINDOW");
    for (const expected of reviewedProposal.observations) {
      const observation = register.observations.find((item) => item.path === expected.path);
      if (
        !observation ||
        observation.sha256 !== expected.sha256 ||
        observation.capturedAt !== expected.capturedAt
      )
        errors.push("UNREVIEWED_EVIDENCE");
    }
    const start = Date.parse(register.observedAt);
    const expiry = Date.parse(register.expiresAt);
    if (
      !Number.isSafeInteger(now) ||
      start > now ||
      now >= expiry ||
      expiry <= start ||
      expiry - start > 86_400_000
    )
      errors.push("REGISTER_WINDOW");
    const seen = new Set<string>();
    for (const writer of register.writers) {
      if (seen.has(writer.id)) errors.push("DUPLICATE_WRITER");
      seen.add(writer.id);
      if (!Object.hasOwn(resourcesByWriter, writer.id)) {
        errors.push("UNKNOWN_WRITER");
        continue;
      }
      const expected = resourcesByWriter[writer.id];
      if (
        writer.resources.length !== expected.length ||
        new Set(writer.resources).size !== expected.length ||
        expected.some((resource) => !writer.resources.includes(resource))
      )
        errors.push("WRITER_RESOURCE_MISMATCH");
    }
    for (const id of Object.keys(resourcesByWriter)) {
      if (!seen.has(id)) errors.push("MISSING_WRITER");
    }
    if (new Set(register.observations.map((observation) => observation.path)).size !== 3)
      errors.push("OBSERVATION_COVERAGE");
  }
  return {
    validProposal: errors.length === 0,
    productionAuthorized: false as const,
    errors: [...new Set(errors)],
    blockers: errors.length ? ["INVALID_PROPOSAL", ...blockers] : blockers,
  };
}
