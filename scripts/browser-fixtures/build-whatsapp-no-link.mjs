import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace, "Run fixture build from this checkout root");
const root = resolve(workspace, "scripts/browser-fixtures/no-link");
const output = resolve(workspace, ".audit/no-link-browser");
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
        find: /^@\/lib\/neon\/(admin-data|whatsapp-assignment|staff-notifications|enquiry-resolution)$/,
        replacement: api,
      },
      { find: /^@\/(auth|hooks\/use-neon-auth)$/, replacement: auth },
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
