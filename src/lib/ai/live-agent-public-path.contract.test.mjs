import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repoRoot), "utf8");

const PUBLIC_PATH_FILES = [
  "src/lib/ai/live-agent.server.ts",
  "src/lib/ai/live-agent-reply.server.ts",
  "src/lib/ai/live-agent-reply.ts",
  "src/lib/ai/live-agent-intent.ts",
  "src/routes/api.live-agent.message.ts",
  "src/routes/api.live-agent.session.ts",
  "src/routes/api.live-agent.handoff.ts",
];
const FORBIDDEN_SPECIFIER = /provider\.server|knowledge\.server|opencode-go|tavily|content-copilot/;

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[\w*{}\s,$]+\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

test("public live-agent modules import no model provider", () => {
  for (const file of PUBLIC_PATH_FILES) {
    const source = read(file);
    const specifiers = importSpecifiers(source);
    assert.ok(specifiers.length > 0 || file.endsWith("live-agent-reply.ts"), `${file} parsed`);
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, FORBIDDEN_SPECIFIER, `${file} imports ${specifier}`);
    }
    // Any dynamic import with a non-literal argument could smuggle a provider in.
    assert.doesNotMatch(source, /\bimport\s*\(\s*[^"'`\s]/, `${file} has a dynamic import`);
    assert.doesNotMatch(source, /generateAi/, `${file} mentions generateAi`);
    assert.doesNotMatch(source, /embedAiTexts/, `${file} mentions embedAiTexts`);
  }
});

test("the responder reads only published FAQs, published estates and public listings", () => {
  const source = read("src/lib/ai/live-agent-reply.server.ts");
  assert.match(source, /FROM faqs WHERE published = true/);
  assert.match(source, /FROM estates WHERE published = true/);
  assert.match(
    source,
    /import\s*\{[^}]*\bsearchListings\b[^}]*\}\s*from\s*["']@\/lib\/neon\/public-data\.server["']/,
  );
  assert.doesNotMatch(
    source,
    /ai_knowledge|articles|description|crm_|whatsapp_|cachedPublicEstateOptions|fetchEstateOptions/,
  );
});

test("knowledge.server.ts generates no public text", () => {
  const source = read("src/lib/ai/knowledge.server.ts");
  assert.doesNotMatch(source, /generateAiText/);
  assert.doesNotMatch(source, /answerFromPublicKnowledge/);
  assert.doesNotMatch(source, /slice\(0, 350\)/);
});
