// Node owns Playwright's child-process pipes; Bun on Windows hangs at Chromium launch.
// Resolve only this repository's TypeScript/alias imports, without loading environment files.
import { registerHooks } from "node:module";
import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extname, relative, resolve, sep } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inside = (path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !rel.includes(":");
};
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith("@/") ||
      (specifier.startsWith(".") && context.parentURL?.startsWith("file:"))
    ) {
      const path = specifier.startsWith("@/")
        ? resolve(root, "src", specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      if (inside(path) && !extname(path)) {
        for (const suffix of [".ts", ".tsx"])
          if (existsSync(path + suffix)) return next(pathToFileURL(path + suffix).href, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts") && inside(fileURLToPath(url)))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          fileName: fileURLToPath(url),
        }).outputText,
      };
    return next(url, context);
  },
});
