import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/property-maintenance");
const output = resolve(workspace, ".audit/property-maintenance-browser");
assert.equal(dirname(output), resolve(workspace, ".audit"));
const api = resolve(root, "synthetic-api.ts");
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_PROPERTY_BROWSER_",
  resolve: {
    alias: [
      {
        find: /^@\/lib\/(admin\/final-fix-rollout|neon\/(admin-data|whatsapp-assignment|inbox-directory|whatsapp-readiness|staff-endpoints|staff-reference-admin|whatsapp-service-policy|whatsapp-test-notification))$/,
        replacement: resolve(root, "synthetic-staff.ts"),
      },
      {
        find: /^@\/lib\/(admin\/operations\/operations-client|neon\/whatsapp-service-health)$/,
        replacement: resolve(root, "synthetic-operations.ts"),
      },
      {
        find: /^@\/(auth|hooks\/use-neon-auth|lib\/admin\/media-upload|lib\/neon\/(admin-data|admin-properties|admin-property-bulk|whatsapp-link-selection))$/,
        replacement: api,
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
  build: { outDir: output, emptyOutDir: true, minify: false },
});
