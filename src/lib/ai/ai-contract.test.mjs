import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("AI modules expose the expected public and server-only contracts", () => {
  const expectedExports = new Map([
    [
      "src/lib/ai/ai-types.ts",
      ["AiKnowledgeChunk", "CrmAiProfile", "CrmSegment", "LiveAgentSession"],
    ],
    ["src/lib/ai/config.server.ts", ["getAiServerConfig", "isAiEnabled"]],
    ["src/lib/ai/provider.server.ts", ["generateAiText", "generateAiJson", "embedAiTexts"]],
    [
      "src/lib/ai/knowledge.ts",
      ["chunkKnowledgeText", "normalizeKnowledgeSource", "filterPublicKnowledgeChunks"],
    ],
    [
      "src/lib/ai/knowledge.server.ts",
      ["rebuildAiKnowledgeIndex", "searchPublicKnowledge", "answerFromPublicKnowledge"],
    ],
    [
      "src/lib/ai/crm-rules.ts",
      ["classifyAiTagSafety", "canAutoApplyAiTag", "suggestFactualTags", "scoreLeadProfile"],
    ],
    [
      "src/lib/ai/crm-enrichment.server.ts",
      ["analyzeCrmLead", "fetchCrmAiProfile", "approveCrmAiTag"],
    ],
    ["src/lib/ai/segments.ts", ["parseSegmentPromptToFilters", "classifySegmentEligibility"]],
    [
      "src/lib/ai/segments.server.ts",
      ["previewCrmSegment", "saveCrmSegment", "materializeCrmSegment"],
    ],
    [
      "src/lib/ai/live-agent.ts",
      ["canUseChunkForPublicAnswer", "buildLiveAgentLeadInput", "shouldOfferHumanHandoff"],
    ],
    [
      "src/lib/ai/live-agent.server.ts",
      ["createLiveAgentSession", "answerLiveAgentMessage", "requestLiveAgentHandoff"],
    ],
  ]);

  for (const [file, exports] of expectedExports.entries()) {
    const source = read(file);
    for (const exportName of exports) {
      assert.match(
        source,
        new RegExp(
          `(?:` +
            `export\\s+(?:async\\s+function|function|class|interface|type|const|let|var)\\s+${exportName}\\b|` +
            `export\\s+(?:type\\s+)?\\{[^}]*\\b${exportName}\\b[^}]*\\}` +
            `)`,
          "m",
        ),
        `${file} should export ${exportName}`,
      );
    }
  }
});

test("server-only AI secrets stay out of browser-safe modules", () => {
  for (const file of [
    "src/lib/ai/ai-types.ts",
    "src/lib/ai/knowledge.ts",
    "src/lib/ai/crm-rules.ts",
    "src/lib/ai/segments.ts",
    "src/lib/ai/live-agent.ts",
    "src/components/live-agent/LiveAgentWidget.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /process\.env|AI_GATEWAY_API_KEY|DATABASE_URL|WOZTELL_BOT_ACCESS_TOKEN|WOZTELL_CHANNEL_SECRET|BLOB_READ_WRITE_TOKEN/,
    );
  }
});

test("public live-agent APIs validate sessions and expose only public session fields", () => {
  const server = read("src/lib/ai/live-agent.server.ts");
  const sessionRoute = read("src/routes/api.live-agent.session.ts");
  const messageRoute = read("src/routes/api.live-agent.message.ts");

  assert.match(server, /export\s+class\s+LiveAgentPublicError\b/);
  assert.match(server, /export\s+function\s+isLiveAgentSessionId\b/);
  assert.match(server, /export\s+function\s+toPublicLiveAgentSession\b/);
  assert.match(server, /getLiveAgentSessionForMessage/);
  assert.match(server, /status\s+IN\s+\('open',\s*'qualified'\)/);

  const sessionCheck = server.indexOf("const session = await getLiveAgentSessionForMessage");
  const messageInsert = server.indexOf("INSERT INTO live_agent_messages");
  assert.ok(sessionCheck !== -1, "answerLiveAgentMessage should check session before insert");
  assert.ok(messageInsert !== -1, "answerLiveAgentMessage should persist messages");
  assert.ok(sessionCheck < messageInsert, "session check should happen before message insert");

  assert.match(sessionRoute, /toPublicLiveAgentSession/);
  assert.doesNotMatch(sessionRoute, /Response\.json\(session\)/);
  for (const privateField of [
    "contact_id",
    "lead_id",
    "conversation_id",
    "budget_min",
    "preferred_estates",
    "opt_in_whatsapp",
  ]) {
    assert.doesNotMatch(sessionRoute, new RegExp(privateField));
  }

  assert.match(messageRoute, /isLiveAgentSessionId/);
  assert.match(messageRoute, /LiveAgentPublicError/);
  assert.match(messageRoute, /status:\s*err\.status/);
});

test("CRM AI model suggestions stay suggested until staff review", () => {
  const source = read("src/lib/ai/crm-enrichment.server.ts");
  const suggestedTagLoop =
    source.match(
      /for \(const suggestion of value\.suggested_tags\) \{[\s\S]*?tags\.push\(\{[\s\S]*?\}\);\n  \}/,
    )?.[0] ?? "";

  assert.notEqual(suggestedTagLoop, "", "crm-enrichment should persist AI suggested tags");
  assert.match(suggestedTagLoop, /status:\s*"suggested"/);
  assert.doesNotMatch(suggestedTagLoop, /canAutoApplyAiTag\(suggestion\.tag\)/);
});

test("admin data layer exposes staff-guarded AI functions", () => {
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");
  for (const name of [
    "fetchAdminAiKnowledgeStatus",
    "rebuildAdminAiKnowledge",
    "fetchAdminLeadAiProfile",
    "analyzeAdminLeadAiProfile",
    "approveAdminAiTag",
    "rejectAdminAiTag",
    "previewAdminCrmSegment",
    "saveAdminCrmSegment",
    "materializeAdminCrmSegment",
    "fetchAdminConversationAiAssist",
  ]) {
    assert.match(
      client,
      new RegExp(`export\\s+const\\s+${name}\\b`),
      `admin-data.ts should export ${name}`,
    );
    assert.match(
      server,
      new RegExp(`export\\s+async\\s+function\\s+${name}\\b`),
      `admin-data.server.ts should export ${name}`,
    );
  }
});
