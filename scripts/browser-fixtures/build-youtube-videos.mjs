import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const workspace = resolve(import.meta.dirname, "../..");
assert.equal(resolve(process.cwd()), workspace, "Run from the owned repository root");
const root = resolve(workspace, "scripts/browser-fixtures/youtube-videos");
const output = resolve(workspace, ".audit/youtube-videos-browser");
assert.equal(dirname(output), resolve(workspace, ".audit"));

function isolationPlugin() {
  return {
    name: "youtube-fixture-forbid-real-clients",
    enforce: "pre",
    resolveId(id) {
      if (
        /\.server(?:\.|$)|server-only|@neondatabase\/|@tanstack\/react-start/.test(id) ||
        /^@\/(?:auth|hooks\/use-neon-auth|lib\/neon)(?:\/|$)/.test(id)
      ) {
        throw new Error(`Real server/auth/database module forbidden in synthetic fixture: ${id}`);
      }
    },
    moduleParsed({ id }) {
      const normalized = id.replaceAll("\\", "/");
      if (
        /\/src\/(?:auth\.|lib\/neon\/|lib\/queries\.|lib\/analytics\/events\.|lib\/youtube-sync\/youtube-status\.)/.test(
          normalized,
        ) &&
        !normalized.endsWith(".types.ts")
      ) {
        throw new Error(`Synthetic boundary alias was bypassed: ${id}`);
      }
    },
  };
}

const alias = [
  { find: /^@tanstack\/react-router$/, replacement: resolve(root, "router.ts") },
  { find: /^@\/lib\/queries$/, replacement: resolve(root, "synthetic-queries.ts") },
  {
    find: /^@\/lib\/youtube-sync\/youtube-status$/,
    replacement: resolve(root, "synthetic-status.ts"),
  },
  { find: /^@\/lib\/analytics\/events$/, replacement: resolve(root, "synthetic-analytics.ts") },
  { find: /^@\/config\/site$/, replacement: resolve(root, "synthetic-site.ts") },
  { find: "@", replacement: resolve(workspace, "src") },
];

await build({
  configFile: false,
  root,
  envDir: false,
  envPrefix: "OWNED_YOUTUBE_FIXTURE_",
  publicDir: false,
  resolve: { alias },
  plugins: [react(), tailwind(), isolationPlugin()],
  build: { outDir: output, emptyOutDir: true, minify: false },
});

await build({
  configFile: false,
  root,
  envDir: false,
  envPrefix: "OWNED_YOUTUBE_FIXTURE_",
  publicDir: false,
  resolve: { alias },
  plugins: [react(), isolationPlugin()],
  build: {
    ssr: resolve(root, "status-ssr.tsx"),
    outDir: resolve(output, "ssr"),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { entryFileNames: "status.mjs" } },
  },
});
