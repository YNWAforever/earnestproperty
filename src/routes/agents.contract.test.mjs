import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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
