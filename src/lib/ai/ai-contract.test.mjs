import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const sourceFiles = (dir) => {
  const entries = readdirSync(join(root, dir));
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry}`;
    const stat = statSync(join(root, path));
    if (stat.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mjs|js|jsx)$/.test(entry) ? [path] : [];
  });
};

const functionSource = (source, name) => {
  const start = source.search(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`));
  assert.notEqual(start, -1, `Expected to find function ${name}`);
  const paramsStart = source.indexOf("(", start);
  assert.notEqual(paramsStart, -1, `Expected ${name} to have parameters`);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") paramsDepth += 1;
    if (char === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  assert.notEqual(paramsEnd, -1, `Expected ${name} parameter list to close`);
  const bodyStart = source.indexOf("{", paramsEnd);
  assert.notEqual(bodyStart, -1, `Expected ${name} to have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not read function body for ${name}`);
};

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

test("AI knowledge rebuild checks job ownership around provider and database work", () => {
  const source = read("src/lib/ai/knowledge.server.ts");
  const rebuild = functionSource(source, "rebuildAiKnowledgeIndex");
  const operation = functionSource(source, "runAiKnowledgeRebuildOperation");
  const checkpoints = rebuild.match(/await checkpoint\(\)/g) ?? [];

  assert.ok(checkpoints.length >= 8, "rebuild should checkpoint throughout each source");
  assert.match(rebuild, /await checkpoint\(\);\s*const embeddings = await embedAiTexts/);
  assert.match(rebuild, /await checkpoint\(\);\s*const sourceRows = await queryRows/);
  assert.match(rebuild, /await checkpoint\(\);\s*await replaceKnowledgeChunks/);
  assert.match(operation, /rebuild\(\{ checkpoint: deps\.checkpoint \}\)/);
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

test("AI, Neon, Woztell, and Blob secret names stay out of browser-safe source", () => {
  const secretPattern =
    /\b(?:AI_GATEWAY_API_KEY|AI_GATEWAY_MODEL|AI_GATEWAY_EMBEDDING_MODEL|DATABASE_URL|DATABASE_URL_UNPOOLED|BLOB_READ_WRITE_TOKEN|WOZTELL_BOT_ACCESS_TOKEN|WOZTELL_CHANNEL_SECRET|WOZTELL_CHANNEL_ID)\b/;
  const allowedPattern = /(?:^|\/)(?:docs|scripts)\//;
  const browserSafeFiles = sourceFiles("src").filter(
    (file) =>
      !allowedPattern.test(file) &&
      !file.includes(".server.") &&
      !file.includes(".test.") &&
      !file.startsWith("src/routes/api.") &&
      file !== "src/lib/mls/neon-db.mjs",
  );

  for (const file of browserSafeFiles) {
    assert.doesNotMatch(read(file), secretPattern, `${file} should not reference server secrets`);
  }
});

test("public AI answers are sourced only from public knowledge, not CRM or WhatsApp data", () => {
  const source = read("src/lib/ai/knowledge.server.ts");
  const search = functionSource(source, "searchPublicKnowledge");
  const answer = functionSource(source, "answerFromPublicKnowledge");

  assert.match(search, /c\.visibility = 'public'/);
  assert.match(search, /s\.public_visibility = 'public'/);
  assert.match(search, /s\.published = true/);
  assert.match(search, /c\.stale = false/);
  assert.match(search, /fallbackSearchPublicKnowledge/);
  assert.match(source, /knowledgeSearchTokens/);
  assert.match(source, /\\u3400-\\u9fff/);
  assert.doesNotMatch(search, /\b(?:crm_|whatsapp_)/i);
  assert.match(answer, /searchPublicKnowledge\(\{ query: input\.question, limit: 6 \}\)/);
  assert.doesNotMatch(answer, /\b(?:crm_|whatsapp_|fetchCrm|Conversation)/i);
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

test("live-agent handoff avoids fake Woztell conversations and implicit opt-in", () => {
  const server = read("src/lib/ai/live-agent.server.ts");
  const widget = read("src/components/live-agent/LiveAgentWidget.tsx");

  assert.doesNotMatch(server, /INSERT\s+INTO\s+whatsapp_conversations/i);
  assert.match(server, /channel_id\s+IS\s+NOT\s+NULL/);
  assert.match(server, /woztell_member_id\s+IS\s+NOT\s+NULL/);
  // Force-opt-in fix: a public handoff must never escalate an existing contact's
  // opt-in. The contact upsert preserves the stored value instead of OR-ing in the
  // caller-supplied flag (was previously `... OR EXCLUDED.opt_in_whatsapp`).
  assert.doesNotMatch(server, /OR\s+EXCLUDED\.opt_in_whatsapp/i);
  assert.match(server, /opt_in_whatsapp = crm_contacts\.opt_in_whatsapp/);
  assert.match(server, /session\.status\s+!==\s+"handoff_requested"/);

  assert.match(widget, /<Checkbox/);
  assert.match(widget, /handoffConsent/);
  assert.doesNotMatch(widget, /opt_in_whatsapp:\s*handoffPhone\.trim\(\)\.length\s*>\s*0/);
  assert.match(widget, /opt_in_whatsapp:\s*handoffConsent/);
});

test("CRM AI model suggestions stay suggested until staff review", () => {
  const source = read("src/lib/ai/crm-enrichment.server.ts");
  const suggestedTagLoop =
    source.match(
      /for \(const suggestion of value\.suggested_tags\) \{[\s\S]*?tags\.push\(\{[\s\S]*?\}\);\r?\n  \}/,
    )?.[0] ?? "";

  assert.notEqual(suggestedTagLoop, "", "crm-enrichment should persist AI suggested tags");
  assert.match(suggestedTagLoop, /status:\s*"suggested"/);
  assert.doesNotMatch(suggestedTagLoop, /canAutoApplyAiTag\(suggestion\.tag\)/);
});

test("AI suggestion flows cannot send WhatsApp, queue blasts, or publish CMS", () => {
  const aiEnrichment = read("src/lib/ai/crm-enrichment.server.ts");
  const liveAgent = read("src/lib/ai/live-agent.server.ts");
  const adminData = read("src/lib/neon/admin-data.server.ts");
  const adminSegments = read("src/routes/admin.segments.tsx");
  const adminBlasts = read("src/routes/admin.blasts.tsx");
  const forbiddenAutomation =
    /sendWoztellResponse|sendAdminConversationReply|sendAdminCampaignQueue|queueAdminCampaign|saveAdminArticle|published:\s*true|status\s*=\s*'queued'/;

  assert.doesNotMatch(functionSource(aiEnrichment, "analyzeCrmLead"), forbiddenAutomation);
  assert.doesNotMatch(functionSource(liveAgent, "answerLiveAgentMessage"), forbiddenAutomation);
  assert.doesNotMatch(
    functionSource(adminData, "fetchAdminConversationAiAssist"),
    forbiddenAutomation,
  );
  assert.doesNotMatch(
    functionSource(adminData, "materializeAdminCrmSegment"),
    /sendAdminCampaignQueue|queueAdminCampaign|status\s*=\s*'queued'/,
  );
  assert.doesNotMatch(adminSegments, /sendAdminCampaignQueue|queueAdminCampaign|saveAdminArticle/);

  // Both actions must be reachable ONLY through an explicit confirmation, never
  // from a bare onClick. These previously asserted the direct handlers
  // (onClick={materializeSegment} / onClick={() => handleQueueCampaign}), which
  // stopped matching when the confirmation gate landed -- the invariant got
  // STRONGER while the assertions went stale, and because this file is not
  // wired into any test: script, nobody saw it go red.
  assert.match(adminSegments, /onClick=\{\(\) => setMaterializeOpen\(true\)\}/);
  assert.match(
    adminSegments,
    /<AdminConfirmDialog[\s\S]*?onConfirm=\{\(\) => void materializeSegment\(\)\}/,
  );
  assert.doesNotMatch(adminSegments, /onClick=\{materializeSegment\}/);

  assert.match(adminBlasts, /onClick=\{\(\) => requestSendCampaign\(campaign, eligible\)\}/);
  assert.match(adminBlasts, /<AdminConfirmDialog/);
  assert.doesNotMatch(adminBlasts, /onClick=\{handleQueueCampaign\}/);
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

// The saved-segment card ("X 位客戶，其中 Y 位合資格") used to read
// crm_segment_memberships, a snapshot only ever refreshed by an explicit
// 建立名單 re-materialize. A segment could sit at 0/0 indefinitely even after
// a real, eligible customer started matching its filters -- confirmed live: a
// segment's saved card showed 0/0 while re-running its exact prompt through
// the preview path (which was always live) found 1 matching, eligible
// contact. listCrmSegments must compute live counts instead, the same way
// previewCrmSegment already does.
test("segment list counts are computed live, not read from a stale materialize snapshot", () => {
  const segmentsServer = read("src/lib/ai/segments.server.ts");
  const listBody = functionSource(segmentsServer, "listCrmSegments");

  assert.doesNotMatch(listBody, /crm_segment_memberships/);
  assert.match(listBody, /fetchSegmentContacts\(/);
  assert.match(listBody, /eligibility_status === "eligible"/);
});
