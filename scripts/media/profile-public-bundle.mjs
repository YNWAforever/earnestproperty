import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
const directory = ".output/server";
const file = fs.readdirSync(directory).find((name) => name.startsWith("_tanstack-start-manifest"));
const source =
  fs.readFileSync(path.join(directory, file), "utf8").replace(/export\s*\{[\s\S]*$/, "") +
  ";tsrStartManifest";
const factory = vm.runInNewContext(source, {}, { timeout: 1000 });
const manifest = typeof factory === "function" ? factory() : factory;
const metadata = manifest.routes ?? manifest;
const files = fs
  .readdirSync(".output/public/assets")
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const bytes = fs.readFileSync(path.join(".output/public/assets", name));
    return { file: name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  })
  .sort((a, b) => b.bytes - a.bytes);
const report = {
  method: "Existing last-built bundle, raw and gzip file bytes; not browser transfer",
  entry: manifest.clientEntry,
  rootPreloads: metadata.__root__?.preloads ?? [],
  homePreloads: metadata["/"]?.preloads ?? [],
  largestJavaScript: files.slice(0, 8),
};
fs.writeFileSync(
  "docs/audits/astra-task-8-bundle-profile.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
