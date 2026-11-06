import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { blogArticles } from "../../src/content/blog-articles";
import { buildImportPlan, fingerprint } from "../../src/lib/blog/reconcile";
import {
  prepareProductionPacket,
  reviewProductionPacket,
  executeProductionRelease,
  PRODUCTION_TARGET,
  PRODUCTION_IDENTITY,
  REQUIRED_CONTROLS,
  sha256,
} from "./production-adapter";

const source = {
  sourceRevision: "synthetic-test-source",
  registry: structuredClone(blogArticles),
  sitemap: JSON.parse(
    readFileSync("docs/superpowers/evidence/blog-cms/public-sitemap-snapshot.json", "utf8"),
  ),
  presentation: JSON.parse(
    readFileSync(
      "docs/superpowers/evidence/blog-cms/public-blog-presentation-snapshot.json",
      "utf8",
    ),
  ),
};
const seal = (value: unknown) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return { bytes, expectedSha256: sha256(bytes) };
};
const input = () => ({ target: PRODUCTION_TARGET, source: seal(source) });
const packet = prepareProductionPacket(input());
const snapshot = (targetIdentity = PRODUCTION_IDENTITY) => {
  const body = {
    targetIdentity,
    systemIdentifier: "synthetic-only",
    tables: Object.fromEntries(
      [
        "articles",
        "cms_content_revisions",
        "blog_categories",
        "blog_settings",
        "blog_featured_articles",
        "blog_legacy_category_map",
        "app_migrations",
      ].map((t) => [t, []]),
    ),
  };
  return { ...body, fingerprint: fingerprint(body) };
};

type Packet = ReturnType<typeof prepareProductionPacket>;
const snapshotPacket = prepareProductionPacket({ ...input(), snapshot: seal(snapshot()) });
const contradictoryBindings: [string, Packet, (p: Packet) => void, string][] = [
  [
    "inventory target",
    packet,
    (p) => {
      p.plan.inventory.targetIdentity = "owned:wrong";
    },
    "PRODUCTION_TARGET_BINDING",
  ],
  [
    "target fingerprint",
    packet,
    (p) => {
      p.targetFingerprint = "0".repeat(64);
    },
    "PRODUCTION_TARGET_BINDING",
  ],
  [
    "source fingerprint",
    packet,
    (p) => {
      p.sourceFingerprint = "0".repeat(64);
    },
    "PRODUCTION_SOURCE_BINDING",
  ],
  [
    "inventory source digest",
    packet,
    (p) => {
      p.plan.inventory.sourceDigest = "0".repeat(64);
    },
    "PRODUCTION_SOURCE_BINDING",
  ],
  [
    "absent snapshot with claimed fingerprint",
    packet,
    (p) => {
      p.snapshotFingerprint = "0".repeat(64);
    },
    "PRODUCTION_SNAPSHOT_BINDING",
  ],
  [
    "absent snapshot with claimed byte seal",
    packet,
    (p) => {
      p.snapshotByteSha256 = "0".repeat(64);
    },
    "PRODUCTION_SNAPSHOT_BINDING",
  ],
  [
    "snapshot outer fingerprint",
    snapshotPacket,
    (p) => {
      p.snapshotFingerprint = "0".repeat(64);
    },
    "PRODUCTION_SNAPSHOT_BINDING",
  ],
  [
    "snapshot target",
    snapshotPacket,
    (p) => {
      p.plan.inventory.database!.targetIdentity = "owned:wrong";
    },
    "PRODUCTION_SNAPSHOT_TARGET",
  ],
  [
    "snapshot missing system identity",
    snapshotPacket,
    (p) => {
      p.plan.inventory.database!.systemIdentifier = "";
    },
    "PRODUCTION_SNAPSHOT_TARGET",
  ],
  [
    "snapshot changed tables with unchanged internal fingerprint",
    snapshotPacket,
    (p) => {
      p.plan.inventory.database!.tables.app_migrations.push({ version: "changed" });
    },
    "PRODUCTION_SNAPSHOT_DIGEST",
  ],
  [
    "snapshot missing byte seal",
    snapshotPacket,
    (p) => {
      p.snapshotByteSha256 = null;
    },
    "PRODUCTION_SNAPSHOT_BINDING",
  ],
];
for (const [name, original, mutate, error] of contradictoryBindings) {
  test("reject rehashed contradictory " + name, () => {
    const p = structuredClone(original);
    mutate(p);
    // Attacker supplies a new internally consistent plan AND outer digest.
    p.plan = buildImportPlan(p.plan.inventory);
    const { manifestFingerprint: _, ...body } = p;
    p.manifestFingerprint = fingerprint(body);
    expect(() => reviewProductionPacket(p, p.manifestFingerprint)).toThrow(error);
  });
}

test("preparation preserves all source articles and keeps missing database explicit", () => {
  expect(packet.plan.insert).toHaveLength(112);
  expect(packet.plan.inventory.categories).toHaveLength(7);
  expect(packet.plan.inventory.settings).toHaveLength(8);
  expect(packet.plan.insert.filter((a) => a.publishedAt === null)).toHaveLength(2);
  expect(packet.plan.unresolved).toContain("source:database");
  expect(packet.executionAuthorized).toBe(false);
  expect(packet.snapshotFingerprint).toBeNull();
  expect(packet.plan.inventory.targetIdentity).toBe(PRODUCTION_IDENTITY);
});
test("deterministic, recursively frozen manifest binds source and implementation", () => {
  expect(prepareProductionPacket(input())).toEqual(packet);
  expect(Object.isFrozen(packet.plan.insert[0])).toBe(true);
  expect(packet.semantics).toHaveLength(14);
  expect(reviewProductionPacket(packet, packet.manifestFingerprint).integrity).toBe("MATCH");
});
for (const key of Object.keys(PRODUCTION_TARGET)) {
  test("reject substituted target " + key, () => {
    expect(() =>
      prepareProductionPacket({ ...input(), target: { ...PRODUCTION_TARGET, [key]: "wrong" } }),
    ).toThrow("PRODUCTION_TARGET");
  });
}
test("source seal rejects edited bytes and invalid digest", () => {
  const altered = input();
  altered.source.bytes[0] = 32;
  expect(() => prepareProductionPacket(altered)).toThrow("PRODUCTION_SEAL:source");
  expect(() =>
    prepareProductionPacket({ ...input(), source: { ...seal(source), expectedSha256: "" } }),
  ).toThrow("PRODUCTION_SEAL:source");
});
test("owned snapshots cannot become production snapshots", () => {
  expect(() =>
    prepareProductionPacket({ ...input(), snapshot: seal(snapshot("owned:fixture:postgres")) }),
  ).toThrow("PRODUCTION_SNAPSHOT_TARGET");
});
test("snapshot internal hash and external byte hash are independently checked", () => {
  const s = snapshot();
  s.fingerprint = "0".repeat(64);
  expect(() => prepareProductionPacket({ ...input(), snapshot: seal(s) })).toThrow(
    "PRODUCTION_SNAPSHOT_DIGEST",
  );
  const bad = seal(snapshot());
  bad.expectedSha256 = "0".repeat(64);
  expect(() => prepareProductionPacket({ ...input(), snapshot: bad })).toThrow(
    "PRODUCTION_SEAL:snapshot",
  );
});
test("complete synthetic snapshot still cannot satisfy operational evidence", () => {
  const p = prepareProductionPacket({ ...input(), snapshot: seal(snapshot()) });
  expect(p.plan.unresolved).toEqual([]);
  expect(p.blockers).toEqual(expect.arrayContaining([...REQUIRED_CONTROLS]));
  expect(reviewProductionPacket(p, p.manifestFingerprint).executionAuthorized).toBe(false);
});
test("missing migrated tables remain unresolved", () => {
  const s = snapshot();
  delete s.tables.blog_settings;
  s.fingerprint = fingerprint({
    targetIdentity: s.targetIdentity,
    systemIdentifier: s.systemIdentifier,
    tables: s.tables,
  });
  const p = prepareProductionPacket({ ...input(), snapshot: seal(s) });
  expect(p.plan.unresolved).toContain("database:missing-table:blog_settings");
});
test("approval digest cannot be reused after content changes", () => {
  const p = structuredClone(packet);
  p.plan.insert[0].title = "changed";
  expect(() => reviewProductionPacket(p, packet.manifestFingerprint)).toThrow(
    "PRODUCTION_MANIFEST_CHANGED",
  );
  expect(() => reviewProductionPacket(packet, "0".repeat(64))).toThrow(
    "PRODUCTION_MANIFEST_CHANGED",
  );
});
test("rehashed fabricated plan and implementation bindings fail review", () => {
  const p = structuredClone(packet);
  p.plan.insert[0].title = "changed";
  const { manifestFingerprint: _, ...body } = p;
  p.manifestFingerprint = fingerprint(body);
  expect(() => reviewProductionPacket(p, p.manifestFingerprint)).toThrow("PRODUCTION_PLAN_CHANGED");
  const q = structuredClone(packet);
  q.semantics[0].sha256 = "0".repeat(64);
  const { manifestFingerprint: __, ...qbody } = q;
  q.manifestFingerprint = fingerprint(qbody);
  expect(() => reviewProductionPacket(q, q.manifestFingerprint)).toThrow(
    "PRODUCTION_SEMANTICS_CHANGED",
  );
});
test("self-asserted approval, backup, fence and receipt never authorize execution", () => {
  const p = structuredClone(packet);
  p.blockers = [];
  p.executionAuthorized = true;
  const { manifestFingerprint: _, ...body } = p;
  p.manifestFingerprint = fingerprint(body);
  expect(reviewProductionPacket(p, p.manifestFingerprint).executionAuthorized).toBe(false);
  let calls = 0;
  for (let retry = 0; retry < 2; retry++) {
    expect(() =>
      executeProductionRelease(p, {
        approved: true,
        backup: true,
        fence: true,
        receipt: { writes: 0 },
        query: () => calls++,
      }),
    ).toThrow("PRODUCTION_EXECUTION_UNAVAILABLE");
  }
  expect(calls).toBe(0);
});
