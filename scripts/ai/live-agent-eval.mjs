// Opt-in live eval for the public live-agent. Default is mock mode and makes no network call.
// `--live --base-url <url>` drives a deployed PREVIEW over HTTP and refuses production hosts.
// Modelled on scripts/jev/evaluate.mjs. This file never reads the environment: no AI keys, no phone
// numbers and no other value can reach a request or the report. Live mode sends only the eval case
// texts, never calls the handoff route (cases 13-15 are skipped), and never follows a redirect.

import { pathToFileURL } from "node:url";

import { LIVE_AGENT_EVAL_CASES } from "../../src/lib/ai/live-agent-eval-cases.js";
import {
  containsPhonePattern,
  isEvalInternalHref,
  simplifiedCharacters,
} from "../../src/lib/ai/live-agent-eval-graders.js";
import { ungroundedNumbers } from "../../src/lib/ai/number-grounding.js";

const MOCK_INTERPRETATION =
  "MOCK ONLY: exercises graders and reporting; the deterministic proof is test:live-agent:eval:db.";
const LIVE_INTERPRETATION =
  "LIVE PREVIEW: fixed-copy graders only (no phone, no Simplified, internal links, kind, no ungrounded number); card facts are not judged against the DB.";

/** Fixed canned copy per reply kind: no numbers, no phone, Traditional only, no cards. */
const MOCK_REPLIES = {
  listings: "以下是符合條件的盤源。",
  no_listings: "暫時未有符合條件的盤源。",
  estates: "以下是相關屋苑資料。",
  listing_unavailable: "找不到這個盤源編號。",
  handoff: "可以轉交代理跟進。",
  faq: "以下是常見問題的解答。",
  no_match: "暫時未能回答這個問題。",
};

const REQUEST_TIMEOUT_MS = 15000;
const ANONYMOUS_ID = "live-agent-eval";
const SOURCE_PATH = "/";

function refuse() {
  throw new Error("live_target_refused");
}

const PREVIEW_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;

/**
 * Allowlist for live mode. Throws "live_target_refused" unless baseUrl is a Vercel preview host
 * (a single ASCII label under .vercel.app, https only) or localhost / 127.0.0.1 (http or https).
 * The host is compared after URL parsing (which lowercases, applies IDN to punycode and NFKC) with
 * one trailing dot stripped and the port ignored. Credentials, other IP literals, punycode labels,
 * the production alias and the main-branch alias are refused. Returns the normalised URL (origin
 * only; path, query and hash are dropped).
 */
export function assertLiveTarget(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.length === 0 || baseUrl.length > 2048) refuse();
  // Whitespace, control characters and backslashes make parsers disagree on the host.
  if (/[\s\u0000-\u001f\u007f\\]/.test(baseUrl)) refuse();
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return refuse();
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") refuse();
  if (url.username !== "" || url.password !== "") refuse();

  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "" || host.endsWith(".") || host.startsWith("[") || host.includes("%")) refuse();

  const local = host === "localhost" || host === "127.0.0.1";
  if (!local) {
    if (url.protocol !== "https:") refuse();
    if (!PREVIEW_HOST_RE.test(host)) refuse();
    const label = host.slice(0, -".vercel.app".length);
    if (label.startsWith("xn--")) refuse();
    if (label === "earnestproperty" || label === "www") refuse();
    if (/-git-(?:main|master)-/.test(label)) refuse();
  }

  const port = url.port ? `:${url.port}` : "";
  return new URL(`${url.protocol}//${host}${port}`);
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = [...argv];
  if (args.length === 0 || (args.length === 1 && args[0] === "--mock")) {
    return { mode: "mock", baseUrl: null };
  }
  if (args[0] !== "--live") throw new Error("invalid_arguments");
  if (args.length === 1) throw new Error("live_base_url_required");
  if (args[1] !== "--base-url" || args.length > 3) throw new Error("invalid_arguments");
  if (args.length === 2 || !args[2]) throw new Error("live_base_url_required");
  return { mode: "live", baseUrl: args[2] };
}

function visibleText(reply) {
  const parts = [reply.text];
  for (const card of reply.cards ?? []) {
    parts.push(card.title, ...(card.lines ?? []));
  }
  return parts.filter((part) => typeof part === "string").join("\n");
}

/** Code graders over one reply. Returns failure codes only; never the reply text. */
function gradeLiveReply(testCase, reply) {
  const failures = [];
  if (reply.kind !== testCase.expect.kind) failures.push("KIND_MISMATCH");
  if (typeof reply.text !== "string") failures.push("INVALID_REPLY");
  // Code only: a number found in a reply may be a phone number and must not be echoed.
  if (ungroundedNumbers(typeof reply.text === "string" ? reply.text : "", []).length > 0) {
    failures.push("UNGROUNDED_NUMBER");
  }
  const text = visibleText(reply);
  if (containsPhonePattern(text)) failures.push("PHONE_PATTERN");
  const simplified = simplifiedCharacters(text);
  if (simplified.length > 0) failures.push(`SIMPLIFIED:${simplified.join("")}`);
  for (const card of reply.cards ?? []) {
    if (card.href === null || card.href === undefined) continue;
    if (!isEvalInternalHref(card.href)) failures.push(`UNSAFE_LINK:${card.href}`);
  }
  return failures;
}

function normalizeReply(raw) {
  if (!raw || typeof raw !== "object") return null;
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  return {
    kind: typeof raw.kind === "string" ? raw.kind : "",
    text: typeof raw.text === "string" ? raw.text : null,
    cards: cards
      .filter((card) => card && typeof card === "object")
      .map((card) => ({
        title: typeof card.title === "string" ? card.title : "",
        lines: Array.isArray(card.lines) ? card.lines.filter((l) => typeof l === "string") : [],
        href: typeof card.href === "string" ? card.href : null,
      })),
  };
}

function summarize(results, cardChecks) {
  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    total: results.length,
    graded: count("pass") + count("fail") + count("unavailable"),
    passed: count("pass"),
    failed: count("fail"),
    unavailable: count("unavailable"),
    skipped: count("skipped"),
    cardFailures: cardChecks.filter((c) => c.status !== "pass").length,
  };
}

class RedirectRefused extends Error {}

async function request(fetchImpl, url, init) {
  // redirect "manual": a 3xx is returned as-is and never followed to another host.
  const response = await fetchImpl(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new RedirectRefused("redirect_refused");
  }
  return response;
}

function unavailable(error) {
  if (error instanceof RedirectRefused) return "redirect_refused";
  return "network_error";
}

async function runMock(cases) {
  const results = cases.map((testCase) => {
    // Skipped cases are reported by id only: their labels hold the synthetic handoff numbers.
    if (!testCase.live) return { id: testCase.id, status: "skipped" };
    const text = MOCK_REPLIES[testCase.expect.kind] ?? MOCK_REPLIES.no_match;
    const failures = gradeLiveReply(testCase, { kind: testCase.expect.kind, text, cards: [] });
    return {
      id: testCase.id,
      label: testCase.label,
      status: failures.length === 0 ? "pass" : "fail",
      failures,
    };
  });
  return {
    mode: "mock",
    interpretation: MOCK_INTERPRETATION,
    target: null,
    results,
    cardChecks: [],
    summary: summarize(results, []),
  };
}

async function runLive(target, fetchImpl, cases) {
  const origin = target.origin;
  const jsonHeaders = { "content-type": "application/json" };
  const base = (testCase, status, extra = {}) => ({
    id: testCase.id,
    label: testCase.label,
    status,
    ...extra,
  });

  // One session for the whole run. A failure here makes every live case unavailable.
  let session = null;
  let sessionReason = null;
  try {
    const response = await request(fetchImpl, `${origin}/api/live-agent/session`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ anonymousId: ANONYMOUS_ID, sourcePath: SOURCE_PATH }),
    });
    const data = response.ok ? await response.json() : null;
    if (data && typeof data.id === "string" && typeof data.accessToken === "string") {
      session = { id: data.id, accessToken: data.accessToken };
    } else {
      sessionReason = `http_${response.status}`;
    }
  } catch (error) {
    sessionReason = unavailable(error);
  }

  const results = [];
  const hrefs = new Set();
  for (const testCase of cases) {
    if (!testCase.live) {
      results.push({ id: testCase.id, status: "skipped" });
      continue;
    }
    if (!session) {
      results.push(
        base(testCase, "unavailable", { reason: sessionReason ?? "network_error", failures: [] }),
      );
      continue;
    }
    try {
      const response = await request(fetchImpl, `${origin}/api/live-agent/message`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          sessionId: session.id,
          accessToken: session.accessToken,
          message: testCase.input,
        }),
      });
      if (!response.ok) {
        results.push(
          base(testCase, "unavailable", { reason: `http_${response.status}`, failures: [] }),
        );
        continue;
      }
      const data = await response.json();
      const reply = normalizeReply(data?.reply);
      if (!reply) {
        results.push(base(testCase, "unavailable", { reason: "invalid_response", failures: [] }));
        continue;
      }
      const failures = gradeLiveReply(testCase, reply);
      for (const card of reply.cards) {
        if (card.href && isEvalInternalHref(card.href)) hrefs.add(card.href);
      }
      results.push(base(testCase, failures.length === 0 ? "pass" : "fail", { failures }));
    } catch (error) {
      results.push(base(testCase, "unavailable", { reason: unavailable(error), failures: [] }));
    }
  }

  // Every card href that passed isEvalInternalHref is an app path; resolve it against the preview
  // origin only and refuse anything that lands elsewhere.
  const cardChecks = [];
  for (const href of hrefs) {
    const check = { href, status: "fail" };
    try {
      const url = new URL(href, `${origin}/`);
      if (url.origin !== origin) {
        check.reason = "off_origin";
      } else {
        const response = await request(fetchImpl, url.href, { method: "GET" });
        if (response.status === 200) check.status = "pass";
        else check.reason = `http_${response.status}`;
      }
    } catch (error) {
      check.reason = unavailable(error);
    }
    cardChecks.push(check);
  }

  return {
    mode: "live",
    interpretation: LIVE_INTERPRETATION,
    target: { origin },
    results,
    cardChecks,
    summary: summarize(results, cardChecks),
  };
}

export async function runLiveAgentEval({
  mode = "mock",
  baseUrl = null,
  fetchImpl = fetch,
  cases = LIVE_AGENT_EVAL_CASES,
} = {}) {
  if (mode !== "mock" && mode !== "live") throw new Error("invalid_mode");
  if (mode === "mock") return runMock(cases);
  if (baseUrl === null || baseUrl === undefined) throw new Error("live_base_url_required");
  // The guard runs before the first request.
  return runLive(assertLiveTarget(baseUrl), fetchImpl, cases);
}

async function main() {
  const { mode, baseUrl } = parseArgs(process.argv.slice(2));
  const report = await runLiveAgentEval({ mode, baseUrl });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (
    mode === "live" &&
    (report.summary.failed > 0 || report.summary.unavailable > 0 || report.summary.cardFailures > 0)
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const codes = [
      "invalid_arguments",
      "live_base_url_required",
      "live_target_refused",
      "invalid_mode",
    ];
    // Only a known code is printed; any other error text could carry a URL or a value.
    const code = codes.includes(error?.message) ? error.message : "unexpected_error";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
