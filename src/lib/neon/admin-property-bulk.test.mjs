import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(name, overrides = {}) {
  const source = readFileSync(new URL(name, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => {
      if (id in overrides) return overrides[id];
      if (id === "@tanstack/react-start/server-only") return {};
      if (id.endsWith(".server")) throw new Error("Unexpected real server dependency: " + id);
      return require(id);
    },
    module,
    module.exports,
  );
  return module.exports;
}
let schema, run;
const base = {
  items: [{ propertyNo: "P1", expectedVersion: "v1" }],
  scope: "sale",
  action: { type: "status", status: "draft" },
};
const offer = (dealType = "sale") => ({
  id: dealType,
  title: "物業放盤",
  dealType,
  price: 5000000,
  rent: 15000,
  status: "draft",
  editable: true,
});
const detail = (patch = {}) => ({
  propertyNo: "P1",
  version: "v1",
  title: "物業",
  shared: { title_zh: "物業" },
  editableShared: true,
  managementAvailable: true,
  offerings: { sale: offer(), rent: null },
  ...patch,
});
const actor = { staffId: "staff", roles: ["admin"] };
test.before(() => {
  const types = load("./admin-property-bulk.types.ts");
  schema = types.bulkPropertyManagementSchema;
  run = load("./admin-property-bulk.server.ts", {
    "./admin-property-bulk.types": types,
    "./admin-properties.server": {
      getAdminManagedProperty: () => {
        throw new Error("Real read forbidden");
      },
    },
    "./admin-property-management.server": {
      saveAdminPropertyManagement: () => {
        throw new Error("Real save forbidden");
      },
    },
  }).runAdminPropertyBulk;
});
test("strict boundary rejects empty, oversized, duplicate and unknown fields", () => {
  assert.equal(schema.safeParse(base).success, true);
  for (const patch of [
    { items: [] },
    {
      items: Array.from({ length: 6 }, (_, i) => ({ propertyNo: `P${i}`, expectedVersion: "v1" })),
    },
    { items: [...base.items, ...base.items] },
    { unknown: true },
    { items: [{ ...base.items[0], unknown: true }] },
    { action: { ...base.action, unknown: true } },
  ])
    assert.equal(schema.safeParse({ ...base, ...patch }).success, false);
  assert.equal(
    schema.safeParse({
      ...base,
      items: Array.from({ length: 5 }, (_, i) => ({ propertyNo: `P${i}`, expectedVersion: "v1" })),
    }).success,
    true,
  );
});
test("scope and action combinations are constrained", () => {
  for (const [scope, action] of [
    ["all", { type: "status", status: "active" }],
    ["all", { type: "agent", agentId: null }],
    ["sale", { type: "status", status: "rented" }],
    ["rent", { type: "status", status: "sold" }],
    ["sale", { type: "agent", agentId: "invalid" }],
  ])
    assert.equal(schema.safeParse({ ...base, scope, action }).success, false);
  assert.equal(
    schema.safeParse({ ...base, scope: "all", action: { type: "status", status: "offline" } })
      .success,
    true,
  );
});
for (const [label, value, input] of [
  ["missing property", null],
  ["stale version", detail({ version: "v2" })],
  ["management unavailable", detail({ managementAvailable: false })],
  ["missing offer", detail({ offerings: { sale: null, rent: offer("rent") } })],
  ["forbidden offer", detail({ offerings: { sale: { ...offer(), editable: false }, rent: null } })],
  [
    "all without shared access",
    detail({ editableShared: false }),
    { ...base, scope: "all", action: { type: "status", status: "offline" } },
  ],
  [
    "publication without title",
    detail({ offerings: { sale: { ...offer(), title: " " }, rent: null } }),
    { ...base, action: { type: "status", status: "active" } },
  ],
  [
    "publication without price",
    detail({ offerings: { sale: { ...offer(), price: 0 }, rent: null } }),
    { ...base, action: { type: "status", status: "active" } },
  ],
  [
    "all with forbidden offer",
    detail({ offerings: { sale: offer(), rent: { ...offer("rent"), editable: false } } }),
    { ...base, scope: "all", action: { type: "status", status: "offline" } },
  ],
])
  test(`no write for ${label}`, async () => {
    let writes = 0;
    const result = await run(input ?? base, actor, {
      read: async () => value,
      save: async () => {
        writes++;
        return { ok: true };
      },
    });
    assert.equal(writes, 0);
    assert.equal(result[0].ok, false);
    assert.ok(result[0].error);
  });
test("partial success preserves exact writer patch, scope, actor and version without retries", async () => {
  const writes = [];
  const input = { ...base, items: [...base.items, { propertyNo: "P2", expectedVersion: "v1" }] };
  const result = await run(input, actor, {
    read: async (id, staff) => {
      assert.equal(staff, actor);
      return detail({ propertyNo: id });
    },
    save: async (patch, staff) => {
      assert.equal(staff, actor);
      writes.push(patch);
      if (patch.propertyNo === "P2") throw new Response("SQL internal", { status: 409 });
      return { ok: true };
    },
  });
  assert.deepEqual(writes[0], { ...base.items[0], scope: "sale", payload: { status: "draft" } });
  assert.equal(writes.length, 2);
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
  assert.match(result[1].error, /重新載入/);
  assert.doesNotMatch(result[1].error, /SQL/);
});
test("agent assignment only patches selected offer and all-offline uses existing writer", async () => {
  for (const input of [
    { ...base, scope: "rent", action: { type: "agent", agentId: null } },
    { ...base, scope: "all", action: { type: "status", status: "offline" } },
  ]) {
    const writes = [];
    const result = await run(input, actor, {
      read: async () => detail({ offerings: { sale: offer(), rent: offer("rent") } }),
      save: async (patch) => {
        writes.push(patch);
        return { ok: true };
      },
    });
    assert.equal(result[0].ok, true);
    assert.deepEqual(writes[0], {
      ...base.items[0],
      scope: input.scope,
      payload: input.action.type === "agent" ? { agentId: null } : { status: "offline" },
    });
  }
});
test("unexpected read failures are safe and per-property", async () => {
  const result = await run(base, actor, {
    read: async () => {
      throw new Error("password SQL secret");
    },
    save: async () => assert.fail("unexpected write"),
  });
  assert.equal(result[0].ok, false);
  assert.doesNotMatch(result[0].error, /password|SQL|secret/);
});
test("runner rejects invalid batch before reads", async () => {
  await assert.rejects(() =>
    run({ ...base, items: [] }, actor, {
      read: async () => assert.fail("unexpected read"),
      save: async () => assert.fail("unexpected write"),
    }),
  );
});
test("rent publication requires rent regardless of sale price", async () => {
  const input = { ...base, scope: "rent", action: { type: "status", status: "active" } };
  const result = await run(input, actor, {
    read: async () =>
      detail({ offerings: { sale: offer(), rent: { ...offer("rent"), rent: null } } }),
    save: async () => assert.fail("unexpected write"),
  });
  assert.equal(result[0].ok, false);
});
test("eligible publication writes only status", async () => {
  let saved;
  const result = await run({ ...base, action: { type: "status", status: "active" } }, actor, {
    read: async () => detail(),
    save: async (value) => {
      saved = value;
      return { ok: true };
    },
  });
  assert.equal(result[0].ok, true);
  assert.deepEqual(saved.payload, { status: "active" });
});
test("server boundary requires staff and attaches staff authentication", () => {
  const source = readFileSync(new URL("./admin-property-bulk.ts", import.meta.url), "utf8");
  assert.match(source, /method: "POST"/);
  assert.match(source, /inputValidator\(bulkPropertyManagementSchema\)/);
  assert.match(source, /requireStaffAccess\(getRequest\(\), \["admin", "manager", "agent"\]\)/);
  assert.match(
    source,
    /unwrapServerFnResponse\(applyServer\(await withStaffAuthHeaders\(input\)\)\)/,
  );
});

test("rent publication rejects blank selected title even when shared and sale titles exist", async () => {
  let writes = 0;
  const result = await run(
    { ...base, scope: "rent", action: { type: "status", status: "active" } },
    actor,
    {
      read: async () =>
        detail({ offerings: { sale: offer(), rent: { ...offer("rent"), title: " " } } }),
      save: async () => {
        writes++;
        return { ok: true };
      },
    },
  );
  assert.equal(writes, 0);
  assert.equal(result[0].ok, false);
  assert.match(result[0].error, /標題/);
});
test("unknown save outcome stops remaining items without retry or further reads", async () => {
  const reads = [],
    writes = [];
  const result = await run(
    {
      ...base,
      items: [
        ...base.items,
        { propertyNo: "P2", expectedVersion: "v1" },
        { propertyNo: "P3", expectedVersion: "v1" },
      ],
    },
    actor,
    {
      read: async (id) => {
        reads.push(id);
        return detail({ propertyNo: id });
      },
      save: async (patch) => {
        writes.push(patch.propertyNo);
        throw new Error("connection lost after COMMIT SQL secret");
      },
    },
  );
  assert.deepEqual(reads, ["P1"]);
  assert.deepEqual(writes, ["P1"]);
  assert.equal(result.length, 3);
  assert.equal(result[0].ok, false);
  assert.equal(result[0].uncertain, true);
  assert.match(result[0].error, /重新載入/);
  assert.doesNotMatch(result[0].error, /COMMIT|SQL|secret/);
  for (const row of result.slice(1)) {
    assert.equal(row.ok, false);
    assert.equal(row.uncertain, undefined);
    assert.match(row.error, /尚未提交/);
  }
});
test("unknown read failures stay definite and permit subsequent items", async () => {
  const writes = [];
  const result = await run(
    { ...base, items: [...base.items, { propertyNo: "P2", expectedVersion: "v1" }] },
    actor,
    {
      read: async (id) => {
        if (id === "P1") throw new Error("read failed");
        return detail({ propertyNo: id });
      },
      save: async (patch) => {
        writes.push(patch.propertyNo);
        return { ok: true };
      },
    },
  );
  assert.equal(result[0].uncertain, undefined);
  assert.equal(result[1].ok, true);
  assert.deepEqual(writes, ["P2"]);
});
