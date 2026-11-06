import { describe, test, expect } from "bun:test";
import {
  acceptReceipt,
  digest,
  validateApproval,
  validateInput,
  validateSecrets,
  type HostedInput,
} from "./hosted-contract";
import { approved, fixture, id, receipt } from "./hosted-test-fixture";
import { checkCache, executeHosted } from "./hosted-runtime";
import { withExactCleanup } from "./hosted-lifecycle";
import { PAGES, TAGS, VIEWPORTS } from "../../e2e/a11y-checks";
import { imageBytes } from "./hosted-contract";
import { validateTriggerInventory } from "./hosted-contract";
import { inflateSync } from "node:zlib";
const now = Date.now();
test("unapproved trigger side effects and missing integrity guards block writes", () => {
  const rows = [
    { table_name: "articles", name: "blog_article_contract_guard", enabled: "O" },
    { table_name: "articles", name: "ep_knowledge_articles", enabled: "D" },
    { table_name: "blog_categories", name: "blog_category_key_guard", enabled: "O" },
    { table_name: "cms_content_revisions", name: "blog_project_article_revision", enabled: "O" },
    { table_name: "cms_content_revisions", name: "cms_revision_immutable", enabled: "O" },
  ];
  expect(() => validateTriggerInventory(rows)).not.toThrow();
  expect(() => validateTriggerInventory(rows.slice(1))).toThrow();
  expect(() =>
    validateTriggerInventory([...rows, { table_name: "articles", name: "unknown", enabled: "O" }]),
  ).toThrow();
  expect(() =>
    validateTriggerInventory(
      rows.map((r) => (r.name === "ep_knowledge_articles" ? { ...r, enabled: "O" } : r)),
    ),
  ).toThrow();
});
test("test image is a complete 1x1 PNG with valid CRCs and decodable pixel bytes", () => {
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  expect(imageBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const chunks: string[] = [];
  for (let offset = 8; offset < imageBytes.length; ) {
    const length = imageBytes.readUInt32BE(offset),
      name = imageBytes.subarray(offset + 4, offset + 8).toString();
    expect(crc32(imageBytes.subarray(offset + 4, offset + 8 + length))).toBe(
      imageBytes.readUInt32BE(offset + 8 + length),
    );
    if (name === "IDAT")
      expect(inflateSync(imageBytes.subarray(offset + 8, offset + 8 + length)).length).toBe(4);
    chunks.push(name);
    offset += length + 12;
  }
  expect(chunks).toEqual(["IHDR", "IDAT", "IEND"]);
});
test("shared a11y coverage remains 27 pages, both viewports and WCAG 2.2 AA", () => {
  expect(PAGES).toHaveLength(27);
  expect(VIEWPORTS.map((v) => v.width)).toEqual([375, 1440]);
  expect(TAGS).toEqual(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]);
});
test("cleanup runs after partial failure; both errors survive and connection always closes", async () => {
  const calls: string[] = [],
    original = new Error("partial result"),
    cleanup = new Error("cleanup failed");
  try {
    await withExactCleanup(
      async () => {
        calls.push("run");
        throw original;
      },
      async () => {
        calls.push("cleanup");
        throw cleanup;
      },
      async () => {
        calls.push("close");
      },
    );
    throw new Error("must reject");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([original, cleanup]);
  }
  expect(calls).toEqual(["run", "cleanup", "close"]);
});
test("successful checks with failed cleanup cannot pass", async () => {
  await expect(
    withExactCleanup(
      async () => {},
      async () => {
        throw new Error("expired cleanup lease");
      },
      async () => {},
    ),
  ).rejects.toThrow();
});
describe("pure hosted input guards (never hosted evidence)", () => {
  const leaves = (value: unknown, prefix: string[] = []): string[][] =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, child]) => leaves(child, [...prefix, key]))
      : [prefix];
  for (const path of leaves(fixture(now)))
    test("missing required field: " + path.join("."), () => {
      const p = fixture(now);
      let parent = p as unknown as Record<string, unknown>;
      for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
      delete parent[path.at(-1)!];
      expect(() => validateInput(p, now)).toThrow();
    });
  test("complete input and exact approval validate locally", () => {
    const p = validateInput(fixture(now), now);
    expect(validateApproval(p, approved(p, now), p.target.commit, now).inputSha256).toBe(digest(p));
  });
  const invalid: [string, (p: HostedInput) => void][] = [
    [
      "production apex",
      (p) => {
        p.target.origin = "https://earnestproperty.com";
      },
    ],
    [
      "production www",
      (p) => {
        p.target.origin = "https://www.earnestproperty.com";
      },
    ],
    [
      "production Vercel alias",
      (p) => {
        p.target.origin = "https://earnestproperty-git-main-owner.vercel.app";
      },
    ],
    [
      "foreign production alias",
      (p) => {
        p.production.domains.push(new URL(p.target.origin).hostname);
      },
    ],
    [
      "HTTP",
      (p) => {
        p.target.origin = p.target.origin.replace("https:", "http:");
      },
    ],
    [
      "loopback",
      (p) => {
        p.target.origin = "https://127.0.0.1";
      },
    ],
    [
      "encoded origin credentials",
      (p) => {
        p.target.origin = "https://user:secret@approved.vercel.app";
      },
    ],
    [
      "origin path",
      (p) => {
        p.target.origin += "/admin";
      },
    ],
    [
      "origin port",
      (p) => {
        p.target.origin += ":8443";
      },
    ],
    [
      "origin fixture",
      (p) => {
        p.target.origin = "https://fixture.vercel.app";
      },
    ],
    [
      "production project",
      (p) => {
        p.target.projectId = "prj_hNaDYmYGeJhBY00vxsC2A0E5Fon5";
      },
    ],
    [
      "inventory project",
      (p) => {
        p.production.projectIds.push(p.target.projectId);
      },
    ],
    [
      "production Neon project",
      (p) => {
        p.target.neon.projectId = "dawn-meadow-79190048";
      },
    ],
    [
      "production branch",
      (p) => {
        p.target.neon.branchId = "br-polished-sea-aom4i1ct";
      },
    ],
    [
      "production DB name",
      (p) => {
        p.target.neon.database = "neondb";
      },
    ],
    [
      "production endpoint",
      (p) => {
        p.production.endpointIds.push(p.target.neon.endpointId);
      },
    ],
    [
      "production DB host",
      (p) => {
        p.production.dbHosts.push(p.target.neon.host);
      },
    ],
    [
      "production Blob host",
      (p) => {
        p.production.blobHosts.push(p.target.blob.host);
      },
    ],
    [
      "production Blob store",
      (p) => {
        p.production.blobStoreIds.push(p.target.blob.storeId);
      },
    ],
    [
      "production auth",
      (p) => {
        p.production.authHosts.push(new URL(p.target.auth.origin).hostname);
      },
    ],
    [
      "mismatched Blob host",
      (p) => {
        p.target.blob.host = "another.public.blob.vercel-storage.com";
      },
    ],
    [
      "pooled/other DB endpoint",
      (p) => {
        p.target.neon.host = "ep-other.neon.tech";
      },
    ],
    [
      "auth project",
      (p) => {
        p.target.auth.projectId = "other";
      },
    ],
    [
      "auth branch",
      (p) => {
        p.target.auth.branchId = "other";
      },
    ],
    [
      "missing immutable deployment",
      (p) => {
        p.target.deploymentId = "";
      },
    ],
    [
      "missing commit",
      (p) => {
        p.target.commit = "";
      },
    ],
    [
      "different runtime binding",
      (p) => {
        p.binding.target.deploymentId = "dpl_other";
      },
    ],
    [
      "different runtime DB",
      (p) => {
        p.binding.target.neon.database = "other";
      },
    ],
    [
      "expired binding",
      (p) => {
        p.binding.expiresAt = new Date(now).toISOString();
      },
    ],
    [
      "future binding",
      (p) => {
        p.binding.verifiedAt = new Date(now + 1).toISOString();
      },
    ],
    [
      "missing actor",
      (p) => {
        p.actors.admin.userId = "";
      },
    ],
    [
      "expired actor",
      (p) => {
        p.actors.admin.expiresAt = new Date(now).toISOString();
      },
    ],
    [
      "shared staff",
      (p) => {
        p.actors.agent.staffId = p.actors.admin.staffId;
      },
    ],
    [
      "shared session",
      (p) => {
        p.actors.agent.sessionSha256 = p.actors.admin.sessionSha256;
      },
    ],
    [
      "shared user",
      (p) => {
        p.actors.agent.userId = p.actors.admin.userId;
      },
    ],
    [
      "missing cleanup ID",
      (p) => {
        p.cleanup.id = "";
      },
    ],
    [
      "partial cleanup",
      (p) => {
        p.cleanup.articleIds.pop();
      },
    ],
    [
      "substitute cleanup",
      (p) => {
        p.cleanup.articleIds[0] = id(9999);
      },
    ],
    [
      "duplicate cleanup",
      (p) => {
        p.cleanup.articleIds[1] = p.cleanup.articleIds[0];
      },
    ],
    [
      "wrong media cleanup",
      (p) => {
        p.cleanup.uploadId = id(9999);
      },
    ],
    [
      "prefix cleanup",
      (p) => {
        p.cleanup.blobUrl = "https://" + p.target.blob.host + "/article/";
      },
    ],
    [
      "escaped media path",
      (p) => {
        p.media.pathname += "/../other";
      },
    ],
    [
      "other bytes",
      (p) => {
        p.media.imageSha256 = "0".repeat(64);
      },
    ],
    [
      "111 URLs",
      (p) => {
        p.articles.pop();
      },
    ],
    [
      "substitute URL",
      (p) => {
        p.articles[0].slug = "unknown";
      },
    ],
    [
      "duplicate URL",
      (p) => {
        p.articles[1].slug = p.articles[0].slug;
      },
    ],
    [
      "checklist changed",
      (p) => {
        p.checklistSha256 = "0".repeat(64);
      },
    ],
    [
      "missing production inventory",
      (p) => {
        p.production.blobHosts = [];
      },
    ],
  ];
  for (const [label, mutate] of invalid)
    test(label, () => {
      const p = fixture(now);
      mutate(p);
      expect(() => validateInput(p, now)).toThrow();
    });
  for (const name of ["fixtureAuth", "fixtureDatabase"])
    test(name, () => {
      const p = fixture(now);
      Object.assign(p.binding, { [name]: true });
      expect(() => validateInput(p, now)).toThrow();
    });
  test("unknown fields cannot introduce execution adapters", () =>
    expect(() => validateInput({ ...fixture(now), adapter: "local" }, now)).toThrow());
  test("approval binds actor/content/cleanup changes", () => {
    const p = fixture(now),
      a = approved(p, now);
    p.articles[0].title += " changed";
    expect(() => validateApproval(p, a, p.target.commit, now)).toThrow();
  });
  test("missing/expired/future approval and wrong runner reject", () => {
    const p = fixture(now),
      a = approved(p, now);
    expect(() => validateApproval(p, {}, p.target.commit, now)).toThrow();
    expect(() => validateApproval(p, a, "b".repeat(40), now)).toThrow();
    expect(() => validateApproval(p, a, p.target.commit, now + 1800000)).toThrow();
    expect(() => validateApproval(p, a, p.target.commit, now - 2000)).toThrow();
    expect(() =>
      validateApproval(p, { ...a, cleanupUntil: a.expiresAt }, p.target.commit, now),
    ).toThrow();
  });
  test("expired main lease allows only exact cleanup until independent expiry", () => {
    const p = fixture(now),
      a = approved(p, now);
    expect(() => validateApproval(p, a, p.target.commit, now + 1800000, true)).not.toThrow();
    expect(() => validateApproval(p, a, p.target.commit, now + 3600000, true)).toThrow();
  });
  test("credentials are bound before network", () => {
    const p = fixture(now);
    const env = {
      HOSTED_DATABASE_URL: `postgresql://acceptance_owner:secret@${p.target.neon.host}/blog_acceptance?sslmode=verify-full`,
      HOSTED_BLOB_TOKEN: "vercel_blob_rw_isolated123_secret",
      HOSTED_ADMIN_SESSION: "secret-admin",
      HOSTED_MANAGER_SESSION: "secret-manager",
      HOSTED_AGENT_SESSION: "secret-agent",
      HOSTED_VERCEL_READ_TOKEN: "read",
      HOSTED_NEON_READ_TOKEN: "read",
    };
    expect(() => validateSecrets(p, env)).not.toThrow();
    for (const [key, value] of Object.entries({
      DATABASE_URL: "anything",
      NODE_OPTIONS: "--import local",
      HTTPS_PROXY: "http://proxy",
      HOSTED_BLOB_TOKEN: "vercel_blob_rw_other_secret",
      HOSTED_AGENT_SESSION: "secret-admin",
      HOSTED_DATABASE_URL: env.HOSTED_DATABASE_URL.replace("blog_acceptance", "neondb"),
    }))
      expect(() => validateSecrets(p, { ...env, [key]: value })).toThrow();
  });
  test("invalid invocation reaches neither fetch nor output creation", async () => {
    const old = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls++;
        throw new Error("NETWORK_FORBIDDEN_IN_PURE_TEST");
      },
      { preconnect: old.preconnect },
    );
    try {
      await expect(
        executeHosted({}, approved(fixture(now)), "a".repeat(40), "MUST_NOT_EXIST", {}),
      ).rejects.toThrow();
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = old;
    }
  });
});
describe("no partial or fixture results promoted", () => {
  test("complete structural receipt validates; this test is not hosted evidence", () => {
    const p = fixture(now);
    expect(() => acceptReceipt(p, receipt(p))).not.toThrow();
  });
  for (const name of receipt(fixture(now)).checks)
    test("missing " + name, () => {
      const p = fixture(now),
        r = receipt(p);
      r.checks = r.checks.filter((n) => n !== name);
      expect(() => acceptReceipt(p, r)).toThrow();
    });
  for (const field of ["id", "uploadId", "blobUrl"] as const)
    test("cleanup mismatch " + field, () => {
      const p = fixture(now),
        r = receipt(p);
      r.cleanup[field] = "other";
      expect(() => acceptReceipt(p, r)).toThrow();
    });
  test("local, no cleanup, duplicate, unknown, wrong deployment/commit", () => {
    const p = fixture(now);
    for (const patch of [
      { layer: "local-seam" as const },
      { cleanup: { ...receipt(p).cleanup, absent: false } },
      { cleanup: { ...receipt(p).cleanup, restored: false } },
      { checks: [...receipt(p).checks, "identity"] },
      { checks: [...receipt(p).checks, "other"] },
      { deploymentId: "dpl_other" },
      { commit: "b".repeat(40) },
    ])
      expect(() => acceptReceipt(p, { ...receipt(p), ...patch })).toThrow();
  });
  test("cache headers: private/no-store, stripped Vercel directives, stale CDN refused", () => {
    expect(() => checkCache(new Headers({ "cache-control": "no-store" }))).not.toThrow();
    const cases: Record<string, string>[] = [
      { "cache-control": "max-age=60" },
      { "cache-control": "no-store", "cdn-cache-control": "s-maxage=300" },
      { "cache-control": "no-store", "x-vercel-cache": "HIT" },
      { "cache-control": "no-store", age: "1" },
    ];
    for (const values of cases) expect(() => checkCache(new Headers(values))).toThrow();
    expect(() => checkCache(new Headers({ "cache-control": "no-store" }), true)).toThrow();
  });
});
