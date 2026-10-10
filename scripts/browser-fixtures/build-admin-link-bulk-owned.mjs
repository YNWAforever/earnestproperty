import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/link-bulk-owned");
const shared = resolve(workspace, "scripts/browser-fixtures/no-link");
const output = resolve(workspace, ".audit/link-bulk-owned-browser");
assert.equal(dirname(output), resolve(workspace, ".audit"));
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_LINK_BULK_",
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
        find: /^@\/lib\/neon\/whatsapp-link-batches$/,
        replacement: resolve(root, "synthetic-batches.ts"),
      },
      {
        find: /^@\/lib\/(neon\/(admin-data|admin-team|whatsapp-assignment|staff-notifications|enquiry-resolution|forwarded-enquiries|whatsapp-link-import|whatsapp-enquiries|whatsapp-link-management|whatsapp-coverage)|admin\/whatsapp-link-export-api)$/,
        replacement: resolve(root, "synthetic-api.ts"),
      },
      {
        find: /^@\/lib\/analytics\/(sales-performance-client|reporting-client)$/,
        replacement: resolve(shared, "synthetic-analytics.ts"),
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
