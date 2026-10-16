import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/admin-layout");
const daily = resolve(workspace, "scripts/browser-fixtures/daily-work");
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_ADMIN_LAYOUT_",
  resolve: {
    alias: [
      {
        find: /^@\/lib\/neon\/(inbox-directory|whatsapp-readiness|staff-endpoints|staff-reference-admin|whatsapp-service-policy|whatsapp-test-notification)$/,
        replacement: resolve(
          workspace,
          "scripts/browser-fixtures/property-maintenance/synthetic-staff.ts",
        ),
      },
      {
        find: /^@\/lib\/(admin\/operations\/operations-client|neon\/whatsapp-service-health)$/,
        replacement: resolve(root, "operations-reads.ts"),
      },
      {
        find: /^@\/lib\/neon\/admin-property-sync$/,
        replacement: resolve(root, "sync-reads.ts"),
      },
      {
        find: /^@\/lib\/neon\/whatsapp-link-batches$/,
        replacement: resolve(
          workspace,
          "scripts/browser-fixtures/link-bulk-owned/synthetic-batches.ts",
        ),
      },
      {
        find: /^@\/lib\/(neon\/(whatsapp-link-import|whatsapp-enquiries|whatsapp-link-management|whatsapp-coverage)|admin\/whatsapp-link-export-api)$/,
        replacement: resolve(
          workspace,
          "scripts/browser-fixtures/link-bulk-owned/synthetic-api.ts",
        ),
      },
      {
        find: /^@\/lib\/(neon\/(admin-properties|admin-property-bulk|whatsapp-link-selection)|admin\/media-upload|ai\/content-copilot-admin)$/,
        replacement: resolve(root, "property-reads.ts"),
      },
      {
        find: /^@\/lib\/neon\/admin-cms$/,
        replacement: resolve(root, "cms-reads.ts"),
      },

      {
        find: /^@\/lib\/analytics\/(sales-performance-client|reporting-client)$/,
        replacement: resolve(root, "analytics-reads.ts"),
      },
      {
        find: /^@\/lib\/neon\/contact-identity-review$/,
        replacement: resolve(daily, "identity-review-api.ts"),
      },
      {
        find: /^@\/lib\/(neon\/(admin-data|admin-team|whatsapp-assignment|staff-notifications|staff-checklist|enquiry-resolution|forwarded-enquiries)|admin\/operations\/operations-client)$/,
        replacement: resolve(root, "read-scenarios.ts"),
      },
      { find: /^@\/(auth|hooks\/use-neon-auth)$/, replacement: resolve(daily, "auth.ts") },
      {
        find: /^@\/lib\/youtube-sync\/youtube-status$/,
        replacement: resolve(workspace, "scripts/browser-fixtures/youtube-sync-status.ts"),
      },
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
