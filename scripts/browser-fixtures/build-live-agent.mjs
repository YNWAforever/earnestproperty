import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace);
const root = resolve(workspace, "scripts/browser-fixtures/live-agent");
const output = resolve(workspace, ".audit/live-agent-browser");
assert.equal(dirname(output), resolve(workspace, ".audit"));
await build({
  configFile: false,
  root,
  envDir: root,
  envPrefix: "OWNED_LIVE_AGENT_",
  resolve: {
    alias: [{ find: "@", replacement: resolve(workspace, "src") }],
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
