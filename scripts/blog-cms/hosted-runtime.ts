import {
  reconcileMutationRequests,
  type MutationIntent,
  type MutationRow,
} from "./hosted-mutation-cleanup";
import { encodeArticle } from "../../src/lib/blog/article-codec";
import type { SaveArticleCommand } from "../../src/lib/blog/types";
import { createRecoveryJournal } from "./hosted-journal";
import { withExactCleanup } from "./hosted-lifecycle";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "cheerio";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { unwrapServerFnResponse } from "../../src/lib/neon/server-fn-response";
import { articleInput } from "../../src/components/admin/blog/blog-editor-state";
import {
  acceptReceipt,
  checklist,
  digest,
  imageBytes,
  roles,
  sameSet,
  sha256,
  validateApproval,
  validateInput,
  validateSecrets,
  validateTriggerInventory,
  type Approval,
  type HostedInput,
  type Role,
  type Receipt,
} from "./hosted-contract";
import { readBrowserStates, runHostedBrowser, runHostedRecovery } from "./hosted-browser";
import { runCmsScenario, type HostedIO } from "./hosted-scenario";
import { hostedSessionBindingSql } from "./hosted-session-binding";

type Row = Record<string, unknown>;
type Db = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number }>;
};
const require = createRequire(import.meta.url);
const tables = [
  "articles",
  "blog_categories",
  "blog_settings",
  "blog_featured_articles",
  "cms_content_revisions",
  "audit_logs",
  "blog_mutation_requests",
] as const;
type Snapshot = Record<(typeof tables)[number], Row[]>;

export function checkCache(headers: Headers, privateResponse = false) {
  assert.match(headers.get("cache-control") ?? "", /(?:^|[,\s])no-store(?:$|[,\s])/i);
  if (privateResponse) {
    assert.match(headers.get("cache-control") ?? "", /private/i);
    assert.equal(headers.get("x-robots-tag"), "noindex, nofollow");
  }
  // Apply to public and private success/denial responses alike.
  // Vercel consumes its own CDN directive. Record absence; any returned cacheable value fails.
  for (const key of ["cdn-cache-control", "vercel-cdn-cache-control"])
    if (headers.has(key)) assert.match(headers.get(key)!, /^no-store$/i);
  assert.notEqual(headers.get("x-vercel-cache")?.toUpperCase(), "HIT");
  assert.notEqual(headers.get("x-vercel-cache")?.toUpperCase(), "STALE");
  assert.ok(Number(headers.get("age") ?? 0) === 0);
}

/** No callbacks or fetch overrides are accepted here. Unit seams cannot create hosted receipts. */
export async function executeHosted(
  raw: unknown,
  approval: Approval,
  runnerCommit: string,
  output: string,
  env: NodeJS.ProcessEnv,
) {
  const p = validateInput(raw);
  validateApproval(p, approval, runnerCommit);
  validateSecrets(p, env);
  const states = readBrowserStates(p, env);
  // A new private journal is mandatory before any network access; never overwrite a prior run.
  mkdirSync(output, { recursive: false });
  const checks: string[] = [],
    requestIds: string[] = [];
  const mutationIntents: MutationIntent[] = [];
  let snapshot: Snapshot | undefined,
    cleanupPhase = false,
    cleanupDone = false,
    attemptedWrites = false;
  const recoveryJournal = createRecoveryJournal(output);
  const journal = () =>
    recoveryJournal.append({
      kind: "state",
      status: "INCOMPLETE_NOT_ACCEPTANCE",
      inputSha256: digest(p),
      runId: p.runId,
      target: p.target,
      checks,
      requestIds,
      cleanupDone,
    });
  const event = (row: unknown) => recoveryJournal.append({ kind: "event", event: row });
  const guard = () => {
    validateApproval(p, approval, runnerCommit, Date.now(), cleanupPhase);
    // Cleanup has its own authorization lease, and must still target the same immutable resources.
    if (!cleanupPhase) validateInput(p);
  };
  const request = async (url: string, init: RequestInit = {}) => {
    guard();
    const u = new URL(url);
    assert.ok(
      [
        p.target.origin,
        `https://${p.target.blob.host}`,
        "https://api.vercel.com",
        "https://console.neon.tech",
        "https://vercel.com",
      ].includes(u.origin),
    );
    const headers = new Headers(init.headers);
    if (u.origin === p.target.origin && env.HOSTED_VERCEL_BYPASS)
      headers.set("x-vercel-protection-bypass", env.HOSTED_VERCEL_BYPASS);
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.status < 300 || response.status >= 400, "redirect refused");
    return response;
  };
  const providerJson = async (url: string, token: string) => {
    const r = await request(url, { headers: { authorization: "Bearer " + token } });
    assert.equal(r.status, 200, "provider binding read failed");
    return await r.json();
  };
  const verifyProviders = async () => {
    const d = await providerJson(
      `https://api.vercel.com/v13/deployments/${p.target.deploymentId}?teamId=${p.target.teamId}`,
      env.HOSTED_VERCEL_READ_TOKEN!,
    );
    assert.equal(d.id, p.target.deploymentId);
    assert.equal(d.projectId, p.target.projectId);
    assert.equal(d.readyState, "READY");
    assert.ok(d.target === null || d.target === "preview", "explicit preview environment required");
    assert.equal(d.ownerId ?? d.team?.id, p.target.teamId, "deployment team binding");
    assert.equal(d.meta?.githubCommitSha, p.target.commit);
    assert.equal("https://" + d.url, p.target.origin);
    const n = await providerJson(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(p.target.neon.projectId)}/endpoints/${encodeURIComponent(p.target.neon.endpointId)}`,
      env.HOSTED_NEON_READ_TOKEN!,
    );
    assert.equal(n.endpoint?.id, p.target.neon.endpointId);
    assert.equal(n.endpoint?.branch_id, p.target.neon.branchId);
    assert.equal(n.endpoint?.host, p.target.neon.host);
  };
  journal();
  await verifyProviders();
  const Client = (require("pg") as { Client: new (options: unknown) => Db }).Client;
  const db = new Client({
    connectionString: env.HOSTED_DATABASE_URL,
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
  const query = async (sql: string, params: unknown[] = []) => {
    guard();
    return (await db.query(sql, params)).rows;
  };
  let faultOid: string | undefined,
    faultArmed = false,
    faultTimer: ReturnType<typeof setTimeout> | undefined;
  let restoringFault: Promise<void> | undefined, watchdogFailure: unknown;
  const restoreFault = async () => {
    if (!faultArmed) return;
    if (restoringFault) return restoringFault;
    restoringFault = (async () => {
      validateApproval(p, approval, runnerCommit, Date.now(), true);
      const rows = (
        await db.query(
          "SELECT c.oid::text AS oid,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",
          [["articles", p.recovery.offlineTable]],
        )
      ).rows;
      assert.equal(rows.length, 1, "RECOVERY_TABLE_AMBIGUOUS");
      assert.equal(rows[0].oid, faultOid, "RECOVERY_TABLE_OID_MISMATCH");
      if (rows[0].name === p.recovery.offlineTable) {
        await db.query("BEGIN");
        try {
          await db.query("SET LOCAL lock_timeout='3s'");
          await db.query("SET LOCAL statement_timeout='5s'");
          await db.query(`ALTER TABLE public.${p.recovery.offlineTable} RENAME TO articles`);
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        }
      } else assert.equal(rows[0].name, "articles", "RECOVERY_TABLE_NAME");
      faultArmed = false;
      if (faultTimer) clearTimeout(faultTimer);
      event({ kind: "outage-restored", faultId: p.recovery.id, oid: faultOid });
    })();
    try {
      await restoringFault;
    } finally {
      restoringFault = undefined;
    }
  };
  const enableFault = async () => {
    guard();
    assert.equal(faultArmed, false);
    const rows = await query(
      "SELECT c.oid::text AS oid,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",
      [["articles", p.recovery.offlineTable]],
    );
    assert.equal(rows.length, 1, "RECOVERY_TABLE_AMBIGUOUS");
    assert.equal(rows[0].name, "articles");
    faultOid = String(rows[0].oid);
    event({
      kind: "outage-intent",
      faultId: p.recovery.id,
      oid: faultOid,
      from: "articles",
      to: p.recovery.offlineTable,
      maxDurationMs: p.recovery.maxDurationMs,
    });
    faultArmed = true;
    attemptedWrites = true;
    const startedAt = Date.now();
    await query("BEGIN");
    try {
      await query("SET LOCAL lock_timeout='3s'");
      await query("SET LOCAL statement_timeout='5s'");
      await query(`ALTER TABLE public.articles RENAME TO ${p.recovery.offlineTable}`);
      await query("COMMIT");
      // Arm only after COMMIT: the watchdog must not interleave a second transaction
      // on this connection while the rename is still in flight.
      faultTimer = setTimeout(
        () => {
          void restoreFault().catch((error) => {
            watchdogFailure = error;
          });
        },
        Math.max(0, p.recovery.maxDurationMs - (Date.now() - startedAt)),
      );
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  };
  const capture = async (): Promise<Snapshot> => {
    const result = {} as Snapshot;
    for (const table of tables) {
      const [where, ids] =
        table === "articles"
          ? ["id = ANY($1::uuid[])", p.cleanup.articleIds]
          : table === "blog_mutation_requests"
            ? ["TRUE", []]
            : table === "blog_categories"
              ? ["id = ANY($1::uuid[])", p.categoryIds]
              : table === "blog_settings"
                ? ["id = ANY($1::uuid[])", p.settingsIds]
                : table === "blog_featured_articles"
                  ? ["scope_id = ANY($1::uuid[])", p.settingsIds]
                  : table === "cms_content_revisions"
                    ? [
                        "resource_type='article' AND resource_id = ANY($1::uuid[])",
                        p.cleanup.articleIds,
                      ]
                    : [
                        "subject_id::text = ANY($1::text[])",
                        [...p.cleanup.articleIds, ...p.categoryIds, ...p.settingsIds],
                      ];
      result[table] = (
        await query(
          `SELECT ${table === "blog_mutation_requests" ? "to_jsonb(t) || jsonb_build_object('_transaction',t.xmin::text)" : "to_jsonb(t)"} AS row FROM public.${table} t WHERE ${where} ORDER BY to_jsonb(t)::text`,
          table === "blog_mutation_requests" ? [] : [ids],
        )
      ).map((r) => r.row as Row);
    }
    return result;
  };
  const restore = async () => {
    assert.ok(snapshot);
    // Restore only the approved row set in one transaction. Never drop/recreate a database.
    await query("BEGIN");
    try {
      await query("SELECT blog_lock()");
      await query(
        "LOCK TABLE articles, blog_categories, blog_settings, blog_featured_articles, cms_content_revisions, audit_logs, blog_mutation_requests IN EXCLUSIVE MODE",
      );
      const current = await capture();
      const ownedRequests = reconcileMutationRequests(
        snapshot.blog_mutation_requests as MutationRow[],
        current.blog_mutation_requests as MutationRow[],
        mutationIntents,
      );
      event({ kind: "cleanup-request-ownership", requests: ownedRequests });
      for (const table of ["cms_content_revisions", "audit_logs"] as const) {
        const oldIds = new Set(snapshot[table].map((r) => r.id));
        for (const row of current[table].filter((r) => !oldIds.has(r.id)))
          assert.ok(
            roles.some(
              (role) =>
                p.actors[role].staffId === row[table === "audit_logs" ? "actor_id" : "created_by"],
            ),
            "foreign writer: stop cleanup",
          );
      }
      // Isolated DB owner must separately approve these two transactional trigger controls.
      await query(
        "ALTER TABLE public.cms_content_revisions DISABLE TRIGGER cms_revision_immutable",
      );
      await query(
        "ALTER TABLE public.cms_content_revisions DISABLE TRIGGER blog_project_article_revision",
      );
      for (const table of ["cms_content_revisions", "audit_logs"] as const) {
        const extra = current[table]
          .filter((r) => !snapshot![table].some((old) => old.id === r.id))
          .map((r) => r.id);
        await query(`DELETE FROM public.${table} WHERE id = ANY($1::uuid[])`, [extra]);
      }
      for (const table of [
        "cms_content_revisions",
        "articles",
        "blog_categories",
        "blog_settings",
        "audit_logs",
      ] as const) {
        for (const row of snapshot[table]) {
          const columns = Object.keys(row).filter((k) => k !== "id");
          assert.ok(columns.every((c) => /^[a-z_]+$/.test(c)));
          await query(
            `UPDATE public.${table} t SET ${columns.map((c) => `"${c}"=r."${c}"`).join(",")} FROM jsonb_populate_record(NULL::public.${table},$1::jsonb) r WHERE t.id=r.id`,
            [JSON.stringify(row)],
          );
        }
      }
      await query("DELETE FROM blog_featured_articles WHERE scope_id = ANY($1::uuid[])", [
        p.settingsIds,
      ]);
      await query(
        "INSERT INTO blog_featured_articles SELECT * FROM jsonb_populate_recordset(NULL::blog_featured_articles,$1::jsonb)",
        [JSON.stringify(snapshot.blog_featured_articles)],
      );
      await query(
        "DELETE FROM blog_mutation_requests WHERE request_id = ANY($1::uuid[]) AND actor_id = ANY($2::uuid[])",
        [ownedRequests.map((r) => r.requestId), roles.map((r) => p.actors[r].staffId)],
      );
      await query("ALTER TABLE public.cms_content_revisions ENABLE TRIGGER cms_revision_immutable");
      await query(
        "ALTER TABLE public.cms_content_revisions ENABLE TRIGGER blog_project_article_revision",
      );
      assert.equal(digest(await capture()), digest(snapshot), "exact database restore readback");
      await query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  };
  const cleanup = async () => {
    await restoreFault();
    if (!attemptedWrites || !snapshot) return;
    guard();
    await verifyProviders();
    const failures: unknown[] = [];
    try {
      const before = await request(p.media.url);
      if (before.status !== 404) {
        assert.equal(before.status, 200);
        assert.equal(
          sha256(new Uint8Array(await before.arrayBuffer())),
          p.media.imageSha256,
          "unexpected blob bytes: refuse deletion",
        );
        const etag = before.headers.get("etag");
        assert.ok(etag, "exact blob ETag required");
        const deleted = await request("https://vercel.com/api/blob/delete", {
          method: "POST",
          headers: {
            authorization: "Bearer " + env.HOSTED_BLOB_TOKEN,
            "content-type": "application/json",
            "x-api-version": "13",
            "x-if-match": etag,
            "x-vercel-blob-store-id": p.target.blob.storeId,
          },
          body: JSON.stringify({ urls: [p.media.url] }),
        });
        assert.ok(deleted.ok, "exact blob deletion failed");
        let absent = false;
        for (let attempt = 0; attempt < 36; attempt++) {
          const readback = await request(p.media.url);
          if (readback.status === 404) {
            absent = true;
            break;
          }
          assert.equal(readback.status, 200);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        assert.ok(absent, "blob cleanup readback deadline exceeded");
      }
      await query("BEGIN");
      try {
        await query(
          "DELETE FROM media_assets WHERE upload_intent_id=$1 AND pathname=$2 AND url=$3 AND created_by=$4",
          [p.media.uploadId, p.media.pathname, p.media.url, p.actors.admin.staffId],
        );
        await query(
          "DELETE FROM media_upload_intents WHERE id=$1 AND pathname=$2 AND created_by=$3",
          [p.media.uploadId, p.media.pathname, p.actors.admin.staffId],
        );
        assert.equal(
          (
            await query(
              "SELECT id FROM media_upload_intents WHERE id=$1 UNION ALL SELECT id FROM media_assets WHERE upload_intent_id=$1",
              [p.media.uploadId],
            )
          ).length,
          0,
        );
        await query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }

      event({ kind: "cleanup-media", uploadId: p.media.uploadId, absent: true });
    } catch (error) {
      failures.push(error);
    }
    try {
      await restore();
      event({ kind: "cleanup-blog", restored: true });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, "EXACT_CLEANUP_FAILED");
    cleanupDone = true;
    journal();
  };
  await withExactCleanup(
    async () => {
      await db.connect();
      const [identity] = await query("SELECT current_database() AS database, current_user AS role");
      assert.deepEqual(identity, { database: p.target.neon.database, role: p.target.neon.role });
      const triggers = await query(
        `SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY($1::text[])`,
        [[...tables, "media_assets", "media_upload_intents", "blog_mutation_requests"]],
      );
      validateTriggerInventory(triggers as { table_name: string; name: string; enabled: string }[]);
      for (const role of roles) {
        const rows = await query(hostedSessionBindingSql, [
          env[`HOSTED_${role.toUpperCase()}_SESSION`],
          approval.expiresAt,
        ]);
        assert.deepEqual(
          rows,
          [{ user_id: p.actors[role].userId, staff_id: p.actors[role].staffId, roles: [role] }],
          "real actor binding",
        );
      }
      snapshot = await capture();
      recoveryJournal.baseline({
        inputSha256: digest(p),
        runId: p.runId,
        target: p.target,
        snapshot,
      });
      journal();
      sameSet(
        snapshot.articles.map((r) => String(r.id)),
        p.cleanup.articleIds,
        "database article IDs",
      );
      sameSet(
        snapshot.blog_categories.map((r) => String(r.id)),
        p.categoryIds,
        "database category IDs",
      );
      sameSet(
        snapshot.blog_settings.map((r) => String(r.id)),
        p.settingsIds,
        "database settings IDs",
      );
      assert.equal(
        (await query("SELECT id FROM media_upload_intents WHERE id=$1", [p.media.uploadId])).length,
        0,
        "upload ID already exists",
      );
      assert.equal(
        (
          await query("SELECT id FROM media_assets WHERE pathname=$1 OR url=$2", [
            p.media.pathname,
            p.media.url,
          ])
        ).length,
        0,
      );
      assert.equal((await request(p.media.url)).status, 404, "blob must be absent before upload");
      const modulePath = new URL(
        "./serverFnFetcher.js",
        import.meta.resolve("@tanstack/start-client-core/client-rpc"),
      ).href;
      const { serverFnFetcher } = (await import(modulePath)) as {
        serverFnFetcher: (
          url: string,
          args: unknown[],
          fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
        ) => Promise<{ result: unknown; error?: unknown }>;
      };
      const mark = (name: string) => {
        assert.ok(!checks.includes(name));
        checks.push(name);
        journal();
      };
      const rpc = async <T>(
        name: keyof HostedInput["functions"],
        data: unknown,
        role?: Role,
      ): Promise<T> => {
        const method = ["saveServer", "settingsServer", "categoryServer"].includes(name)
          ? "POST"
          : "GET";
        if (method === "POST") {
          attemptedWrites = true;
          if (name === "saveServer") {
            const id = (data as { requestId: string }).requestId;
            if (!requestIds.includes(id)) {
              requestIds.push(id);
              if (role) {
                const { input, ...tokens } = data as SaveArticleCommand;
                const intent = {
                  requestId: id,
                  actorId: p.actors[role].staffId,
                  command: { ...tokens, payload: encodeArticle(input) },
                };
                mutationIntents.push(intent);
                event({ kind: "mutation-intent", intent });
              }
            }
          }
          journal(); // intent persisted before dispatch, including lost responses
        }
        // Serialization uses startOptions only (same client transport as the owned HTTP suite).
        const context = { startOptions: {} } as Parameters<typeof runWithStartContext>[0];
        const result = await unwrapServerFnResponse(
          runWithStartContext(context, () =>
            serverFnFetcher(
              p.target.origin + "/_serverFn/" + p.functions[name],
              [
                {
                  method,
                  data,
                  headers: {
                    origin: p.target.origin,
                    "sec-fetch-site": "same-origin",
                    ...(role
                      ? { authorization: "Bearer " + env[`HOSTED_${role.toUpperCase()}_SESSION`] }
                      : {}),
                  },
                },
              ],
              async (input, init) => {
                const url = String(input);
                assert.equal(new URL(url).origin, p.target.origin);
                const r = await request(url, init);
                checkCache(r.headers, !["pageServer", "articleServer"].includes(name));
                event({ kind: "rpc", name, role: role ?? "anonymous", status: r.status });
                return r;
              },
            ),
          ),
        );
        if (result.error) throw result.error;
        return result.result as T;
      };
      const io: HostedIO = {
        async list(role) {
          const pages = [];
          for (const page of [1, 2])
            pages.push(
              await rpc<{ items: { id: string; slug: string }[]; total: number }>(
                "listServer",
                { page, pageSize: 100, search: "", state: "all" },
                role,
              ),
            );
          assert.equal(pages[0].total, pages[1].total);
          return { total: pages[0].total, items: pages.flatMap((p) => p.items) };
        },
        preview: (id, role) => rpc("previewServer", { id }, role),
        save: (data, role) => rpc("saveServer", data, role),
        state: (role) => rpc("stateServer", {}, role),
        settings: (data, role) => rpc("settingsServer", data, role),
        category: (data, role) => rpc("categoryServer", data, role),
        article: (slug) => rpc("articleServer", { slug }),
        page: (categoryKey) =>
          rpc("pageServer", { page: 1, ...(categoryKey ? { categoryKey } : {}) }),
        mark,
        async recover(expected) {
          const result = await runHostedRecovery(
            p,
            env,
            expected,
            guard,
            { enable: enableFault, restore: restoreFault },
            async (name) => {
              try {
                await rpc(name, name === "pageServer" ? { page: 1 } : { slug: p.articles[0].slug });
              } catch (error) {
                if (
                  error &&
                  typeof error === "object" &&
                  "status" in error &&
                  typeof error.status === "number"
                )
                  return error.status;
                throw error;
              }
              throw new Error("RECOVERY_REAL_UNAVAILABLE_REQUIRED");
            },
            checkCache,
          );
          if (watchdogFailure) throw watchdogFailure;
          event({ kind: "bounded-outage-recovery", result });
          return result;
        },
        async renderSettings(path, expected, featuredPaths) {
          const r = await request(p.target.origin + path);
          assert.equal(r.status, 200);
          checkCache(r.headers);
          const $ = load(await r.text());
          assert.equal($("h1").text().trim(), expected.heading, "CMS_RENDERED_HEADING");
          assert.ok($("body").text().includes(expected.introduction), "CMS_RENDERED_INTRODUCTION");
          assert.equal($("title").text(), expected.seoTitle, "CMS_RENDERED_SEO_TITLE");
          assert.equal(
            $("meta[name=description]").attr("content"),
            expected.seoDescription,
            "CMS_RENDERED_SEO_DESCRIPTION",
          );
          const hrefs = $('section[aria-label="精選文章"] a')
            .toArray()
            .map((el) => $(el).attr("href"));
          assert.deepEqual(hrefs, featuredPaths, "CMS_RENDERED_FEATURE_ORDER");
          event({
            kind: "rendered-settings",
            path,
            requestedSha256: digest(expected),
            featuredPaths,
          });
        },
        async renderCategories(expected) {
          const r = await request(p.target.origin + "/blog");
          assert.equal(r.status, 200);
          checkCache(r.headers);
          const $ = load(await r.text());
          const filters = $('[aria-label="按分類篩選文章"] a')
            .toArray()
            .map((el) => ({
              key: new URL($(el).attr("href")!, p.target.origin).searchParams.get("category"),
              name: $(el).text().trim(),
            }))
            .filter((c) => c.key !== null);
          assert.deepEqual(
            filters,
            expected
              .filter((c) => !c.hidden)
              .sort((a, b) => a.navigationOrder - b.navigationOrder || a.id.localeCompare(b.id))
              .map((c) => ({ key: c.key, name: c.name })),
            "CMS_RENDERED_CATEGORIES",
          );
          event({ kind: "rendered-categories", requestedSha256: digest(expected) });
        },
        async indexes(eligibleSlugs) {
          for (const path of ["/sitemap.xml", "/llms.txt"]) {
            const response = await request(p.target.origin + path);
            assert.equal(response.status, 200);
            checkCache(response.headers);
            const body = await response.text();
            if (path === "/sitemap.xml") {
              const xml = load(body, { xmlMode: true });
              const slugs = xml("loc")
                .toArray()
                .map((el) => new URL(xml(el).text()))
                .filter(
                  (u) =>
                    u.pathname.startsWith("/blog/") && u.pathname !== "/blog/editorial-standards",
                );
              for (const url of slugs) assert.equal(url.origin, p.target.origin);
              sameSet(
                slugs.map((u) => u.pathname.slice(6)),
                eligibleSlugs,
                "sitemap publication set",
              );
              assert.ok(body.includes("/blog/editorial-standards"));
            } else {
              for (const slug of p.articles.map((a) => a.slug)) {
                const linked = body.includes("/blog/" + slug + ")");
                if (!eligibleSlugs.includes(slug))
                  assert.equal(linked, false, "ineligible llms link");
                if (
                  [
                    "sham-tseng-buying-guide-2026",
                    "bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
                  ].includes(slug)
                )
                  assert.equal(linked, eligibleSlugs.includes(slug));
              }
            }
            event({
              kind: "publication-index",
              path,
              eligible: eligibleSlugs.length,
              sha256: sha256(body),
            });
          }
        },
        async document(path, status, title, absent) {
          const url = new URL(path, p.target.origin);
          assert.equal(url.origin, p.target.origin);
          for (let repeat = 0; repeat < 2; repeat++) {
            const r = await request(url.href);
            assert.equal(r.status, status);
            checkCache(r.headers);
            const html = await r.text(),
              $ = load(html);
            if (title) assert.equal($("h1").text().trim(), title);
            if (absent) assert.ok(!html.includes(absent), "private content leaked");
            event({
              kind: "document",
              path,
              status,
              repeat,
              htmlSha256: sha256(html),
              headers: Object.fromEntries(
                [
                  "cache-control",
                  "cdn-cache-control",
                  "vercel-cdn-cache-control",
                  "x-vercel-cache",
                  "age",
                ].map((k) => [k, r.headers.get(k)]),
              ),
            });
          }
        },
        async checkUrl(item) {
          const expected = checklist.articles.find((a) => a.slug === item.slug)!;
          await io.document(expected.path, expected.expectedStatus, item.title);
          const r = await request(p.target.origin + expected.path),
            $ = load(await r.text());
          assert.equal($("link[rel=canonical]").attr("href"), p.target.origin + expected.path);
          assert.equal($("title").text(), item.seoTitle);
          assert.equal($("meta[name=description]").attr("content"), item.seoDescription);
          assert.ok(
            $("[data-article-body]").text().includes(item.bodyText),
            "manifest body association",
          );
          const a = await io.preview(item.id, "admin");
          assert.equal(digest(articleInput(a)), item.inputSha256);
          assert.equal((await io.article(item.slug))?.id, item.id);
        },
      };
      mark("identity");
      // Browser reads happen before CMS mutations and require all 112 seeded pages to be public.
      await runHostedBrowser(p, env, states, guard, event);
      mark("a11y");
      await runCmsScenario(p, io);
      const upload = async (role?: Role) => {
        attemptedWrites = true;
        journal();
        const body = new FormData();
        body.set("file", new Blob([imageBytes], { type: "image/png" }), "acceptance.png");
        body.set("ownerType", "article");
        body.set("uploadId", p.media.uploadId);
        return request(p.target.origin + "/api/admin/media/upload", {
          method: "POST",
          body,
          headers: {
            origin: p.target.origin,
            ...(role
              ? { authorization: "Bearer " + env[`HOSTED_${role.toUpperCase()}_SESSION`] }
              : {}),
          },
        });
      };
      assert.equal((await upload()).status, 401);
      const uploaded = await upload("admin");
      assert.equal(uploaded.status, 200);
      assert.deepEqual(await uploaded.json(), {
        ok: true,
        url: p.media.url,
        pathname: p.media.pathname,
      });
      const bytes = await request(p.media.url);
      assert.equal(bytes.status, 200);
      assert.equal(bytes.headers.get("content-type"), "image/png");
      assert.equal(sha256(new Uint8Array(await bytes.arrayBuffer())), p.media.imageSha256);
      const meta = await query(
        "SELECT pathname,url,content_type,size_bytes::int,owner_type,created_by::text FROM media_assets WHERE upload_intent_id=$1",
        [p.media.uploadId],
      );
      assert.deepEqual(meta, [
        {
          pathname: p.media.pathname,
          url: p.media.url,
          content_type: "image/png",
          size_bytes: imageBytes.length,
          owner_type: "article",
          created_by: p.actors.admin.staffId,
        },
      ]);
      for (const role of ["manager", "agent"] as const) {
        const denial = await upload(role);
        assert.equal(denial.status, 409);
        assert.equal((await denial.json()).error, "UPLOAD_ID_CONFLICT");
      }
      assert.equal((await upload("admin")).status, 200);
      mark("media");
    },
    async () => {
      cleanupPhase = true;
      await cleanup();
    },
    async () => {
      if (faultTimer) clearTimeout(faultTimer);
      await db.end();
    },
  );
  validateApproval(p, approval, runnerCommit); // expiry during tests cannot produce PASS
  const receipt: Receipt = {
    layer: "hosted",
    inputSha256: digest(p),
    deploymentId: p.target.deploymentId,
    commit: p.target.commit,
    checks,
    cleanup: {
      id: p.cleanup.id,
      restored: cleanupDone,
      uploadId: p.media.uploadId,
      blobUrl: p.media.url,
      absent: cleanupDone,
    },
  };
  acceptReceipt(p, receipt);
  writeFileSync(
    join(output, "receipt.json"),
    JSON.stringify({ status: "PASS_HOSTED", ...receipt }, null, 2),
    { flag: "wx" },
  );
  return receipt;
}
