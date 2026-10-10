import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace, "Run fixture build from this checkout root");
const root = resolve(workspace, "scripts/browser-fixtures/no-link");
const outputKind = process.argv[2];
assert.ok(outputKind === undefined || outputKind === "mobile-ai", "Unknown owned fixture output");
const output = resolve(
  workspace,
  outputKind === "mobile-ai" ? ".audit/no-link-browser-mobile-ai" : ".audit/no-link-browser",
);
assert.equal(
  dirname(output),
  resolve(workspace, ".audit"),
  "Build cleanup stays in this checkout's audit directory",
);
const api = resolve(root, "synthetic-api.ts");
const auth = resolve(root, "auth.ts");
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "NO_LINK_BROWSER_BUILD_",
  resolve: {
    alias: [
      {
        find: /^@\/lib\/neon\/staff-checklist$/,
        replacement: resolve(
          workspace,
          "scripts/browser-fixtures/no-link/synthetic-staff-checklist.ts",
        ),
      },
      {
        find: /^@\/lib\/analytics\/(sales-performance-client|reporting-client)$/,
        replacement: resolve(root, "synthetic-analytics.ts"),
      },
      {
        // FX-12: the leads route bundles the 可能重複客戶 list; its server calls stay synthetic.
        find: /^@\/lib\/neon\/contact-identity-review$/,
        replacement: resolve(
          workspace,
          "scripts/browser-fixtures/daily-work/identity-review-api.ts",
        ),
      },
      {
        find: /^@\/lib\/neon\/(admin-data|whatsapp-assignment|staff-notifications|enquiry-resolution|forwarded-enquiries)$/,
        replacement: api,
      },
      { find: /^@\/(auth|hooks\/use-neon-auth)$/, replacement: auth },
      {
        find: /^@\/lib\/(neon\/admin-team|admin\/operations\/operations-client)$/,
        replacement: api,
      },
      { find: "@", replacement: resolve("src") },
    ],
  },
  plugins: [
    react(),
    tailwind(),
    {
      name: "forbid-server-modules-in-synthetic-browser",
      resolveId(id) {
        if (/\.server(?:\.|$)|server-only/.test(id))
          throw Error(`Server module forbidden in browser fixture: ${id}`);
      },
    },
  ],
  build: { outDir: output, emptyOutDir: true, minify: false },
});
