import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LIVE_AGENT_EVAL_CASES } from "../../src/lib/ai/live-agent-eval-cases.js";
import { assertLiveTarget, parseArgs, runLiveAgentEval } from "./live-agent-eval.mjs";

const SCRIPT = fileURLToPath(new URL("./live-agent-eval.mjs", import.meta.url));
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const PREVIEW = "https://earnestproperty-git-fix-fx-11-chatbot-ynwaforevers-projects.vercel.app";

const throwingFetch = () => {
  throw new Error("network_must_not_be_used");
};

const fixedReply = (c) => ({ kind: c.expect.kind, text: "固定回覆。", cards: [] });

function recordingFetch(replyFor = fixedReply) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ url: u, method: init.method ?? "GET", redirect: init.redirect, body: init.body });
    if (u.pathname === "/api/live-agent/session") {
      return Response.json({ id: SESSION_ID, status: "active", accessToken: "synthetic-token" });
    }
    if (u.pathname === "/api/live-agent/message") {
      const body = JSON.parse(init.body);
      const testCase = LIVE_AGENT_EVAL_CASES.find((c) => c.input === body.message);
      return Response.json({ handoffSuggested: false, reply: replyFor(testCase) });
    }
    return new Response("ok", { status: 200 });
  };
  return { fetchImpl, calls };
}

test("defaults to mock and never touches the network", async () => {
  const report = await runLiveAgentEval({ fetchImpl: throwingFetch });
  assert.equal(report.mode, "mock");
  assert.match(report.interpretation, /^MOCK ONLY: exercises graders and reporting;/);
  assert.equal(report.summary.graded, 20);
  assert.equal(report.summary.passed, 20);
  assert.equal(report.summary.skipped, 3);
  assert.equal(report.summary.failed, 0);
  assert.deepEqual(
    report.results.filter((r) => r.status === "skipped").map((r) => r.id),
    [13, 14, 15],
  );
  // A baseUrl is ignored in mock mode: even a production URL causes no call.
  const withUrl = await runLiveAgentEval({
    baseUrl: "https://www.earnestproperty.com",
    fetchImpl: throwingFetch,
  });
  assert.equal(withUrl.mode, "mock");
});

test("no flags: the CLI parser picks mock and the process makes no live call", () => {
  assert.deepEqual(parseArgs([]), { mode: "mock", baseUrl: null });
  assert.deepEqual(parseArgs(["--mock"]), { mode: "mock", baseUrl: null });
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.equal(JSON.parse(run.stdout).mode, "mock");
});

test("live mode needs an explicit preview URL", () => {
  assert.throws(() => parseArgs(["--live"]), /live_base_url_required/);
  assert.throws(() => parseArgs(["--live", "--base-url"]), /live_base_url_required/);
  assert.throws(() => parseArgs(["--fast"]), /invalid_arguments/);
  assert.throws(() => parseArgs(["--base-url", PREVIEW]), /invalid_arguments/);
  assert.throws(() => parseArgs(["--mock", "--live"]), /invalid_arguments/);
  assert.deepEqual(parseArgs(["--live", "--base-url", PREVIEW]), {
    mode: "live",
    baseUrl: PREVIEW,
  });
  const run = spawnSync(process.execPath, [SCRIPT, "--live"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /live_base_url_required/);
});

const REFUSED = [
  // the brief's cases
  "https://earnestproperty.vercel.app",
  "https://www.example.com",
  "ftp://x.vercel.app",
  "http://preview.vercel.app",
  // every production hostname, and variants of it
  "https://www.earnestproperty.com",
  "https://earnestproperty.com",
  "http://www.earnestproperty.com",
  "https://www.earnestproperty.com:443",
  "https://earnestproperty.com/api/live-agent",
  "HTTPS://WWW.EARNESTPROPERTY.COM",
  "https://EARNESTPROPERTY.VERCEL.APP",
  "https://earnestproperty.vercel.app.",
  "https://earnestproperty.vercel.app:443",
  "https://earnestproperty.vercel.app:8443",
  "https://earnestproperty.vercel.app./",
  "https://earnestproperty.vercel.app..",
  "https://www.earnestproperty.com.",
  "https://earnestproperty.com.:443",
  // credentials: the real host is after the @
  "https://preview.vercel.app@www.earnestproperty.com",
  "https://user@earnestproperty.vercel.app",
  "https://user:pw@preview.vercel.app",
  "https://x.vercel.app:pw@evil.example",
  "https://www.earnestproperty.com\\@preview.vercel.app",
  "https://www.earnestproperty.com%2F@preview.vercel.app",
  // lookalikes and suffix tricks
  "https://www.earnestproperty.com.evil.example",
  "https://evil-vercel.app",
  "https://vercel.app",
  "https://notvercel.app",
  "https://preview.vercel.app.evil.example",
  "https://preview.vercel.app.earnestproperty.com",
  "https://a.b.vercel.app",
  "https://earnestproperty.com.vercel.app",
  "https://www.earnestproperty.vercel.app",
  "https://preview.vercel.app%2eevil.example",
  "https://preview-vercel.app",
  // the main-branch alias tracks production
  "https://earnestproperty-git-main-ynwaforevers-projects.vercel.app",
  "https://earnestproperty-git-master-ynwaforevers-projects.vercel.app",
  "https://earnestproperty-git-main.vercel.app",
  "https://earnestproperty-git-main-fix-ynwaforevers-projects.vercel.app",
  // the project/team alias can point at production
  "https://earnestproperty-ynwaforevers-projects.vercel.app",
  "https://earnestproperty-team.vercel.app",
  "https://earnestproperty-git-ynwaforevers-projects.vercel.app",
  // deployment-hash URLs (production deployments have them too)
  "https://earnestproperty-9k2x3abcd-ynwaforevers-projects.vercel.app",
  "https://earnestproperty-abc123def.vercel.app",
  // other projects and tenants, including a branch alias under another team
  "https://earnestproperty-git-fix-fx-11-chatbot-earnest.vercel.app",
  "https://earnestproperty-git-feat-live-eval-acme-co.vercel.app",
  "https://earnestproperty-git-fix-ynwaforevers.vercel.app",
  "https://earnestproperty-git-fix-projects.vercel.app",
  "https://earnestproperty-git-fix-xynwaforevers-projects.vercel.app",
  "https://preview.vercel.app",
  "https://preview-abc123.vercel.app",
  "https://evil.vercel.app",
  "https://other-git-fix-ynwaforevers-projects.vercel.app",
  "https://xearnestproperty-git-fix-ynwaforevers-projects.vercel.app",
  "https://earnestproperty-git-fix-ynwaforevers-projects.vercel.app.evil.example",
  // IDN, punycode and fullwidth forms
  "https://xn--earnestproperty-abc.vercel.app",
  "https://xn--80ak6aa92e.vercel.app",
  "https://еarnestproperty.vercel.app",
  "https://preview.vercel.app。evil.example",
  "https://ｅarnestproperty.vercel.app",
  "https://ｗｗｗ.earnestproperty.com",
  // IP literals that could alias production or anything else
  "http://127.0.0.2",
  "http://0.0.0.0",
  "http://10.0.0.1",
  "http://192.168.0.1",
  "http://76.76.21.21",
  "https://76.76.21.21",
  "http://[::1]",
  "http://[::ffff:7f00:1]",
  "http://[2606:4700::1]",
  "https://[::1]:3000",
  // localhost lookalikes, and plain http for non-local hosts
  "http://localhost.evil.example",
  "http://evil.localhost",
  "http://foo.localhost",
  "https://localhost.vercel.app.evil.example",
  "http://earnestproperty-git-fix-fx-11-chatbot.vercel.app",
  // other schemes and malformed input
  "file:///etc/passwd",
  "javascript:alert(1)",
  "data:text/html,x",
  "wss://preview.vercel.app",
  "//preview.vercel.app",
  "preview.vercel.app",
  "",
  " ",
  "https://",
  "https://preview.vercel.app\n.evil.example",
  " https://preview.vercel.app",
  "https://preview .vercel.app",
  "not a url",
  null,
  undefined,
  42,
  {},
];

test("live mode refuses production and custom hosts", () => {
  for (const input of REFUSED) {
    assert.throws(
      () => assertLiveTarget(input),
      /live_target_refused/,
      `must refuse ${JSON.stringify(input)}`,
    );
  }
});

test("live mode accepts only previews and localhost", () => {
  assert.equal(assertLiveTarget(PREVIEW).origin, PREVIEW);
  assert.equal(
    assertLiveTarget(
      "https://EarnestProperty-Git-Fix-FX-11-Chatbot-Ynwaforevers-Projects.VERCEL.app",
    ).origin,
    PREVIEW,
  );
  assert.equal(assertLiveTarget(`${PREVIEW}.`).origin, PREVIEW);
  assert.equal(assertLiveTarget(`${PREVIEW}:443/x?y#z`).origin, PREVIEW);
  assert.equal(
    assertLiveTarget("https://earnestproperty-git-feat-live-eval-ynwaforevers-projects.vercel.app")
      .origin,
    "https://earnestproperty-git-feat-live-eval-ynwaforevers-projects.vercel.app",
  );
  assert.equal(assertLiveTarget("http://localhost:8080").origin, "http://localhost:8080");
  assert.equal(assertLiveTarget("http://127.0.0.1:3000").origin, "http://127.0.0.1:3000");
  assert.equal(assertLiveTarget("http://localhost:3000").origin, "http://localhost:3000");
  assert.throws(() => assertLiveTarget("https://localhost"), /live_target_refused/);
  assert.equal(assertLiveTarget("http://LOCALHOST.:3000").origin, "http://localhost:3000");
});

test("live mode refuses a production target before any request", async () => {
  for (const baseUrl of [
    "https://www.earnestproperty.com",
    "https://earnestproperty.vercel.app",
    "https://preview.vercel.app@www.earnestproperty.com",
    "https://earnestproperty-ynwaforevers-projects.vercel.app",
    null,
  ]) {
    await assert.rejects(
      runLiveAgentEval({ mode: "live", baseUrl, fetchImpl: throwingFetch }),
      /live_target_refused|live_base_url_required/,
    );
  }
  await assert.rejects(
    runLiveAgentEval({ mode: "bogus", fetchImpl: throwingFetch }),
    /invalid_mode/,
  );
});

test("live mode never posts a handoff", async () => {
  const { fetchImpl, calls } = recordingFetch();
  const report = await runLiveAgentEval({
    mode: "live",
    baseUrl: "http://127.0.0.1:1",
    fetchImpl,
  });
  assert.equal(calls.length > 0, true);
  for (const call of calls) {
    assert.equal(call.url.origin, "http://127.0.0.1:1");
    assert.equal(call.url.pathname.includes("handoff"), false);
    assert.equal(call.redirect, "manual");
  }
  assert.equal(calls.filter((c) => c.url.pathname === "/api/live-agent/session").length, 1);
  assert.equal(calls.filter((c) => c.url.pathname === "/api/live-agent/message").length, 20);
  assert.deepEqual(
    report.results.filter((r) => r.status === "skipped").map((r) => r.id),
    [13, 14, 15],
  );
  // Only the eval case texts are sent, in order, and none of them holds a phone number.
  const sent = calls
    .filter((c) => c.url.pathname === "/api/live-agent/message")
    .map((c) => JSON.parse(c.body).message);
  assert.deepEqual(
    sent,
    LIVE_AGENT_EVAL_CASES.filter((c) => c.live).map((c) => c.input),
  );
  for (const text of sent) assert.equal(/(?<![0-9])[4-9]\d{7}(?![0-9])/.test(text), false);
});

test("live mode fails a reply with a phone number or Simplified text", async () => {
  const phone = recordingFetch((c) =>
    c.id === 1 ? { kind: "listings", text: "請致電 91234567", cards: [] } : fixedReply(c),
  );
  const report = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: phone.fetchImpl,
  });
  const one = report.results.find((r) => r.id === 1);
  assert.equal(one.status, "fail");
  assert.deepEqual(one.failures, ["UNGROUNDED_NUMBER", "PHONE_PATTERN"]);
  assert.equal(report.summary.failed, 1);
  // Failures carry codes only, never the reply text.
  assert.equal(JSON.stringify(report).includes("91234567"), false);

  const simplified = recordingFetch((c) =>
    c.id === 2 ? { kind: "no_listings", text: "这里没有资料", cards: [] } : fixedReply(c),
  );
  const second = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: simplified.fetchImpl,
  });
  const two = second.results.find((r) => r.id === 2);
  assert.equal(two.status, "fail");
  assert.deepEqual(two.failures, ["SIMPLIFIED"]);
  assert.equal(JSON.stringify(second).includes("这"), false);
});

test("live mode grades kind, numbers, links and card fetches", async () => {
  const wrongKind = recordingFetch(() => ({ kind: "faq", text: "固定回覆。", cards: [] }));
  const kindReport = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: wrongKind.fetchImpl,
  });
  assert.deepEqual(kindReport.results.find((r) => r.id === 1).failures, ["KIND_MISMATCH"]);

  const numbers = recordingFetch((c) => ({ kind: c.expect.kind, text: "售 $6.80M", cards: [] }));
  const numReport = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: numbers.fetchImpl,
  });
  assert.deepEqual(numReport.results.find((r) => r.id === 1).failures, ["UNGROUNDED_NUMBER"]);

  const offOrigin = "https://www.earnestproperty.com/property/EP1";
  const links = recordingFetch((c) => ({
    ...fixedReply(c),
    cards: c.id === 1 ? [{ title: "x", lines: [], href: offOrigin }] : [],
  }));
  const linkReport = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: links.fetchImpl,
  });
  assert.deepEqual(linkReport.results.find((r) => r.id === 1).failures, ["UNSAFE_LINK"]);
  assert.equal(JSON.stringify(linkReport).includes("earnestproperty.com"), false);
  // The off-origin href is never requested.
  assert.equal(
    links.calls.every((c) => c.url.origin === PREVIEW),
    true,
  );

  const withCard = (c) => ({
    ...fixedReply(c),
    cards: c.id === 1 ? [{ title: "x", lines: [], href: "/property/EP11001" }] : [],
  });
  const cards = recordingFetch(withCard);
  const ok = await runLiveAgentEval({ mode: "live", baseUrl: PREVIEW, fetchImpl: cards.fetchImpl });
  assert.equal(ok.summary.failed, 0);
  assert.equal(ok.cardChecks.length, 1);
  assert.equal(ok.cardChecks[0].status, "pass");
  assert.equal(
    cards.calls.some((c) => c.method === "GET" && c.url.pathname === "/property/EP11001"),
    true,
  );

  const broken = recordingFetch(withCard);
  const report404 = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: async (url, init) =>
      new URL(String(url)).pathname === "/property/EP11001"
        ? new Response("nope", { status: 404 })
        : broken.fetchImpl(url, init),
  });
  assert.equal(report404.cardChecks[0].status, "fail");
  assert.equal(report404.summary.cardFailures, 1);
});

test("live mode does not follow a redirect to another host", async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url), redirect: init.redirect });
    // A real fetch with redirect "manual" returns the 3xx itself; a following fetch would go on to
    // the production host. This fake throws if redirect is not "manual".
    if (init.redirect !== "manual") throw new Error("redirect_would_be_followed");
    return new Response(null, {
      status: 302,
      headers: { location: "https://www.earnestproperty.com/api/live-agent/session" },
    });
  };
  const report = await runLiveAgentEval({ mode: "live", baseUrl: PREVIEW, fetchImpl });
  assert.equal(seen.length, 1); // the session call; nothing else is attempted after the redirect
  assert.equal(seen[0].url, `${PREVIEW}/api/live-agent/session`);
  assert.equal(report.summary.unavailable, 20);
  assert.equal(report.summary.passed, 0);
  assert.equal(report.results.find((r) => r.id === 1).reason, "redirect_refused");
});

test("a redirect on a message or a card fetch is also refused", async () => {
  const { fetchImpl } = recordingFetch((c) => ({
    ...fixedReply(c),
    cards: c.id === 1 ? [{ title: "x", lines: [], href: "/property/EP11001" }] : [],
  }));
  const calls = [];
  const report = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      if (new URL(String(url)).pathname === "/property/EP11001") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.earnestproperty.com/" },
        });
      }
      return fetchImpl(url, init);
    },
  });
  assert.equal(report.cardChecks[0].status, "fail");
  assert.equal(report.cardChecks[0].reason, "redirect_refused");
  assert.equal(
    calls.every((u) => new URL(u).origin === PREVIEW),
    true,
  );
});

test("live mode reports unavailable cases on a network error without echoing it", async () => {
  const report = await runLiveAgentEval({
    mode: "live",
    baseUrl: PREVIEW,
    fetchImpl: async () => {
      throw new Error("secret-token-should-not-print");
    },
  });
  assert.equal(report.summary.unavailable, 20);
  assert.equal(JSON.stringify(report).includes("secret-token-should-not-print"), false);
});

test("the script never reads the environment, an AI key, a phone number or the handoff route", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/AI_GATEWAY|API_KEY|OPENCODE|TAVILY/i.test(source), false);
  assert.equal(/\/api\/live-agent\/handoff/.test(source), false);
});

test("a hash URL is refused with a one-line hint and no env value", () => {
  const run = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--live",
      "--base-url",
      "https://earnestproperty-9k2x3abcd-ynwaforevers-projects.vercel.app",
    ],
    { encoding: "utf8", env: { ...process.env, SECRET_PROBE: "do-not-print-me" } },
  );
  assert.equal(run.status, 1);
  const lines = run.stderr.trim().split(/\r?\n/);
  assert.equal(lines[0], "live_target_refused");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /branch preview URL/);
  assert.equal(run.stderr.includes("do-not-print-me"), false);
  const other = spawnSync(
    process.execPath,
    [SCRIPT, "--live", "--base-url", "https://www.example.com"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(other.stderr.trim(), "live_target_refused");
});

test("each run uses a fresh anonymousId", async () => {
  const ids = [];
  for (let i = 0; i < 2; i += 1) {
    const { fetchImpl, calls } = recordingFetch();
    await runLiveAgentEval({ mode: "live", baseUrl: PREVIEW, fetchImpl });
    ids.push(JSON.parse(calls[0].body).anonymousId);
  }
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.match(id, /^live-agent-eval-[0-9a-f-]{36}$/);
});
