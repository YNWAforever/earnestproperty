import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const readExisting = (path) => {
  assert.equal(existsSync(join(root, path)), true, `${path} should exist`);
  return read(path);
};

function generatedRouteBlock(routeTree, routeName) {
  const block = routeTree.match(new RegExp(`const ${routeName} = [\\s\\S]*?\\n\\} as any\\)`))?.[0];
  assert.ok(block, `${routeName} should be registered in the generated route tree`);
  return block;
}

/**
 * Extracts /agents' pure filter/grouping functions (matchesAgentFilters,
 * groupAgentsByBranch, agentDistrictSlugs) straight from agents.tsx's real
 * source and actually executes them against fixture agents -- matching
 * listings.contract.test.mjs's loadActiveFilterChipsFn() precedent (extract
 * + execute real source rather than re-implementing the logic in the test).
 *
 * estateRegistry is replaced with a small literal fixture rather than the
 * real content module: these functions only ever call
 * `estateRegistry.find(...)`, so a same-shaped stand-in resolves identically
 * at runtime once spliced into the same scope, without this test needing to
 * inline @/content/estate-registry's real (and much larger) import graph.
 */
function loadAgentFilterHelpers() {
  const agentsSource = readFileSync(join(root, "src/routes/agents.tsx"), "utf8");
  const districtBlock = agentsSource.slice(
    agentsSource.indexOf("const AGENT_DISTRICT_LABELS"),
    agentsSource.indexOf("type AgentDirectorySearch"),
  );
  const matchesBlock = agentsSource.slice(
    agentsSource.indexOf("function matchesAgentFilters"),
    agentsSource.indexOf("type AgentGroup ="),
  );
  const groupBlock = agentsSource.slice(
    agentsSource.indexOf("type AgentGroup ="),
    agentsSource.indexOf("export const Route ="),
  );

  const fixtureRegistry = `
    const estateRegistry = [
      { slug: "bellagio", districtSlug: "sham-tseng" },
      { slug: "hong-kong-garden", districtSlug: "sham-tseng" },
      { slug: "no-district-yet", districtSlug: null },
    ];
  `;

  // agentBranchName is imported from @/lib/agent-directory in the real file,
  // outside this extraction's range -- stubbed here the same way
  // estateRegistry is above, with the exact same branch_id-preferred,
  // free-text-fallback, null-if-neither behaviour as the real implementation
  // (see agent-directory.ts), so matchesAgentFilters/groupAgentsByBranch
  // exercise real branch_id resolution once spliced into this scope.
  const fixtureAgentBranchName = `
    function agentBranchName(agent, branches) {
      if (agent.branch_id) {
        const linked = branches.find((candidate) => candidate.id === agent.branch_id);
        if (linked) return linked.name;
      }
      return agent.branch ?? null;
    }
  `;

  const snippet = [
    fixtureRegistry,
    fixtureAgentBranchName,
    districtBlock,
    matchesBlock,
    groupBlock,
    "export { agentDistrictSlugs, matchesAgentFilters, groupAgentsByBranch };",
  ].join("\n");

  const { outputText } = ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exportsObj = {};
  new Function("exports", outputText)(exportsObj);
  return exportsObj;
}

function fixtureAgent(overrides = {}) {
  return {
    id: "agent-id",
    public_slug: "agent-slug",
    name_zh: "陳大文",
    name_en: "Chan Tai Man",
    job_title: null,
    phone: null,
    whatsapp: null,
    licence_no: null,
    avatar_url: null,
    branch: null,
    branch_id: null,
    bio: null,
    specialties: [],
    served_estate_slugs: [],
    languages: [],
    ...overrides,
  };
}

test("agent detail is a root-owned non-nested route that can render independently", () => {
  const detailPath = "src/routes/agents_.$slug.tsx";
  const routeTree = read("src/routeTree.gen.ts");

  assert.equal(existsSync(join(root, detailPath)), true, "non-nested agent detail should exist");
  assert.equal(
    existsSync(join(root, "src/routes/agents.$slug.tsx")),
    false,
    "nested agent detail should be removed",
  );
  assert.match(read(detailPath), /createFileRoute\("\/agents_\/\$slug"\)/);
  assert.match(routeTree, /from ['"]\.\/routes\/agents_\.\$slug['"]/);

  const detailRoute = generatedRouteBlock(routeTree, "AgentsSlugRoute");
  assert.match(detailRoute, /id: ['"]\/agents_\/\$slug['"]/);
  assert.match(detailRoute, /path: ['"]\/agents\/\$slug['"]/);
  assert.match(detailRoute, /getParentRoute: \(\) => rootRouteImport/);
  assert.doesNotMatch(detailRoute, /getParentRoute: \(\) => AgentsRoute/);
});

test("agent directory is SSR route-loaded with safe pending and error surfaces", () => {
  const directory = read("src/routes/agents.tsx");

  assert.match(directory, /loader:\s*async\s*\(\)\s*=>/);
  assert.match(directory, /fetchNeonPublicAgentProfiles/);
  assert.match(directory, /Route\.useLoaderData\(\)/);
  assert.match(directory, /pendingComponent:\s*AgentDirectoryPending/);
  assert.match(directory, /errorComponent:\s*AgentDirectoryError/);
  assert.doesNotMatch(directory, /\buseEffect\b|\buseState\b/);
  assert.match(directory, /role="alert"/);
  assert.match(directory, /aria-live="polite"/);
  assert.doesNotMatch(directory, /error\.message|String\(error\)|message=\{error/);
});

test("agent detail distinguishes loader failure from not-found and offers contact", () => {
  const detail = readExisting("src/routes/agents_.$slug.tsx");

  assert.match(detail, /fetchNeonPublicAgentProfileBySlug/);
  assert.match(detail, /if \(!profile\) throw notFound\(\)/);
  assert.match(detail, /errorComponent:\s*AgentProfileError/);
  assert.match(detail, /notFoundComponent:\s*AgentNotFound/);
  assert.match(detail, /function AgentProfileError\(/);
  assert.match(detail, /role="alert"/);
  assert.match(detail, /aria-live="polite"/);
  assert.match(detail, /to="\/contact"/);
  assert.doesNotMatch(detail, /error\.message|String\(error\)|message=\{error/);
  assert.match(detail, /查看代理放盤/);
  assert.match(detail, /name: "description"/);
});

test("agent CMS source and generated tree register all three admin paths", () => {
  const routeTree = read("src/routeTree.gen.ts");
  const routes = [
    {
      file: "src/routes/admin.agents.tsx",
      routeId: "/admin/agents",
      generatedName: "AdminAgentsRoute",
      generatedPath: "/agents",
    },
    {
      file: "src/routes/admin.agents_.new.tsx",
      routeId: "/admin/agents_/new",
      generatedName: "AdminAgentsNewRoute",
      generatedPath: "/agents/new",
    },
    {
      file: "src/routes/admin.agents_.$id.tsx",
      routeId: "/admin/agents_/$id",
      generatedName: "AdminAgentsIdRoute",
      generatedPath: "/agents/$id",
    },
  ];

  for (const route of routes) {
    assert.equal(existsSync(join(root, route.file)), true, `${route.file} should exist`);
    assert.match(
      read(route.file),
      new RegExp(`createFileRoute\\("${route.routeId.replace("$", "\\$")}"\\)`),
    );

    const block = generatedRouteBlock(routeTree, route.generatedName);
    assert.match(block, new RegExp(`path: ['"]${route.generatedPath.replace("$", "\\$")}['"]`));
    assert.match(block, /getParentRoute: \(\) => AdminRoute/);
  }

  const list = read("src/routes/admin.agents.tsx");
  assert.match(list, /fetchAdminAgentProfiles/);
  assert.match(list, /AdminEmptyState/);
  assert.doesNotMatch(list, /deleteAdminAgentProfile|刪除代理/i);
});

test("new and edit agent route loaders pass only the server-derived identity capability", () => {
  for (const file of ["src/routes/admin.agents_.new.tsx", "src/routes/admin.agents_.$id.tsx"]) {
    const source = readExisting(file);
    assert.match(source, /fetchAdminAgentEditorContext/);
    assert.match(source, /loader:\s*(?:async\s*)?\(\)\s*=>\s*fetchAdminAgentEditorContext\(\)/);
    assert.match(source, /Route\.useLoaderData\(\)/);
    assert.match(source, /canManageIdentity=\{editorContext\.canManageIdentity\}/);
    assert.equal(
      (source.match(/fetchAdminAgentEditorContext\(\)/g) ?? []).length,
      1,
      `${file} should obtain editor context only through its route loader`,
    );
    assert.doesNotMatch(source, /roles\.includes\(["']admin["']\)/);
  }

  const adminData = read("src/lib/neon/admin-data.ts");
  assert.match(
    adminData,
    /fetchAdminAgentEditorContext\([\s\S]*?catch \(error\)[\s\S]*?isStaffAuthorizationError\(error\)[\s\S]*?return null/,
  );
});

test("public profile projection and routes exclude auth and role fields", () => {
  const types = read("src/lib/neon/public-data.types.ts");
  const server = read("src/lib/neon/public-data.server.ts");
  const publicRoutes = `${read("src/routes/agents.tsx")}\n${readExisting("src/routes/agents_.$slug.tsx")}`;
  const sensitive = /\b(auth_user_id|email|roles)\b/i;
  const typeBlock = types.match(/export type NeonPublicAgentProfile = \{[\s\S]*?\n\};/)?.[0] ?? "";
  const projection = server.match(/const publicAgentProfileColumns = `[\s\S]*?`;/)?.[0] ?? "";
  const mapper = server.match(/function mapPublicAgentProfile\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(typeBlock, "public profile type should be explicit");
  assert.ok(projection, "public SQL projection should be explicit");
  assert.ok(mapper, "public profile mapper should be explicit");
  assert.doesNotMatch(typeBlock, sensitive);
  assert.doesNotMatch(projection, sensitive);
  assert.doesNotMatch(mapper, sensitive);
  assert.doesNotMatch(publicRoutes, sensitive);
});

test("branch is never defaulted in either agent route", () => {
  for (const file of ["src/routes/agents.tsx", "src/routes/agents_.$slug.tsx"]) {
    const source = readExisting(file);

    // Defaulting a missing branch to SITE_BRANCHES[0] printed 麗都分行 on the 15
    // agents based at 海韻 or 青山公路豪景 -- a confident wrong answer about named
    // real people. A blank is the correct rendering, and 董事 has no branch at all.
    assert.doesNotMatch(source, /(?:profile|agent)\.branch\s*\?\?/);
    assert.match(source, /\{branch \? </, `${file} must render branch conditionally`);

    // The derivation lives in resolveAgentContact so both routes cannot drift
    // again. No route may reintroduce a hardcoded branch fallback.
    assert.doesNotMatch(
      source,
      /DEFAULT_AGENT_BRANCH/,
      `${file} must not hardcode a default branch`,
    );
    assert.doesNotMatch(
      source,
      /SITE_BRANCHES\s*\[\s*0\s*\]/,
      `${file} must not fall back to the first configured branch`,
    );
    assert.match(source, /resolveAgentContact/, `${file} must derive contact details centrally`);
  }
});

test("agent avatars and profile form include required accessibility details", () => {
  for (const file of ["src/routes/agents.tsx", "src/routes/agents_.$slug.tsx"]) {
    // AppImage renders a real <img> under the hood and defaults loading to "lazy"
    // internally (see src/components/media/AppImage.tsx), so callers no longer
    // spell out loading="lazy" in source. Match both tag names, but only require
    // the explicit attribute on a raw <img> -- an AppImage caller would have to
    // deliberately override the default to opt out of lazy loading.
    const images = [...readExisting(file).matchAll(/<(?:img|AppImage)[\s\S]*?\/>/g)].map(
      (match) => match[0],
    );
    assert.ok(images.length > 0, `${file} should render an avatar image`);
    for (const image of images) {
      if (image.startsWith("<img")) {
        assert.match(image, /loading="lazy"/);
      }
      assert.match(image, /width=\{\d+\}/);
      assert.match(image, /height=\{\d+\}/);
    }
  }

  const form = read("src/components/admin/AgentProfileForm.tsx");
  // The schema moved to agent-profile-form-utils.ts so the component file
  // exports only components. The validation assertions follow it rather than
  // being folded into `form` -- pointing them at the file that actually holds
  // the rules keeps them from passing vacuously.
  const formSchema = read("src/components/admin/agent-profile-form-utils.ts");
  assert.match(formSchema, /superRefine/);
  assert.match(formSchema, /請輸入中文或英文名稱/);
  assert.match(formSchema, /path:\s*\["name_zh"\]/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /aria-describedby/);
  assert.match(form, /\.focus\(\)/);
  assert.match(form, /name:\s*key/);
  assert.match(form, /autoComplete="name"/);
  assert.match(form, /autoComplete="email"/);
  assert.match(form, /autoComplete="tel"/);
  assert.doesNotMatch(form, /…/);

  for (const field of [
    "auth_user_id",
    "email",
    "name_zh",
    "name_en",
    "job_title",
    "phone",
    "whatsapp",
    "licence_no",
    "avatar_url",
    "branch",
    "branch_id",
    "bio",
    "specialties",
    "served_estate_slugs",
    "public_slug",
    "show_on_website",
    "display_order",
    "active",
  ]) {
    assert.match(form, new RegExp(`fieldProps\\("${field}"\\)`), `${field} needs form metadata`);
  }

  assert.match(form, /saveAdminAgentProfile/);
  assert.match(form, /canManageIdentity/);
  assert.match(form, /buildAgentProfilePayload/);
  assert.match(form, /agentProfileSchema/);
  assert.doesNotMatch(form, /deleteAdminAgentProfile|hard delete|刪除代理/i);
});

test("admin navigation includes agent management", () => {
  const shell = read("src/components/admin/AdminShell.tsx");
  assert.match(shell, /經紀檔案/);
  assert.match(shell, /to: "\/admin\/agents"/);
});

// PHASE 4 of the client revision supplied this description verbatim. It was applied
// to the homepage team section but not to /agents, which kept naming 荃灣西 — a
// district the client pruned from scope in PHASE 6. The two pages disagreed about
// where the agency operates.
test("the agents page uses the client's approved team description", () => {
  const source = readExisting("src/routes/agents.tsx");

  assert.match(
    source,
    /持牌代理團隊熟悉深井、青山公路及汀九市場，為買家、租客及業主提供直接、可靠的地產服務。/,
  );
  assert.doesNotMatch(source, /荃灣西/);
});

test("/agents has no component-local state -- filters are driven entirely by URL search params", () => {
  const source = readExisting("src/routes/agents.tsx");
  assert.doesNotMatch(source, /\buseEffect\b|\buseState\b/);
  assert.match(source, /validateSearch:\s*zodValidator\(agentsSearchSchema\)/);
  assert.match(source, /Route\.useSearch\(\)/);
});

test("matchesAgentFilters filters by name/branch/district/speciality/language independently", () => {
  const { matchesAgentFilters } = loadAgentFilterHelpers();

  const agent = fixtureAgent({
    name_zh: "陳大文",
    name_en: "Chan Tai Man",
    branch: "麗都分行",
    served_estate_slugs: ["bellagio"],
    specialties: ["豪宅"],
    languages: ["粵語", "英語"],
  });

  assert.equal(matchesAgentFilters(agent, {}), true, "no filters matches everyone");
  assert.equal(matchesAgentFilters(agent, { q: "大文" }), true, "zh name substring matches");
  assert.equal(matchesAgentFilters(agent, { q: "Tai" }), true, "en name substring matches");
  assert.equal(matchesAgentFilters(agent, { q: "陳小明" }), false, "non-matching name excludes");
  assert.equal(matchesAgentFilters(agent, { branch: "麗都分行" }), true);
  assert.equal(matchesAgentFilters(agent, { branch: "海韻分行" }), false);
  assert.equal(
    matchesAgentFilters(agent, { district: "sham-tseng" }),
    true,
    "district derives from served_estate_slugs via the estate registry",
  );
  assert.equal(matchesAgentFilters(agent, { district: "ting-kau" }), false);
  assert.equal(matchesAgentFilters(agent, { speciality: "豪宅" }), true);
  assert.equal(matchesAgentFilters(agent, { speciality: "村屋" }), false);
  assert.equal(matchesAgentFilters(agent, { language: "英語" }), true);
  assert.equal(matchesAgentFilters(agent, { language: "普通話" }), false);

  // Every provided filter must match simultaneously (AND semantics).
  assert.equal(matchesAgentFilters(agent, { branch: "麗都分行", language: "普通話" }), false);
});

test("matchesAgentFilters never lets a branch-less agent match a branch filter, and never crashes on an unknown estate slug", () => {
  const { matchesAgentFilters } = loadAgentFilterHelpers();

  const noBranch = fixtureAgent({ branch: null });
  assert.equal(matchesAgentFilters(noBranch, { branch: "麗都分行" }), false);

  const unknownEstate = fixtureAgent({ served_estate_slugs: ["not-a-real-estate"] });
  assert.doesNotThrow(() => matchesAgentFilters(unknownEstate, { district: "sham-tseng" }));
  assert.equal(matchesAgentFilters(unknownEstate, { district: "sham-tseng" }), false);
});

test("groupAgentsByBranch never folds a branch-less agent into a named branch, and never labels its group with a guessed branch name", () => {
  const { groupAgentsByBranch } = loadAgentFilterHelpers();

  const agents = [
    fixtureAgent({ id: "a1", branch: "海韻分行" }),
    fixtureAgent({ id: "a2", branch: "麗都分行" }),
    fixtureAgent({ id: "a3", branch: null }),
    fixtureAgent({ id: "a4", branch: "麗都分行" }),
  ];

  const groups = groupAgentsByBranch(agents);

  const unassignedGroup = groups.find((g) => g.branch === null);
  assert.ok(unassignedGroup, "branch-less agents get their own null-branch group");
  assert.deepEqual(
    unassignedGroup.agents.map((a) => a.id),
    ["a3"],
  );
  // Never any named branch's members absorb the branch-less agent, and the
  // null group is never itself relabelled with a real branch's name.
  for (const group of groups) {
    if (group.branch !== null) {
      assert.ok(!group.agents.some((a) => a.id === "a3"));
    }
  }

  const lidoGroup = groups.find((g) => g.branch === "麗都分行");
  assert.deepEqual(
    lidoGroup.agents.map((a) => a.id),
    ["a2", "a4"],
  );
});

test("matchesAgentFilters and groupAgentsByBranch prefer a branch_id match over the free-text branch, and never guess when neither resolves", () => {
  const { matchesAgentFilters, groupAgentsByBranch } = loadAgentFilterHelpers();
  const branches = [{ id: "branch-uuid-1", slug: "rhine", name: "海韻分行" }];

  // branch_id resolves to 海韻分行 even though the stale free-text column
  // still says 麗都分行 -- the linked DB row must win, not the old string.
  const linked = fixtureAgent({ id: "linked", branch: "麗都分行", branch_id: "branch-uuid-1" });
  assert.equal(matchesAgentFilters(linked, { branch: "海韻分行" }, branches), true);
  assert.equal(matchesAgentFilters(linked, { branch: "麗都分行" }, branches), false);

  // branch_id set but pointing at nothing in the fetched list (e.g. a
  // branches fetch that failed and returned []) falls back to the free-text
  // string -- never a crash, never branches[0].
  const danglingId = fixtureAgent({ id: "dangling", branch: "麗都分行", branch_id: "not-in-list" });
  assert.equal(matchesAgentFilters(danglingId, { branch: "麗都分行" }, branches), true);

  // Neither branch_id nor branch set: never falls back to branches[0] or any
  // guessed name -- this is the regression case for CHANGELOG.md:79-87.
  const neither = fixtureAgent({ id: "neither", branch: null, branch_id: null });
  assert.equal(matchesAgentFilters(neither, { branch: "海韻分行" }, branches), false);
  assert.equal(matchesAgentFilters(neither, {}, branches), true, "no filter still matches");

  const groups = groupAgentsByBranch([linked, neither], branches);
  const rhineGroup = groups.find((g) => g.branch === "海韻分行");
  assert.ok(rhineGroup, "branch_id-linked agent groups under the real branch name");
  assert.deepEqual(
    rhineGroup.agents.map((a) => a.id),
    ["linked"],
  );
  const unassignedGroup = groups.find((g) => g.branch === null);
  assert.deepEqual(
    unassignedGroup.agents.map((a) => a.id),
    ["neither"],
    "an agent with neither branch_id nor branch renders in no named group, never a guessed one",
  );
});

test("agents_.$slug.tsx's 查看代理放盤 button links to /listings scoped to this agent's real id", () => {
  const detail = readExisting("src/routes/agents_.$slug.tsx");
  assert.match(
    detail,
    /<Link to="\/listings" search={{ deal: "all", page: 1, agent: profile\.id }}>/,
  );
});

test("/listings' Zod search schema exposes the agent param the profile CTA now links to", () => {
  const listings = read("src/routes/listings.tsx");
  const schemaBody = listings.slice(
    listings.indexOf("const searchSchema = z.object({"),
    listings.indexOf("});", listings.indexOf("const searchSchema = z.object({")),
  );
  assert.match(schemaBody, /agent:\s*fallback\(z\.string\(\)\.optional\(\), undefined\)/);

  // Threaded into the loader as agentId -- the field NeonListingFiltersInput
  // and listingWhere() (public-data.server.ts) already read to scope
  // results via `p.agent_id = ...` (proven directly against the query layer
  // by listing-search.contract.test.mjs's "agentId scopes results to one
  // agent's listings" test).
  assert.match(listings, /agentId:\s*deps\.agent,/);

  // FilterFields' apply() must forward the already-active agent scope
  // through unchanged -- otherwise touching any OTHER filter while viewing
  // an agent-scoped /listings page would silently drop back to browsing
  // every agent's listings.
  const applyBody = listings.slice(
    listings.indexOf("function apply()"),
    listings.indexOf("function reset()"),
  );
  assert.match(applyBody, /agent:\s*initial\.agent,/);
});
