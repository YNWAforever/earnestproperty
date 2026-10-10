import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/property-sync");
const output = resolve(workspace, ".audit/property-sync-browser");
assert.equal(dirname(output), resolve(workspace, ".audit"));
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_SYNC_BROWSER_",
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
        find: /^@\/(auth|hooks\/use-neon-auth|lib\/neon\/(admin-data|admin-property-sync))$/,
        replacement: resolve(root, "synthetic-api.ts"),
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
