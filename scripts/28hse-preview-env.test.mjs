import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";
import { previewDeploymentDefines } from "./28hse-preview-env.mjs";

const source = readFileSync(
  new URL("../src/lib/saved-listings-preview.ts", import.meta.url),
  "utf8",
);

async function enabled(env) {
  const { code } = await transform(source, {
    loader: "ts",
    format: "esm",
    define: {
      ...previewDeploymentDefines(env),
      "import.meta.env.VITE_28HSE_PREVIEW": JSON.stringify(env.VITE_28HSE_PREVIEW ?? ""),
    },
  });
  return (await import(`data:text/javascript,${encodeURIComponent(code)}`)).savedListingsPreview;
}

test("actual client/SSR gate automatically enables Vercel previews without the explicit flag", async () => {
  assert.equal(await enabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(await enabled({ VITE_VERCEL_ENV: "preview" }), true);
  assert.equal(await enabled({ VERCEL_ENV: "preview", VITE_28HSE_PREVIEW: "false" }), true);
});

test("production, development, and local remain off unless explicitly enabled", async () => {
  for (const env of [
    {},
    { VERCEL_ENV: "development" },
    { VERCEL_ENV: "production" },
    { VITE_VERCEL_ENV: "production" },
    { VERCEL_ENV: "production", VITE_VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development", VITE_VERCEL_ENV: "preview" },
  ]) {
    assert.equal(await enabled(env), false, JSON.stringify(env));
    assert.equal(await enabled({ ...env, VITE_28HSE_PREVIEW: "true" }), true);
    assert.equal(await enabled({ ...env, VITE_28HSE_PREVIEW: "false" }), false);
  }
});

test("build exposure contains only the non-secret deployment label", () => {
  assert.deepEqual(previewDeploymentDefines({ VERCEL_ENV: "preview", DATABASE_URL: "private" }), {
    "import.meta.env.VITE_VERCEL_ENV": '"preview"',
  });
  assert.deepEqual(previewDeploymentDefines({}), {
    "import.meta.env.VITE_VERCEL_ENV": '""',
  });
});
