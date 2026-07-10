import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("agent directory routes use the Task 1 public profile helpers", () => {
  const directory = read("src/routes/agents.tsx");
  const detailPath = "src/routes/agents.$slug.tsx";

  assert.equal(existsSync(join(root, detailPath)), true, "agent detail route should exist");
  const detail = read(detailPath);

  assert.match(directory, /fetchNeonPublicAgentProfiles/);
  assert.match(directory, /未有可公開顯示的代理資料/);
  assert.match(directory, /電話聯絡/);
  assert.match(directory, /WhatsApp/);
  assert.match(detail, /createFileRoute\("\/agents\/\$slug"\)/);
  assert.match(detail, /fetchNeonPublicAgentProfileBySlug/);
  assert.match(detail, /notFound\(\)/);
  assert.match(detail, /查看代理放盤/);
  assert.match(detail, /name: "description"/);
});

test("agent CMS routes and form keep editable fields safe and omit hard delete", () => {
  const formPath = "src/components/admin/AgentProfileForm.tsx";
  assert.equal(existsSync(join(root, formPath)), true, "agent profile form should exist");

  const form = read(formPath);
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
    "public_slug",
    "show_on_website",
    "display_order",
    "active",
  ]) {
    assert.match(form, new RegExp(field), `${field} should be an explicit form field`);
  }
  assert.match(form, /saveAdminAgentProfile/);
  assert.doesNotMatch(form, /deleteAdminAgentProfile|hard delete|刪除代理/i);

  for (const [file, route] of [
    ["src/routes/admin.agents.tsx", "/admin/agents"],
    ["src/routes/admin.agents_.new.tsx", "/admin/agents_/new"],
    ["src/routes/admin.agents_.$id.tsx", "/admin/agents_/$id"],
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
    assert.match(
      read(file),
      new RegExp(`createFileRoute\\("${route.replaceAll("/", "\\/").replace("$", "\\$")}`),
    );
  }

  const list = read("src/routes/admin.agents.tsx");
  assert.match(list, /fetchAdminAgentProfiles/);
  assert.match(list, /AdminEmptyState/);
  assert.doesNotMatch(list, /deleteAdminAgentProfile|刪除代理/i);
});

test("admin navigation and route tree include the agent CMS", () => {
  const shell = read("src/components/admin/AdminShell.tsx");
  const routeTree = read("src/routeTree.gen.ts");

  assert.match(shell, /代理管理/);
  assert.match(shell, /to: "\/admin\/agents"/);
  assert.match(routeTree, /['"]\/admin\/agents['"]/);
  assert.match(routeTree, /['"]\/agents\/\$slug['"]/);
});
