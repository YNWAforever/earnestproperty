import { mock } from "node:test";
import { withOwnedPostgres, mockOwnedServerDb } from "./acceptance/owned-postgres-test.mjs";
const { refuseExternalTargets, seedSessions, runAcceptance } =
  await import("./blog-cms/acceptance-scenario.mjs");

refuseExternalTargets();
process.env.NEON_AUTH_BASE_URL = "http://127.0.0.1/owned-auth-fixture";
process.env.ADMIN_BOOTSTRAP_EMAILS = "";
await withOwnedPostgres(async (owned) => {
  await mockOwnedServerDb(mock, owned.query, owned.transaction);
  await seedSessions(owned.query);
  const service = await import("../src/lib/neon/blog-admin.server.ts");
  const pub = await import("../src/lib/neon/blog-public.server.ts");
  const request = (role = "admin") =>
    new Request("http://127.0.0.1/owned", { headers: { authorization: "Bearer task8-" + role } });
  await runAcceptance({
    owned,
    api: {
      list: (data, role) => service.listBlogArticles(data, request(role)),
      save: (data, role) => service.saveBlogArticle(data, request(role)),
      preview: (data, role) => service.getArticlePreview(data.id, request(role)),
      state: () => service.getBlogAdminState(request()),
      settings: (data) => service.saveBlogSettings(data, request()),
      category: (data) => service.saveBlogCategory(data, request()),
    },
    publicApi: { page: pub.getPublicBlogPage, article: pub.getPublicBlogArticle },
  });
});
