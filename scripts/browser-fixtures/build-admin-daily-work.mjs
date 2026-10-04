import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/daily-work");
const shared = resolve(workspace, "scripts/browser-fixtures/no-link");
const output = resolve(workspace, ".audit/daily-work-browser");
assert.equal(dirname(output), resolve(workspace, ".audit"));
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_DAILY_WORK_",
  resolve: {
    alias: [
      {
        find: /^@\/lib\/analytics\/(sales-performance-client|reporting-client)$/,
        replacement: resolve(shared, "synthetic-analytics.ts"),
      },
      {
        find: /^@\/lib\/admin\/final-fix-rollout$/,
        replacement: resolve(shared, "synthetic-flags.ts"),
      },
      {
        find: /^@\/lib\/(neon\/(admin-data|admin-team|whatsapp-assignment|staff-notifications|enquiry-resolution|forwarded-enquiries)|admin\/operations\/operations-client)$/,
        replacement: resolve(root, "synthetic-api.ts"),
      },
      { find: /^@\/(auth|hooks\/use-neon-auth)$/, replacement: resolve(root, "auth.ts") },
      { find: "@", replacement: resolve(workspace, "src") },
    ],
  },
  plugins: [
    react(),
    tailwind(),
    {
      name: "forbid-server-imports",
      resolveId(id) {
        if (/\.server(?:\.|$)|server-only/.test(id)) throw Error(`Server module forbidden: ${id}`);
      },
    },
  ],
  build: { outDir: output, emptyOutDir: true, minify: false },
});
