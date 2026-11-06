import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function digest(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return sha256(JSON.stringify(stable(value)));
}
const text = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => v === v.trim() && !Array.from(v).some((c) => c.charCodeAt(0) < 32));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const instant = z.string().datetime();
const host = z.string().regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/);
const actor = z
  .object({
    userId: text,
    staffId: uuid,
    sessionSha256: hash,
    browserStateSha256: hash,
    expiresAt: instant,
  })
  .strict();
export const roles = ["admin", "manager", "agent"] as const;
export type Role = (typeof roles)[number];
const targetSchema = z
  .object({
    environment: z.literal("isolated-hosted"),
    origin: text,
    projectId: z.string().regex(/^prj_[A-Za-z0-9]+$/),
    teamId: z.string().regex(/^team_[A-Za-z0-9]+$/),
    deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]+$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    neon: z
      .object({
        projectId: text,
        branchId: text,
        endpointId: text,
        host,
        database: text,
        role: text,
      })
      .strict(),
    auth: z.object({ origin: text, baseUrl: text, projectId: text, branchId: text }).strict(),
    blob: z.object({ storeId: z.string().regex(/^[a-z0-9]+$/), host }).strict(),
  })
  .strict();
export const inputSchema = z
  .object({
    format: z.literal("blog-hosted-acceptance-v1"),
    runId: uuid,
    target: targetSchema,
    // This complete inventory must be supplied by the owner; absence is not a safe default.
    production: z
      .object({
        domains: z.array(host).min(2),
        projectIds: z.array(text).min(1),
        neonProjectIds: z.array(text).min(1),
        branchIds: z.array(text).min(1),
        endpointIds: z.array(text).min(1),
        dbHosts: z.array(host).min(1),
        databases: z.array(text).min(1),
        authHosts: z.array(host).min(1),
        blobHosts: z.array(host).min(1),
        blobStoreIds: z.array(text).min(1),
      })
      .strict(),
    actors: z
      .object({ admin: actor, manager: actor, agent: actor, anonymous: z.literal("no-session") })
      .strict(),
    // Receipt is collected independently from the immutable deployment configuration, not from .env.
    binding: z
      .object({
        target: targetSchema,
        source: z.literal("owner-verified-immutable-deployment-config"),
        evidenceId: text,
        verifiedBy: text,
        verifiedAt: instant,
        expiresAt: instant,
        fixtureAuth: z.literal(false),
        fixtureDatabase: z.literal(false),
        writerFenceId: text,
        backgroundJobs: z.literal("disabled-by-owner"),
        knowledgeInvalidation: z.literal("disabled-by-owner"),
      })
      .strict(),
    checklistSha256: hash,
    articles: z
      .array(
        z
          .object({
            id: uuid,
            slug: text,
            inputSha256: hash,
            title: text,
            bodyText: text,
            seoTitle: text,
            seoDescription: text,
          })
          .strict(),
      )
      .length(112),
    categoryIds: z.array(uuid).length(7),
    settingsIds: z.array(uuid).length(8),
    functions: z
      .object({
        listServer: hash,
        previewServer: hash,
        saveServer: hash,
        stateServer: hash,
        settingsServer: hash,
        categoryServer: hash,
        pageServer: hash,
        articleServer: hash,
      })
      .strict(),
    media: z.object({ uploadId: uuid, pathname: text, url: text, imageSha256: hash }).strict(),
    recovery: z
      .object({
        id: text,
        table: z.literal("articles"),
        offlineTable: z.string().regex(/^task7_offline_[a-f0-9]{32}$/),
        maxDurationMs: z.number().int().min(5000).max(60000),
      })
      .strict(),
    cleanup: z
      .object({
        id: text,
        mode: z.literal("restore-exact-blog-rows-and-delete-exact-upload"),
        articleIds: z.array(uuid).length(112),
        categoryIds: z.array(uuid).length(7),
        settingsIds: z.array(uuid).length(8),
        uploadId: uuid,
        blobUrl: text,
      })
      .strict(),
  })
  .strict();
export type HostedInput = z.infer<typeof inputSchema>;
export const approvalSchema = z
  .object({
    status: z.literal("APPROVED_ISOLATED_EXECUTION"),
    id: text,
    approver: text,
    inputSha256: hash,
    runnerCommit: z.string().regex(/^[a-f0-9]{40}$/),
    issuedAt: instant,
    expiresAt: instant,
    cleanupUntil: instant,
    actions: z.tuple([
      z.literal("read-provider-bindings"),
      z.literal("read-112-urls"),
      z.literal("cms-test-writes"),
      z.literal("test-image-upload"),
      z.literal("browser-a11y"),
      z.literal("bounded-read-outage"),
      z.literal("exact-cleanup"),
    ]),
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;
export const checklistBytes = readFileSync(
  new URL("../../docs/superpowers/evidence/blog-cms/release-url-checklist.json", import.meta.url),
);
export const checklist = JSON.parse(checklistBytes.toString()) as {
  articles: { path: string; slug: string; expectedStatus: number }[];
  pages: string[];
};
export const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQyVgAAAHgAS3LPK2uAAAAAElFTkSuQmCC",
  "base64",
);
export function sameSet(actual: string[], expected: string[], label: string) {
  assert.equal(new Set(actual).size, actual.length, label + ": duplicates");
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}
export class HostedRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const refuseProduction = (value: string, forbidden: string[], code: string) => {
  if (forbidden.some((v) => v.toLowerCase() === value.toLowerCase())) throw new HostedRefusal(code);
};
function safeOrigin(value: string, suffix: string) {
  const u = new URL(value);
  assert.equal(u.origin, value, "origin must be exact HTTPS origin without path/credentials/port");
  assert.equal(u.protocol, "https:");
  assert.equal(u.port, "");
  assert.ok(
    u.hostname.endsWith(suffix) && u.hostname !== suffix.slice(1),
    "provider hostname required",
  );
  assert.ok(
    !/(localhost|127\.|\.local\b|\.invalid\b|fixture|synthetic|mock|earnestproperty)/i.test(
      u.hostname,
    ),
    "not hosted isolation",
  );
  return u.hostname;
}
export function validateInput(raw: unknown, now = Date.now()): HostedInput {
  const p = inputSchema.parse(raw),
    t = p.target,
    deny = p.production;
  assert.ok(Number.isFinite(now));
  const parsedAppHost = new URL(t.origin).hostname;
  if (
    /(^|\.)earnestproperty\.com$/.test(parsedAppHost) ||
    /earnestproperty.*\.vercel\.app$/.test(parsedAppHost) ||
    deny.domains.some((d) => parsedAppHost === d || parsedAppHost.endsWith("." + d))
  )
    throw new HostedRefusal("PRODUCTION_DOMAIN");
  refuseProduction(
    t.projectId,
    [...deny.projectIds, "prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5"],
    "PRODUCTION_PROJECT",
  );
  refuseProduction(
    t.neon.projectId,
    [...deny.neonProjectIds, "dawn-meadow-79190048"],
    "PRODUCTION_NEON_PROJECT",
  );
  refuseProduction(
    t.neon.branchId,
    [...deny.branchIds, "br-polished-sea-aom4i1ct"],
    "PRODUCTION_NEON_BRANCH",
  );
  refuseProduction(t.neon.endpointId, deny.endpointIds, "PRODUCTION_DB_ENDPOINT");
  refuseProduction(t.neon.host, deny.dbHosts, "PRODUCTION_DB_HOST");
  refuseProduction(t.neon.database, [...deny.databases, "neondb"], "PRODUCTION_DATABASE");
  refuseProduction(t.blob.host, deny.blobHosts, "PRODUCTION_BLOB_HOST");
  refuseProduction(t.blob.storeId, deny.blobStoreIds, "PRODUCTION_BLOB_STORE");
  refuseProduction(new URL(t.auth.origin).hostname, deny.authHosts, "PRODUCTION_AUTH_HOST");
  for (const value of [
    t.projectId,
    t.neon.projectId,
    t.neon.branchId,
    t.neon.endpointId,
    t.neon.host,
    t.neon.database,
    t.blob.host,
    t.blob.storeId,
  ]) {
    if (/(\{\{|\bproduction\b|fixture|synthetic|mock|localhost|owned:)/i.test(value))
      throw new HostedRefusal("PLACEHOLDER_OR_LOCAL_TARGET");
  }
  safeOrigin(t.origin, ".vercel.app");
  safeOrigin(t.auth.origin, ".neon.tech");
  const authBase = new URL(t.auth.baseUrl);
  assert.equal(authBase.origin, t.auth.origin);
  assert.equal(authBase.username + authBase.password + authBase.search + authBase.hash, "");
  assert.equal(authBase.href, t.auth.baseUrl);
  assert.equal(
    authBase.pathname,
    `/${t.neon.database}/auth`,
    "exact isolated Neon Auth database path required",
  );
  assert.match(t.neon.host, /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/);
  assert.ok(
    t.neon.host.startsWith(t.neon.endpointId + "."),
    "direct endpoint required, no pooler alias",
  );
  assert.equal(t.blob.host, `${t.blob.storeId}.public.blob.vercel-storage.com`);
  assert.equal(t.auth.projectId, t.neon.projectId);
  assert.equal(t.auth.branchId, t.neon.branchId);
  assert.equal(digest(p.binding.target), digest(t), "deployment resource binding mismatch");
  assert.ok(
    Date.parse(p.binding.verifiedAt) <= now && now < Date.parse(p.binding.expiresAt),
    "binding expired/future",
  );
  assert.equal(p.checklistSha256, sha256(checklistBytes), "checklist drift");
  sameSet(
    p.articles.map((a) => a.slug),
    checklist.articles.map((a) => a.slug),
    "112 exact slugs",
  );
  sameSet(
    p.cleanup.articleIds,
    p.articles.map((a) => a.id),
    "article cleanup IDs",
  );
  sameSet(p.cleanup.categoryIds, p.categoryIds, "category cleanup IDs");
  sameSet(p.cleanup.settingsIds, p.settingsIds, "settings cleanup IDs");
  assert.equal(new Set(roles.map((r) => p.actors[r].userId)).size, 3, "distinct users");
  assert.equal(new Set(roles.map((r) => p.actors[r].staffId)).size, 3, "distinct staff");
  assert.equal(new Set(roles.map((r) => p.actors[r].sessionSha256)).size, 3, "distinct sessions");
  assert.equal(new Set(Object.values(p.functions)).size, 8, "distinct built function IDs");
  for (const role of roles)
    assert.ok(now < Date.parse(p.actors[role].expiresAt), "session expired");
  assert.equal(p.media.pathname, `article/${p.actors.admin.staffId}/${p.media.uploadId}`);
  assert.equal(p.media.url, `https://${t.blob.host}/${p.media.pathname}`);
  assert.equal(p.media.imageSha256, sha256(imageBytes));
  assert.equal(p.cleanup.uploadId, p.media.uploadId);
  assert.equal(p.cleanup.blobUrl, p.media.url);
  assert.equal(
    p.recovery.offlineTable,
    "task7_offline_" + p.runId.replaceAll("-", ""),
    "RECOVERY_TABLE_BINDING",
  );
  return p;
}
export function validateApproval(
  p: HostedInput,
  raw: unknown,
  runnerCommit: string,
  now = Date.now(),
  cleanup = false,
) {
  const a = approvalSchema.parse(raw);
  assert.equal(a.inputSha256, digest(p), "approval input binding");
  assert.equal(a.runnerCommit, runnerCommit, "runner commit binding");
  assert.equal(p.target.commit, runnerCommit, "deployment commit binding");
  assert.ok(
    Date.parse(a.issuedAt) <= now && Date.parse(a.issuedAt) < Date.parse(a.expiresAt),
    "approval not active",
  );
  assert.ok(
    Date.parse(a.expiresAt) < Date.parse(a.cleanupUntil),
    "separate cleanup lease required",
  );
  assert.ok(now < Date.parse(cleanup ? a.cleanupUntil : a.expiresAt), "approval expired");
  return a;
}
export function validateSecrets(p: HostedInput, env: NodeJS.ProcessEnv) {
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "BLOB_READ_WRITE_TOKEN",
    "PLAYWRIGHT_BASE_URL",
    "A11Y_STORAGE_STATE",
    "BLOG_ACCEPTANCE_BRIDGE",
    "NODE_OPTIONS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_EXTRA_CA_CERTS",
    "BUN_OPTIONS",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGOPTIONS",
    "PGSSLMODE",
    "NEON_AUTH_BASE_URL",
    "VITE_NEON_AUTH_URL",
    "VERCEL_BLOB_API_URL",
    "VERCEL_BLOB_API_VERSION_OVERRIDE",
  ])
    assert.ok(!env[key], "ambient execution override refused: " + key);
  const database = new URL(env.HOSTED_DATABASE_URL ?? "");
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, p.target.neon.host);
  assert.ok(database.port === "" || database.port === "5432");
  assert.equal(decodeURIComponent(database.pathname.slice(1)), p.target.neon.database);
  assert.equal(decodeURIComponent(database.username), p.target.neon.role);
  assert.ok(database.password, "database password required");
  assert.equal(database.searchParams.get("sslmode"), "verify-full");
  assert.deepEqual([...database.searchParams.keys()], ["sslmode"]);
  const blobToken = env.HOSTED_BLOB_TOKEN ?? "";
  assert.match(blobToken, /^vercel_blob_rw_[a-z0-9]+_/);
  assert.equal(blobToken.split("_")[3], p.target.blob.storeId);
  for (const role of roles) {
    const token = env[`HOSTED_${role.toUpperCase()}_SESSION`] ?? "";
    assert.ok(token && !/[\r\n]/.test(token) && !/^task[0-9]+-|fixture|synthetic/i.test(token));
    assert.equal(sha256(token), p.actors[role].sessionSha256, "session fingerprint binding");
  }
  assert.ok(
    env.HOSTED_VERCEL_READ_TOKEN && env.HOSTED_NEON_READ_TOKEN,
    "provider read credentials required",
  );
}
export function validateTriggerInventory(
  rows: { table_name: string; name: string; enabled: string }[],
) {
  const expected = [
    { table_name: "articles", name: "blog_article_contract_guard", enabled: "O" },
    { table_name: "articles", name: "ep_knowledge_articles", enabled: "D" },
    { table_name: "blog_categories", name: "blog_category_key_guard", enabled: "O" },
    { table_name: "cms_content_revisions", name: "blog_project_article_revision", enabled: "O" },
    { table_name: "cms_content_revisions", name: "cms_revision_immutable", enabled: "O" },
  ];
  assert.equal(
    digest([...rows].sort((a, b) => digest(a).localeCompare(digest(b)))),
    digest(expected.sort((a, b) => digest(a).localeCompare(digest(b)))),
    "unapproved trigger side effects or disabled integrity guard",
  );
}
export const requiredChecks = [
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
] as const;
export type Receipt = {
  layer: "hosted" | "local-seam";
  inputSha256: string;
  deploymentId: string;
  commit: string;
  checks: string[];
  cleanup: { id: string; restored: boolean; uploadId: string; blobUrl: string; absent: boolean };
};
export function acceptReceipt(p: HostedInput, r: Receipt) {
  assert.equal(r.layer, "hosted", "local/fixture success is not hosted acceptance");
  assert.equal(r.inputSha256, digest(p));
  assert.equal(r.deploymentId, p.target.deploymentId);
  assert.equal(r.commit, p.target.commit);
  sameSet(r.checks, [...requiredChecks], "complete results required");
  assert.deepEqual(r.cleanup, {
    id: p.cleanup.id,
    restored: true,
    uploadId: p.media.uploadId,
    blobUrl: p.media.url,
    absent: true,
  });
}
