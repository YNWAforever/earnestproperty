import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  // Neither accepted channel name: WOZTELL_CHANNEL_ID is also an intake value, so
  // intake stays off here to isolate the tracked-link check.
  {
    name: "EP_WA_COMPANY_CHANNEL_ID",
    env: without("EP_WA_COMPANY_CHANNEL_ID", {
      WOZTELL_ENABLED: "false",
      WOZTELL_CHANNEL_ID: undefined,
    }),
  },
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
  // Old name unset and the surviving name unusable at runtime (padded: the CTA guard
  // trims, the runtime does not).
  {
    name: "EP_WA_COMPANY_PHONE",
    env: without("EP_WA_COMPANY_PHONE", { VITE_CONTACT_WHATSAPP_PHONE: " 85291234567 " }),
    phone: "85291234567 ",
  },
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

// FX-19c-1: the consolidated names. Channel = EP_WA_COMPANY_CHANNEL_ID, else
// WOZTELL_CHANNEL_ID; phone = EP_WA_COMPANY_PHONE, else VITE_CONTACT_WHATSAPP_PHONE;
// tracked links, when the old switch is unset, are on in observe/active mode.
const NEW_ONLY = {
  WOZTELL_ENABLED: "true",
  WOZTELL_APP_ID: "fx10a-app-id-value",
  WOZTELL_CHANNEL_ID: "fx10a-channel-value",
  WOZTELL_CHANNEL_SECRET: "fx10a-secret-value",
  EP_WA_ENQUIRY_MODE: "active",
};

test("production: the surviving names alone pass with tracked links derived from the mode", () => {
  const r = run(NEW_ONLY);
  assert.equal(r.status, 0, r.output);
  for (const value of SECRET_VALUES) assert.ok(!r.output.includes(value), `output leaks ${value}`);
});

test("production: tracked links on with neither phone usable still blocks, naming both names", () => {
  for (const env of [
    { ...NEW_ONLY, VITE_CONTACT_WHATSAPP_PHONE: " 85291234567 " },
    {
      ...NEW_ONLY,
      EP_WA_TRACKED_LINKS_ENABLED: "true",
      EP_WA_ENQUIRY_MODE: undefined,
      VITE_CONTACT_WHATSAPP_PHONE: " 85291234567 ",
    },
    { ...NEW_ONLY, EP_WA_COMPANY_PHONE: "85200000000" },
  ]) {
    const r = run(env);
    assert.equal(r.status, 1, r.output);
    assert.ok(r.stderr.includes("EP_WA_COMPANY_PHONE"), r.stderr);
    assert.ok(r.stderr.includes("VITE_CONTACT_WHATSAPP_PHONE"), r.stderr);
    assert.ok(!r.stderr.includes("85291234567"), "phone not printed");
  }
});

test("production: tracked links on with neither channel name blocks, naming both names", () => {
  const r = run({ ...NEW_ONLY, WOZTELL_ENABLED: "false", WOZTELL_CHANNEL_ID: undefined });
  assert.equal(r.status, 1, r.output);
  assert.ok(r.stderr.includes("EP_WA_COMPANY_CHANNEL_ID"), r.stderr);
  assert.ok(r.stderr.includes("WOZTELL_CHANNEL_ID"), r.stderr);
});

test("production: tracked links on by the old switch with no enquiry mode ignore WOZTELL_CHANNEL_ID", () => {
  const r = run({
    ...NEW_ONLY,
    EP_WA_ENQUIRY_MODE: undefined,
    EP_WA_TRACKED_LINKS_ENABLED: "true",
  });
  assert.equal(r.status, 1, r.output);
  assert.ok(r.stderr.includes("EP_WA_COMPANY_CHANNEL_ID"), r.stderr);
  assert.ok(!r.output.includes("fx10a-channel-value"), "channel value not printed");
});

test("an explicit EP_WA_TRACKED_LINKS_ENABLED=false keeps tracked links off in active mode", () => {
  const r = run({
    ...NEW_ONLY,
    EP_WA_TRACKED_LINKS_ENABLED: "false",
    VITE_CONTACT_WHATSAPP_PHONE: " 85291234567 ",
  });
  assert.equal(r.status, 0, r.output);
});

// FX-19b-2: .env.example is the one list of environment variables. A static scan keeps it honest
// in both directions.
test("every non-VITE env var read in src/ or scripts/ is documented in .env.example, and every documented name is read somewhere", () => {
  // Names the platform or CI provides, or that tooling reads. They are deliberately not documented.
  const PLATFORM_PROVIDED =
    /^(VERCEL_.+|GITHUB_.+|GH_REPO|CI|NODE_ENV|NODE_TEST_CONTEXT|DEV|PATH|TZ)$/;
  // Knobs of tests, browser fixtures, acceptance runs and one-off scripts: never set in a deployment.
  const HARNESS_ONLY = /(^|_)TEST(_|$)|BROWSER|FIXTURE|^PLAYWRIGHT_|^MIGRATION_|^RECORD_|^MODE$/;
  // Files that only exercise the code; they are excluded from the "must be documented" direction.
  const isHarnessFile = (path) =>
    /\.(test|spec)\.|(^|\/)test-[^/]*$|(^|\/)(acceptance|browser-fixtures)\//.test(path);

  // Tracked files only: CI creates untracked trees (e.g. a Python .venv under
  // scripts/property-sync) whose third-party env reads are not ours to document.
  const files = execFileSync("git", ["ls-files", "--", "src", "scripts"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => /\.(?:[cm]?[jt]sx?|py)$/.test(path) && !path.endsWith(".d.ts"));

  const NAME = "[A-Z][A-Z0-9_]{2,}";
  const ENV_OBJECT = String.raw`(?:process\.env|import\.meta\.env|\benv|\benvironment)`;
  const readPatterns = [
    // process.env.X, import.meta.env.X, and env/environment/e aliases (`const e = process.env`)
    new RegExp(String.raw`(?:${ENV_OBJECT}|\be)\.(${NAME})\b`, "g"),
    new RegExp(String.raw`(?:${ENV_OBJECT}|os\.environ)\s*\[\s*["'](${NAME})["']\s*\]`, "g"),
    // helpers: optionalEnvironment(environment, "X"), readEnv("X"), os.environ.get("X"), os.getenv("X")
    new RegExp(
      String.raw`\b\w*(?:[Ee]nv\w*|getenv|environ\.get)\(\s*(?:\w+\s*,\s*)?["'](${NAME})["']`,
      "g",
    ),
  ];
  const read = new Map(); // name -> first non-test file that reads it
  const sources = [];
  for (const file of files) {
    const text = readFileSync(join(repoRoot, file), "utf8");
    sources.push({ file, text });
    if (isHarnessFile(file)) continue;
    for (const pattern of readPatterns) {
      for (const match of text.matchAll(pattern)) if (!read.has(match[1])) read.set(match[1], file);
    }
  }

  const example = readFileSync(join(repoRoot, ".env.example"), "utf8");
  // Active lines and commented-out (deprecated) ones both document a name.
  const documented = new Set(
    [...example.matchAll(new RegExp(String.raw`^#?\s*(${NAME})=`, "gm"))].map((m) => m[1]),
  );
  assert.ok(documented.size > 50, "the .env.example scan found too few names");

  const undocumented = [...read.entries()]
    .filter(
      ([name]) =>
        !documented.has(name) && !PLATFORM_PROVIDED.test(name) && !HARNESS_ONLY.test(name),
    )
    .map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(undocumented, [], "env vars read in code but missing from .env.example");

  // Reverse direction: a documented name must still appear in code (or a workflow) outside tests.
  const workflowDir = join(repoRoot, ".github/workflows");
  const workflowText = readdirSync(workflowDir)
    .map((name) => readFileSync(join(workflowDir, name), "utf8"))
    .join("\n");
  const unread = [...documented].filter((name) => {
    const word = new RegExp(String.raw`\b${name}\b`);
    const inCode = sources.some(({ file, text }) => !isHarnessFile(file) && word.test(text));
    return !inCode && !word.test(workflowText);
  });
  assert.deepEqual(unread, [], "names documented in .env.example that nothing reads");

  // VITE_ names are build-time and must be documented too.
  const viteRead = [...read.keys()].filter((name) => name.startsWith("VITE_"));
  assert.ok(viteRead.length > 0, "the scan found no VITE_ reads");
  for (const name of viteRead) assert.ok(documented.has(name), `${name} missing from .env.example`);
});
