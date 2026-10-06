import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// FX-10a (C-07): the prebuild guard checks the WhatsApp intake configuration.
// Production builds are blocked; preview builds only warn. Output names the
// variables and never prints their values.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(extra = {}, base = true) {
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    ...(base
      ? {
          VERCEL_ENV: "production",
          VITE_SITE_URL: "https://www.example.test",
          VITE_CONTACT_WHATSAPP_PHONE: "85291234567",
          VITE_CONTACT_PHONE_DISPLAY: "9123 4567",
          VITE_CONTACT_PHONE_TEL: "+85291234567",
        }
      : {}),
    ...extra,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const result = spawnSync(process.execPath, ["scripts/check-required-env.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

const COMPLETE = {
  WOZTELL_ENABLED: "true",
  WOZTELL_APP_ID: "fx10a-app-id-value",
  WOZTELL_CHANNEL_ID: "fx10a-channel-value",
  WOZTELL_CHANNEL_SECRET: "fx10a-secret-value",
  EP_WA_TRACKED_LINKS_ENABLED: "true",
  EP_WA_COMPANY_CHANNEL_ID: "fx10a-company-channel",
  EP_WA_COMPANY_PHONE: "85291234567",
};
const SECRET_VALUES = [
  "fx10a-app-id-value",
  "fx10a-channel-value",
  "fx10a-secret-value",
  "fx10a-company-channel",
];

function without(name, overrides = {}) {
  const env = { ...COMPLETE, ...overrides };
  delete env[name];
  return env;
}

const intakeGaps = ["WOZTELL_APP_ID", "WOZTELL_CHANNEL_ID", "WOZTELL_CHANNEL_SECRET"].map(
  (name) => ({ name, env: without(name) }),
);
const trackedGaps = [
  { name: "EP_WA_COMPANY_CHANNEL_ID", env: without("EP_WA_COMPANY_CHANNEL_ID") },
  {
    name: "EP_WA_COMPANY_CHANNEL_ID",
    env: { ...COMPLETE, EP_WA_COMPANY_CHANNEL_ID: "c".repeat(161) },
  },
  {
    name: "EP_WA_COMPANY_PHONE",
    env: { ...COMPLETE, EP_WA_COMPANY_PHONE: "85200000000" },
    phone: "85200000000",
  },
  {
    name: "EP_WA_COMPANY_PHONE",
    env: { ...COMPLETE, EP_WA_COMPANY_PHONE: "+85291234567" },
    phone: "+85291234567",
  },
  { name: "EP_WA_COMPANY_PHONE", env: without("EP_WA_COMPANY_PHONE") },
  // Whitespace: blank counts as missing (as for WOZTELL_*), and because the runtime
  // reads these values raw (no trim), a padded value is unusable and is flagged too.
  { name: "EP_WA_COMPANY_CHANNEL_ID", env: { ...COMPLETE, EP_WA_COMPANY_CHANNEL_ID: "   " } },
  {
    name: "EP_WA_COMPANY_CHANNEL_ID",
    env: { ...COMPLETE, EP_WA_COMPANY_CHANNEL_ID: " fx10a-company-channel " },
  },
  { name: "EP_WA_COMPANY_PHONE", env: { ...COMPLETE, EP_WA_COMPANY_PHONE: "   " } },
  {
    name: "EP_WA_COMPANY_PHONE",
    env: { ...COMPLETE, EP_WA_COMPANY_PHONE: " 85291234567 " },
    phone: "85291234567 ",
  },
];

test("production: WOZTELL_ENABLED=true without an intake variable blocks the build", () => {
  for (const { name, env } of intakeGaps) {
    const r = run(env);
    assert.equal(r.status, 1, `${name}: ${r.output}`);
    assert.ok(r.stderr.includes(name), `${name} named in stderr`);
    for (const value of SECRET_VALUES)
      assert.ok(!r.output.includes(value), `${name}: output leaks ${value}`);
  }
});

test("production: tracked links on without a usable company phone or channel blocks the build", () => {
  for (const { name, env, phone } of trackedGaps) {
    const r = run(env);
    assert.equal(r.status, 1, `${name}: ${r.output}`);
    assert.ok(r.stderr.includes(name), `${name} named in stderr`);
    if (phone) assert.ok(!r.stderr.includes(phone), `${name}: stderr leaks the phone`);
    assert.ok(!r.output.includes("c".repeat(161)), "channel value not printed");
    assert.ok(!r.output.includes("fx10a-company-channel"), `${name}: channel value not printed`);
  }
});

test("preview builds only warn", () => {
  for (const { name, env } of [...intakeGaps, ...trackedGaps]) {
    const r = run({ ...env, VERCEL_ENV: "preview" });
    assert.equal(r.status, 0, `${name}: ${r.output}`);
    assert.ok(r.output.includes("[check-required-env] warning (preview)"), name);
    assert.ok(r.output.includes(name), name);
  }
});

test("flags off requires nothing new", () => {
  assert.equal(run().status, 0);
  const r = run({ WOZTELL_ENABLED: "false", EP_WA_TRACKED_LINKS_ENABLED: "false" });
  assert.equal(r.status, 0, r.output);
  assert.ok(!r.output.includes("warning (preview)"));
});

test("complete production configuration passes and never prints values", () => {
  const r = run(COMPLETE);
  assert.equal(r.status, 0, r.output);
  for (const value of Object.values(COMPLETE).filter((v) => v !== "true"))
    assert.ok(!r.output.includes(value), `output leaks ${value}`);
});

test("local builds are unaffected", () => {
  const r = run({}, false);
  assert.equal(r.status, 0, r.output);
});
