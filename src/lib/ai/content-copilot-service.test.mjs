import assert from "node:assert/strict";
import test from "node:test";
import { applySelectedContentPatches, buildContentFingerprint } from "./content-copilot.ts";
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
  return {
    resource,
    internalEvidence: [],
    query: resource.title,
    sourceDbRevision: "ab".repeat(16),
    knowledgeDependencies: [],
  };
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
          source_db_revision: "ab".repeat(16),
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
          source_id: "11111111-1111-4111-8111-111111111111",
          source_revision: "cd".repeat(16),
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
  assert.equal(context.sourceDbRevision, "ab".repeat(16));
  assert.deepEqual(context.knowledgeDependencies, [
    {
      chunkId: "chunk-1",
      sourceId: "11111111-1111-4111-8111-111111111111",
      sourceRevision: "cd".repeat(16),
    },
  ]);
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

for (const unavailable of [false, true]) {
  test(`saved resource remains citable when knowledge search is ${unavailable ? "unavailable" : "empty"}`, async () => {
    const loader = createContentCopilotContextLoader({
      queryRows: async () => [
        {
          id: articleRequest.resourceId,
          source_db_revision: "ab".repeat(16),
          title: "Sham Tseng guide",
          content: "Saved public estate information",
          private_note: "must not enter evidence",
        },
      ],
      searchPublicKnowledge: async () => {
        if (unavailable) throw Error("search unavailable");
        return [];
      },
    });
    const context = await loader.load(articleRequest, managerActor);
    assert.equal(context.internalEvidence[0]?.id, "internal-resource");
    assert.match(context.internalEvidence[0].excerpt, /Saved public estate information/);
    assert.doesNotMatch(
      context.internalEvidence[0].excerpt,
      /private_note|must not enter evidence/,
    );
    const service = createContentCopilotService(
      makeServiceDeps({
        loadContext: async () => context,
        generate: async () => ({
          ok: true,
          value: {
            patches: [
              {
                field: "title",
                before: "Sham Tseng guide",
                after: "Sham Tseng estate guide",
                reason: "Clarify the saved subject",
                confidence: "high",
                evidenceIds: ["internal-resource"],
                unsupportedClaims: [],
                claimType: "factual_internal",
              },
            ],
            warnings: [],
          },
          model: "go-content",
          latencyMs: 10,
          usageMetadata: {},
          error: null,
        }),
      }),
    );
    assert.equal((await service.generateContentProposal(articleRequest, managerActor)).ok, true);
  });
}

const estateRequest = {
  resourceType: "estate",
  resourceId: "33333333-3333-4333-8333-333333333333",
  action: "improve",
  selectedFields: ["description"],
  tone: "professional_property",
  targetLanguage: "zh-HK",
  researchMode: "internal",
};

const listingFeaturesRequest = {
  ...listingRequest,
  selectedFields: ["features"],
};

async function generateEstatePatch({
  request = estateRequest,
  field = "description",
  before,
  after,
  claimType,
  evidence = [],
  evidenceIds = [],
  unsupportedClaims = [],
}) {
  const resource = { id: request.resourceId, name_zh: "海景花園", [field]: before };
  let completedProposal = null;
  const service = createContentCopilotService(
    makeServiceDeps({
      loadContext: async () => ({
        resource,
        internalEvidence: evidence,
        query: resource.name_zh,
        sourceDbRevision: "ab".repeat(16),
        knowledgeDependencies: [],
      }),
      completeProposal: async (input) => {
        completedProposal = input.proposal;
        return input.proposal;
      },
      generate: async () => ({
        ok: true,
        value: {
          patches: [
            {
              field,
              before,
              after,
              reason: "Improve the description",
              confidence: "medium",
              evidenceIds,
              unsupportedClaims,
              claimType,
            },
          ],
          warnings: [],
        },
        model: "go-content",
        latencyMs: 10,
        usageMetadata: {},
        error: null,
      }),
    }),
  );
  const result = await service.generateContentProposal(request, managerActor);
  assert.equal(result.ok, true);
  return { proposal: completedProposal, resource };
}

test("a subjective patch that adds a price not in before or evidence is flagged and cannot be applied", async () => {
  const { proposal, resource } = await generateEstatePatch({
    before: "海景兩房單位",
    after: "海景兩房單位，售價 $7.2M",
    claimType: "subjective",
  });

  assert.ok(proposal.patches[0].unsupportedClaims.includes("數字未有來源：$7.2M"));
  const fingerprint = await buildContentFingerprint(resource);
  const applied = applySelectedContentPatches(resource, proposal.patches, ["description"], {
    resourceType: "estate",
    sourceFingerprint: fingerprint,
    currentFingerprint: fingerprint,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.value.description, "海景兩房單位");
});

test("a patch that keeps the same numbers in another format is not flagged", async () => {
  const { proposal } = await generateEstatePatch({
    before: "售價 6,800,000",
    after: "售價 680萬",
    claimType: "subjective",
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, []);
});

test("a factual patch whose number is in its cited evidence is not flagged", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景兩房單位",
    after: "海景兩房單位，實用 512 呎",
    claimType: "factual_internal",
    evidence: [
      {
        id: "internal-estate-1",
        type: "internal",
        title: "海景花園",
        url: null,
        excerpt: "兩房單位實用面積 512 呎，向海。",
      },
    ],
    evidenceIds: ["internal-estate-1"],
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, []);
});

test("an array patch whose item adds an unsourced number is flagged with the raw text", async () => {
  const { proposal } = await generateEstatePatch({
    request: listingFeaturesRequest,
    field: "features",
    before: ["海景", "會所"],
    after: ["海景", "會所", "實用 512 呎"],
    claimType: "subjective",
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, ["數字未有來源：512"]);
});

test("a number found only in evidence the patch does not cite is still flagged", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景兩房單位",
    after: "海景兩房單位，實用 512 呎",
    claimType: "subjective",
    evidence: [
      {
        id: "internal-estate-1",
        type: "internal",
        title: "海景花園",
        url: null,
        excerpt: "兩房單位實用面積 512 呎，向海。",
      },
    ],
    evidenceIds: [],
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, ["數字未有來源：512"]);
});

test("the same unsourced number twice in a patch produces one flag", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景兩房單位",
    after: "海景兩房單位，售價 $7.2M。再講一次：售價 $7.2M",
    claimType: "subjective",
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, ["數字未有來源：$7.2M"]);
});

test("the number flag survives the 20-claim cap when the model already returned 20 claims", async () => {
  const modelClaims = Array.from({ length: 20 }, (_, index) => `模型聲稱 ${index + 1}`);
  const { proposal } = await generateEstatePatch({
    before: "海景兩房單位",
    after: "海景兩房單位，售價 $7.2M",
    claimType: "subjective",
    unsupportedClaims: modelClaims,
  });

  const claims = proposal.patches[0].unsupportedClaims;
  assert.ok(claims.includes("數字未有來源：$7.2M"));
  assert.ok(claims.length <= 20);
});

test("the copilot treats Chinese and Arabic numerals as the same number", async () => {
  const same = [
    ["海景兩房", "海景 2 房"],
    ["三房兩廁", "3房2廁"],
    ["第一期", "第1期"],
    ["海景 2 房", "海景兩房"],
    ["售價七百萬", "售價 $7,000,000"],
    ["售價 $7,000,000", "售價七百萬"],
    ["售價七百萬", "售價 700萬"],
    ["十二層高", "12 層高"],
    ["步行二十分鐘", "步行 20 分鐘"],
    ["實用一百二十呎", "實用 120 呎"],
  ];
  for (const [before, after] of same) {
    const { proposal } = await generateEstatePatch({ before, after, claimType: "subjective" });
    assert.deepEqual(proposal.patches[0].unsupportedClaims, [], `${before} → ${after}`);
  }
});

test("the copilot flags a changed Chinese numeral with its raw text", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景兩房",
    after: "海景三房",
    claimType: "subjective",
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, ["數字未有來源：三房"]);
});

test("the copilot does not read ordinary words with a numeral as numbers", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景單位",
    after: "海景單位：一個家庭一齊住，一定統一管理，一手、二手都有，萬一有事千祈聯絡，十分方便",
    claimType: "subjective",
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, []);
});

test("a very long numeral run still gives a valid proposal with a short flag", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景兩房單位",
    after: `海景兩房單位 ${"9".repeat(600)}`,
    claimType: "subjective",
  });

  const claims = proposal.patches[0].unsupportedClaims;
  assert.equal(claims.length, 1);
  assert.ok(claims[0].startsWith("數字未有來源："));
  assert.ok(claims[0].length <= "數字未有來源：".length + 40);
});

test("the copilot does not read common marketing idioms as numbers", async () => {
  const { proposal } = await generateEstatePatch({
    before: "海景單位",
    after:
      "海景單位，千萬唔好錯過！第一時間聯絡我們，一年四季景觀一流，交通四通八達，會所設施一應俱全",
    claimType: "subjective",
  });

  assert.deepEqual(proposal.patches[0].unsupportedClaims, []);
});
