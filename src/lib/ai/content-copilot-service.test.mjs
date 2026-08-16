import assert from "node:assert/strict";
import test from "node:test";
import { buildContentFingerprint } from "./content-copilot.ts";
import { createContentCopilotContextLoader } from "./content-copilot-context.server.ts";
import { createContentCopilotService } from "./content-copilot.server.ts";

const managerActor = {
  staffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  authUserId: "auth-manager",
  email: "manager@example.com",
  name: "Manager",
  roles: ["manager"],
  bootstrap: false,
};
const agentActor = {
  staffId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  authUserId: "auth-agent",
  email: "agent@example.com",
  name: "Agent",
  roles: ["agent"],
  bootstrap: false,
};
const articleRequest = {
  resourceType: "article",
  resourceId: "11111111-1111-4111-8111-111111111111",
  action: "improve",
  selectedFields: ["title"],
  tone: "professional_property",
  targetLanguage: "zh-HK",
  researchMode: "internal",
};
const listingRequest = {
  resourceType: "listing",
  resourceId: "22222222-2222-4222-8222-222222222222",
  action: "improve",
  selectedFields: ["title_zh"],
  tone: "professional_property",
  targetLanguage: "zh-HK",
  researchMode: "internal",
};

async function makeArticleContext() {
  const resource = {
    id: articleRequest.resourceId,
    title: "Sham Tseng market guide",
    description: "",
    district_slug: "sham-tseng",
  };
  return { resource, internalEvidence: [], query: resource.title };
}

async function makeProposal(resource) {
  return {
    resourceType: "article",
    sourceFingerprint: await buildContentFingerprint(resource),
    patches: [],
    evidence: [],
    warnings: [],
  };
}

function makeServiceDeps(overrides = {}) {
  return {
    loadContext: makeArticleContext,
    research: async () => ({ ok: true, evidence: [], error: null }),
    startProposal: async () => ({ id: "proposal-1" }),
    completeProposal: async (input) => input.proposal,
    failProposal: async () => undefined,
    writeAudit: async () => undefined,
    generate: async ({ context }) => ({
      ok: true,
      value: await makeProposal(context.resource),
      model: "go-content",
      latencyMs: 10,
      usageMetadata: {},
      error: null,
    }),
    getProposal: async () => null,
    decideProposal: async (input) => input,
    ...overrides,
  };
}

test("context loader uses explicit projections, public knowledge limit, and no CRM tables", async () => {
  const calls = [];
  const loader = createContentCopilotContextLoader({
    queryRows: async (sql, params) => {
      calls.push([sql, params]);
      return [
        {
          id: listingRequest.resourceId,
          title_zh: "Sham Tseng listing",
          description: "",
          district_slug: "sham-tseng",
          status: "active",
        },
      ];
    },
    searchPublicKnowledge: async (input) => {
      assert.equal(input.limit, 6);
      return [
        {
          id: "chunk-1",
          title: "Sham Tseng",
          chunk_text: "public facts",
          url_path: "/estate/sham-tseng",
        },
      ];
    },
  });
  const context = await loader.load(listingRequest, managerActor);
  assert.equal(context.resource.id, listingRequest.resourceId);
  assert.equal(context.internalEvidence[0].type, "internal");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0][0], /SELECT\s+\*/i);
  assert.doesNotMatch(calls[0][0], /crm|lead|contact|whatsapp|campaign|staff.?note/i);
  assert.match(calls[0][0], /s\.active = true/);
  assert.match(calls[0][0], /show_on_website/);
});

test("generation reloads authoritative record and excludes CRM data from prompts", async () => {
  const calls = [];
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    startProposal: async (input) => (calls.push(["start", input]), { id: "proposal-1" }),
    completeProposal: async (input) => (calls.push(["complete", input]), input.proposal),
    writeAudit: async (input) => calls.push(["audit", input]),
    generate: async ({ prompt, context }) => {
      assert.doesNotMatch(prompt, /phone|email|whatsapp|crm_leads|staff notes/i);
      return {
        ok: true,
        value: await makeProposal(context.resource),
        model: "go-content",
        latencyMs: 10,
        usageMetadata: {},
        error: null,
      };
    },
  });
  const result = await service.generateContentProposal(articleRequest, managerActor);
  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["start", "complete", "audit"],
  );
});

test("generation binds server-owned proposal context around a model patch envelope", async () => {
  const trustedEvidence = {
    id: "internal-estate-1",
    type: "internal",
    title: "Sham Tseng guide",
    url: null,
    excerpt: "Trusted internal context",
  };
  let completedProposal = null;
  let generatedPrompt = "";
  const context = await makeArticleContext();
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    loadContext: async () => ({
      ...context,
      internalEvidence: [trustedEvidence],
    }),
    completeProposal: async (input) => {
      completedProposal = input.proposal;
      return input.proposal;
    },
    generate: async ({ prompt }) => {
      generatedPrompt = prompt;
      return {
        ok: true,
        value: { patches: [], warnings: [] },
        model: "go-content",
        latencyMs: 10,
        usageMetadata: {},
        error: null,
      };
    },
  });

  const result = await service.generateContentProposal(articleRequest, managerActor);

  assert.equal(result.ok, true);
  assert.equal(completedProposal.resourceType, articleRequest.resourceType);
  assert.equal(
    completedProposal.sourceFingerprint,
    await buildContentFingerprint(context.resource),
  );
  assert.deepEqual(completedProposal.evidence, [trustedEvidence]);
  assert.match(generatedPrompt, /claimType/);
  assert.match(generatedPrompt, /unsupportedClaims/);
});

test("listing agents cannot generate against another agent listing", async () => {
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    loadContext: async () => {
      throw new Response("Forbidden", { status: 403 });
    },
  });
  await assert.rejects(
    service.generateContentProposal(listingRequest, agentActor),
    (error) => error instanceof Response && error.status === 403,
  );
});

test("web mode attaches Tavily citations to generation", async () => {
  let generatedPrompt = "";
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    research: async () => ({
      ok: true,
      evidence: [
        {
          id: "web-1",
          type: "web",
          title: "Developer",
          url: "https://example.com/project",
          excerpt: "Verified project page",
        },
      ],
      error: null,
    }),
    generate: async ({ prompt, context }) => {
      generatedPrompt = prompt;
      return {
        ok: true,
        value: await makeProposal(context.resource),
        model: "go-content",
        latencyMs: 10,
        usageMetadata: {},
        error: null,
      };
    },
  });
  const result = await service.generateContentProposal(
    { ...articleRequest, researchMode: "web" },
    managerActor,
  );
  assert.equal(result.ok, true);
  assert.ok(generatedPrompt.includes("https://example.com/project"));
});

test("provider failure marks proposal failed and clears the generating lease", async () => {
  let failedId = "";
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    failProposal: async ({ proposalId }) => {
      failedId = proposalId;
    },
    generate: async () => ({
      ok: false,
      value: null,
      model: "go-content",
      latencyMs: 20,
      usageMetadata: {},
      error: "OPENCODE_GO_GENERATION_FAILED",
    }),
  });
  const result = await service.generateContentProposal(articleRequest, managerActor);
  assert.equal(result.ok, false);
  assert.equal(result.error, "OPENCODE_GO_GENERATION_FAILED");
  assert.equal(failedId, "proposal-1");
});

test("provider failure remains primary when audit persistence fails", async () => {
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    writeAudit: async () => {
      throw new Error("COPILOT_AUDIT_METADATA_INVALID");
    },
    generate: async () => ({
      ok: false,
      value: null,
      model: null,
      latencyMs: 51,
      usageMetadata: {},
      error: "OPENCODE_GO_HTTP_ERROR",
    }),
  });

  const result = await service.generateContentProposal(articleRequest, managerActor);

  assert.equal(result.ok, false);
  assert.equal(result.error, "OPENCODE_GO_HTTP_ERROR");
});

test("generated model evidence cannot replace trusted evidence", async () => {
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    generate: async ({ context }) => ({
      ok: true,
      value: {
        resourceType: "article",
        sourceFingerprint: await buildContentFingerprint(context.resource),
        patches: [
          {
            field: "title",
            before: context.resource.title,
            after: "unsupported fact",
            reason: "model",
            confidence: "high",
            evidenceIds: ["model-only"],
            unsupportedClaims: [],
            claimType: "factual_web",
          },
        ],
        evidence: [
          {
            id: "model-only",
            type: "web",
            title: "Untrusted",
            url: "https://example.com/model",
            excerpt: "Untrusted",
          },
        ],
        warnings: [],
      },
      model: "go-content",
      latencyMs: 10,
      usageMetadata: {},
      error: null,
    }),
  });

  const result = await service.generateContentProposal(articleRequest, managerActor);

  assert.equal(result.ok, false);
  assert.equal(result.error, "COPILOT_EVIDENCE_MISSING");
});
test("decision rejects stale fingerprints before recording applied status", async () => {
  let decisionWritten = false;
  const service = createContentCopilotService({
    ...makeServiceDeps(),
    getProposal: async () => ({
      id: "proposal-1",
      resourceType: "article",
      resourceId: articleRequest.resourceId,
      action: "improve",
      sourceFingerprint: "00".repeat(32),
      status: "generated",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      selectedFields: ["title"],
      patches: [],
    }),
    decideProposal: async () => {
      decisionWritten = true;
    },
  });
  const result = await service.decideContentProposal(
    { proposalId: "proposal-1", decision: "apply", acceptedFields: [] },
    managerActor,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "COPILOT_STALE_PROPOSAL");
  assert.equal(decisionWritten, false);
});
