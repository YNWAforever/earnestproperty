import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/admin-layout");
const daily = resolve(workspace, "scripts/browser-fixtures/daily-work");
const shared = resolve(workspace, "scripts/browser-fixtures/no-link");
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_ADMIN_LAYOUT_",
  resolve: {
    alias: [
      { find: /^@\/lib\/(neon\/(admin-properties|admin-property-bulk|whatsapp-link-selection)|admin\/media-upload|ai\/content-copilot-admin)$/, replacement: resolve(workspace,"scripts/browser-fixtures/property-maintenance/synthetic-api.ts") },
      { find: /^@\/lib\/neon\/admin-cms$/, replacement: resolve(workspace,"scripts/browser-fixtures/leave-guards/synthetic-cms.ts") },

      {
        find: /^@\/lib\/analytics\/(sales-performance-client|reporting-client)$/,
        replacement: resolve(shared, "synthetic-analytics.ts"),
      },
      {
        find: /^@\/lib\/neon\/contact-identity-review$/,
        replacement: resolve(daily, "identity-review-api.ts"),
      },
      {
        find: /^@\/lib\/(neon\/(admin-data|admin-team|whatsapp-assignment|staff-notifications|staff-checklist|enquiry-resolution|forwarded-enquiries)|admin\/operations\/operations-client)$/,
        replacement: resolve(root, "synthetic-api.ts"),
      },
      { find: /^@\/(auth|hooks\/use-neon-auth)$/, replacement: resolve(daily, "auth.ts") },
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
  build: {
    outDir: resolve(workspace, ".audit/admin-layout-browser"),
    emptyOutDir: true,
    minify: false,
  },
});
