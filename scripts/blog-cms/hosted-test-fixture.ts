// Pure test data. These are invented identities, never authorization or hosted evidence.
import {
  checklist,
  checklistBytes,
  digest,
  imageBytes,
  sha256,
  type Approval,
  type HostedInput,
  type Receipt,
} from "./hosted-contract";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function fixture(now = Date.now()): HostedInput {
  const target: HostedInput["target"] = {
    environment: "isolated-hosted",
    origin: "https://blog-acceptance-abc123-owner.vercel.app",
    projectId: "prj_isolated123",
    teamId: "team_isolated123",
    deploymentId: "dpl_isolated123",
    commit: "a".repeat(40),
    neon: {
      projectId: "acceptance-project-123",
      branchId: "br-isolated-123",
      endpointId: "ep-isolated-123",
      host: "ep-isolated-123.ap-southeast-1.aws.neon.tech",
      database: "blog_acceptance",
      role: "acceptance_owner",
    },
    auth: {
      origin: "https://isolated-auth.neon.tech",
      baseUrl: "https://isolated-auth.neon.tech/blog_acceptance/auth",
      projectId: "acceptance-project-123",
      branchId: "br-isolated-123",
    },
    blob: { storeId: "isolated123", host: "isolated123.public.blob.vercel-storage.com" },
  };
  const actors = Object.fromEntries(
    ["admin", "manager", "agent"].map((r, n) => [
      r,
      {
        userId: "user-" + r,
        staffId: id(201 + n),
        sessionSha256: sha256("secret-" + r),
        browserStateSha256: sha256(r),
        expiresAt: new Date(now + 3600000).toISOString(),
      },
    ]),
  ) as Omit<HostedInput["actors"], "anonymous">;
  const articles = checklist.articles.map((a, n) => ({
    id: id(n + 1),
    slug: a.slug,
    inputSha256: sha256(a.slug),
    title: a.slug,
    bodyText: "Approved article body",
    seoTitle: "SEO",
    seoDescription: "Description",
  }));
  const categoryIds = Array.from({ length: 7 }, (_, n) => id(301 + n));
  const settingsIds = Array.from({ length: 8 }, (_, n) => id(401 + n));
  const media = {
    uploadId: id(501),
    pathname: `article/${actors.admin.staffId}/${id(501)}`,
    url: "",
    imageSha256: sha256(imageBytes),
  };
  media.url = `https://${target.blob.host}/${media.pathname}`;
  return {
    format: "blog-hosted-acceptance-v1",
    runId: id(600),
    target,
    production: {
      domains: ["earnestproperty.com", "www.earnestproperty.com"],
      projectIds: ["prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5"],
      neonProjectIds: ["dawn-meadow-79190048"],
      branchIds: ["br-polished-sea-aom4i1ct"],
      endpointIds: ["ep-denied"],
      dbHosts: ["ep-denied.ap-southeast-1.aws.neon.tech"],
      databases: ["neondb"],
      authHosts: ["denied.neon.tech"],
      blobHosts: ["denied.public.blob.vercel-storage.com"],
      blobStoreIds: ["denied"],
    },
    actors: { ...actors, anonymous: "no-session" },
    binding: {
      target: structuredClone(target),
      source: "owner-verified-immutable-deployment-config",
      evidenceId: "independent-config-receipt",
      verifiedBy: "Owner",
      verifiedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(),
      fixtureAuth: false,
      fixtureDatabase: false,
      writerFenceId: "exclusive-test-writers",
      backgroundJobs: "disabled-by-owner",
      knowledgeInvalidation: "disabled-by-owner",
    },
    checklistSha256: sha256(checklistBytes),
    articles,
    categoryIds,
    settingsIds,
    functions: Object.fromEntries(
      [
        "listServer",
        "previewServer",
        "saveServer",
        "stateServer",
        "settingsServer",
        "categoryServer",
        "pageServer",
        "articleServer",
      ].map((n) => [n, sha256(n)]),
    ) as HostedInput["functions"],
    media,
    recovery: {
      id: "bounded-read-outage",
      table: "articles",
      offlineTable: "task7_offline_" + id(600).replaceAll("-", ""),
      maxDurationMs: 60000,
    },
    cleanup: {
      id: "cleanup-exact-run",
      mode: "restore-exact-blog-rows-and-delete-exact-upload",
      articleIds: articles.map((a) => a.id),
      categoryIds: [...categoryIds],
      settingsIds: [...settingsIds],
      uploadId: media.uploadId,
      blobUrl: media.url,
    },
  };
}
export function approved(p: HostedInput, now = Date.now()): Approval {
  return {
    status: "APPROVED_ISOLATED_EXECUTION",
    id: "pure-test-only",
    approver: "Test",
    inputSha256: digest(p),
    runnerCommit: p.target.commit,
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 1800000).toISOString(),
    cleanupUntil: new Date(now + 3600000).toISOString(),
    actions: [
      "read-provider-bindings",
      "read-112-urls",
      "cms-test-writes",
      "test-image-upload",
      "browser-a11y",
      "bounded-read-outage",
      "exact-cleanup",
    ],
  };
}
export function receipt(p: HostedInput): Receipt {
  return {
    layer: "hosted",
    inputSha256: digest(p),
    deploymentId: p.target.deploymentId,
    commit: p.target.commit,
    checks: [
      "identity",
      "urls-112",
      "cms-112",
      "settings-8",
      "categories-7",
      "roles",
      "publication",
      "retry",
      "media",
      "a11y",
    ],
    cleanup: {
      id: p.cleanup.id,
      restored: true,
      uploadId: p.media.uploadId,
      blobUrl: p.media.url,
      absent: true,
    },
  };
}
