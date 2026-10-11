/**
 * FX-19d-1 H-08: every staff write in admin-data.ts / admin-cms.ts validates its
 * input with a strict Zod schema. Each schema is tested twice:
 *   - it accepts every payload its admin UI really sends (built by the real
 *     client builder where one is importable; otherwise a fixture copied from
 *     the call site, which the comment names), and
 *   - it rejects an unknown key.
 * The browser fixtures (scripts/browser-fixtures) parse the payloads the real
 * pages send through the same schemas, so the admin browser suites prove it too.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { ZodTypeAny } from "zod";

import {
  agentProfileSchema,
  buildAgentProfilePayload,
  type AgentProfilePayloadData,
} from "@/components/admin/agent-profile-form-utils";
import { normalizePropertyFeatures } from "@/components/dashboard/property-form-content";
import { campaignSavePayload } from "@/lib/admin/blast-review";
import * as schemas from "./admin-write-schemas";

const LEAD = "10000000-0000-4000-8000-000000000001";
const CONTACT = "10000000-0000-4000-8000-000000000002";
const STAFF = "10000000-0000-4000-8000-000000000003";
const ESTATE = "10000000-0000-4000-8000-000000000004";
const ROW = "10000000-0000-4000-8000-000000000005";

type Case = { name: string; schema: ZodTypeAny; accepts: Record<string, unknown>[] };

const agentData: AgentProfilePayloadData = agentProfileSchema.parse({
  auth_user_id: STAFF,
  email: "agent@example.com",
  name_zh: "陳大文",
  name_en: "",
  job_title: "",
  phone: "9123 4567",
  whatsapp: "",
  licence_no: "",
  avatar_url: "/team/agent.jpg",
  branch: "",
  branch_id: "",
  bio: "",
  specialties: "深井\n荃灣",
  served_estate_slugs: "",
  public_slug: "",
  show_on_website: true,
  display_order: "",
  active: true,
}) as AgentProfilePayloadData;

const cases: Case[] = [
  // ---- Leads --------------------------------------------------------------
  {
    name: "bulkUpdateAdminLeads",
    schema: schemas.bulkUpdateAdminLeadsSchema,
    // src/routes/admin.leads.tsx runBulkUpdate: stage only, agent only, unassign, both.
    accepts: [
      { ids: [LEAD], stage: "contacted" },
      { ids: [LEAD], assignAgent: true, assigned_agent_id: STAFF },
      { ids: [LEAD], assignAgent: true, assigned_agent_id: null },
      { ids: [LEAD, ROW], stage: "won", assignAgent: true, assigned_agent_id: STAFF },
    ],
  },
  {
    name: "updateAdminLead",
    schema: schemas.adminLeadUpdateSchema,
    // src/routes/admin.leads.tsx draftToInput (not exported; copied output shape).
    accepts: [
      {
        id: LEAD,
        stage: "contacted",
        intent: "buyer",
        budget_min: null,
        budget_max: 8000000,
        preferred_estates: ["深井", "碧堤半島"],
        assigned_agent_id: null,
        note: null,
        expected_version: "v1",
      },
      {
        id: LEAD,
        stage: "new",
        intent: "tenant",
        budget_min: 15000,
        budget_max: 20000,
        preferred_estates: [],
        assigned_agent_id: STAFF,
        note: "睇樓後再跟進",
        expected_version: "v2",
      },
    ],
  },
  {
    name: "createAdminLeadActivity",
    schema: schemas.adminLeadActivitySchema,
    // src/routes/admin.leads.tsx save() and addNote(): contact_id may be null.
    accepts: [
      {
        lead_id: LEAD,
        contact_id: CONTACT,
        activity_type: "note",
        body: "已致電",
        due_at: null,
        completed_at: null,
      },
      {
        lead_id: LEAD,
        contact_id: null,
        activity_type: "note",
        body: "已致電",
        due_at: null,
        completed_at: null,
      },
      // AdminLeadActivityInput: contact_id is optional and ignored by the server.
      {
        lead_id: LEAD,
        activity_type: "follow_up",
        body: "下星期再約",
        due_at: "2026-10-12T02:00:00.000Z",
        completed_at: null,
      },
    ],
  },
  {
    name: "completeAdminLeadActivity",
    schema: schemas.completeAdminLeadActivitySchema,
    // No UI caller; the wrapper's type is { activity_id, lead_id }.
    accepts: [{ activity_id: ROW, lead_id: LEAD }],
  },
  {
    name: "updateAdminInquiryStatus",
    schema: schemas.updateAdminInquiryStatusSchema,
    // No UI caller; the server allowlists the status.
    accepts: [{ id: ROW, status: "contacted" }],
  },
  {
    name: "approveAdminAiTag / rejectAdminAiTag",
    schema: schemas.adminAiTagDecisionSchema,
    // src/routes/admin.leads.tsx decideAiTag.
    accepts: [{ tagId: ROW }],
  },
  {
    name: "saveAdminCrmSegment",
    schema: schemas.adminCrmSegmentSaveSchema,
    // src/routes/admin.segments.tsx saveSegment: id is `selectedSegmentId || undefined`;
    // the filters come from the preview or the stored segment (normalized by the server).
    accepts: [
      {
        id: undefined,
        name: "深井買家",
        description: null,
        natural_language_prompt: "想買深井的客",
        structured_filters: { intent: "buyer", preferred_estates: ["深井"] },
        status: "draft",
      },
      {
        id: ROW,
        name: "深井買家",
        description: null,
        natural_language_prompt: "想買深井的客",
        structured_filters: { budget: { min: null, max: 9000000 }, legacy_key: true },
        status: "active",
      },
    ],
  },
  {
    name: "materializeAdminCrmSegment / createAdminAudienceFromSegment",
    schema: schemas.adminCrmSegmentIdSchema,
    // src/routes/admin.segments.tsx.
    accepts: [{ segmentId: ROW }],
  },
  // ---- Transactions -------------------------------------------------------
  {
    name: "saveAdminTransaction",
    schema: schemas.adminTransactionSchema,
    // src/components/dashboard/TransactionForm.tsx handleSubmit payload (after its form schema):
    // create (id undefined) and edit.
    accepts: [
      {
        id: undefined,
        estate_id: ESTATE,
        deal_type: "sale",
        price: 6800000,
        saleable_area: 520,
        deal_date: "2026-09-30",
        unit: null,
        block: null,
        floor_band: null,
        source: "陳大文",
        source_url: null,
        verified: false,
        published: false,
      },
      {
        id: ROW,
        estate_id: ESTATE,
        deal_type: "rent",
        price: 18500.5,
        saleable_area: 400,
        deal_date: "2026-09-01",
        unit: "A",
        block: "2座",
        floor_band: "中層",
        source: "土地註冊處",
        source_url: "https://example.com/deal",
        verified: true,
        published: true,
      },
    ],
  },
  // ---- Listings / staff ---------------------------------------------------
  {
    name: "saveAdminProperty",
    schema: schemas.adminPropertySchema,
    // src/components/dashboard/PropertyForm.tsx handleSubmit payload.
    accepts: [
      {
        id: undefined,
        listing_no: "EP-1001",
        title_zh: "深井碧堤半島",
        title_en: null,
        deal_type: "sale",
        estate_id: null,
        district_slug: "sham-tseng",
        address: null,
        price: 6800000,
        rent: null,
        saleable_area: 520,
        bedrooms: 2,
        bathrooms: null,
        floor: null,
        description: null,
        features: normalizePropertyFeatures("海景\n會所"),
        video_url: null,
        status: "draft",
        featured: false,
        images: [],
        agent_id: null,
        seo_title: null,
        seo_description: null,
      },
      {
        id: undefined,
        listing_no: "EP-1002",
        title_zh: "租盤",
        title_en: "Rental",
        deal_type: "rent",
        estate_id: ESTATE,
        district_slug: "tsuen-wan",
        address: "荃灣",
        price: null,
        rent: 18000,
        saleable_area: null,
        bedrooms: null,
        bathrooms: 1,
        floor: "高層",
        description: "近港鐵",
        features: normalizePropertyFeatures(""),
        video_url: "https://www.youtube.com/watch?v=abc",
        status: "active",
        featured: true,
        images: ["https://cdn.example.com/a.jpg"],
        agent_id: STAFF,
        seo_title: "SEO",
        seo_description: "描述",
      },
    ],
  },
  {
    name: "updateAdminPropertyStatus",
    schema: schemas.adminPropertyStatusSchema,
    // No UI caller; the wrapper's type is { id, status }.
    accepts: [{ id: ROW, status: "offline" }],
  },
  {
    name: "saveAdminAgentProfile",
    schema: schemas.adminAgentProfileSchema,
    // The real builder AgentProfileForm.tsx calls, with and without identity fields.
    accepts: [
      buildAgentProfilePayload({ profileId: undefined, data: agentData, canManageIdentity: true }),
      buildAgentProfilePayload({ profileId: ROW, data: agentData, canManageIdentity: false }),
      buildAgentProfilePayload({
        profileId: ROW,
        data: { ...agentData, display_order: 3, active: false },
        canManageIdentity: true,
      }),
    ],
  },
  // ---- CMS ----------------------------------------------------------------
  {
    name: "saveAdminCmsVideo",
    schema: schemas.adminCmsVideoSchema,
    // src/routes/admin.cms.tsx: emptyCmsVideo (create) and cmsVideoToInput (edit).
    accepts: [
      {
        title: "深井介紹",
        video_url: "https://www.youtube.com/watch?v=abc",
        description: null,
        sort_order: 0,
        published: true,
        category: null,
      },
      {
        id: ROW,
        title: "深井介紹",
        video_url: "https://youtu.be/abc",
        description: "介紹",
        sort_order: 3,
        published: false,
        category: "屋苑",
        expected_version: "abc123",
      },
    ],
  },
  {
    name: "saveAdminFaq",
    schema: schemas.adminFaqSchema,
    accepts: [
      // src/routes/admin.cms.tsx: emptyFaq (create) and faqToInput (edit).
      { scope: "general", question: "Q", answer: "A", sort_order: 0 },
      {
        id: ROW,
        scope: "general",
        question: "Q",
        answer: "A",
        sort_order: 2,
        expected_version: "abc123",
      },
      // src/routes/admin.cms.tsx handleImportFaqs.
      { scope: "estate:x", question: "Q", answer: "A", sort_order: 1, upsert: true },
      // src/components/admin/estates/AdminEstateEditorForm.tsx handleSaveFaq (new FAQ).
      {
        id: undefined,
        scope: "estate:x",
        question: "Q",
        answer: "A",
        sort_order: 0,
        expected_version: undefined,
      },
    ],
  },
  {
    name: "deleteAdminFaq / restoreAdminFaq / deleteAdminAudience / cancelAdminCampaign",
    schema: schemas.adminRowIdSchema,
    accepts: [{ id: ROW }],
  },
  {
    name: "updateAdminMediaAsset",
    schema: schemas.adminMediaAssetUpdateSchema,
    // src/routes/admin.cms.tsx handleSaveMedia.
    accepts: [
      { id: ROW, alt_text: null, owner_type: "general", owner_id: null },
      { id: ROW, alt_text: "外觀", owner_type: "estate", owner_id: ESTATE },
    ],
  },
  {
    name: "saveAdminCmsDraft",
    schema: schemas.cmsDraftSaveSchema,
    accepts: [
      // src/components/admin/estates/AdminEstateEditorForm.tsx handleSave (new estate).
      {
        resourceType: "estate",
        resourceId: undefined,
        payload: { slug: "x", name_zh: "屋苑", facilities: ["會所"], year_completed: 2001 },
        basePublishedVersion: null,
        draftRevisionId: null,
        draftEditVersion: null,
      },
      // src/routes/admin.cms.tsx article save.
      {
        resourceType: "article",
        resourceId: ROW,
        payload: { id: ROW, slug: "a", title: "T", published: false, published_at: null },
        basePublishedVersion: 2,
        draftRevisionId: ROW,
        draftEditVersion: 4,
      },
    ],
  },
  {
    name: "publishAdminCmsRevision",
    schema: schemas.cmsPublishSchema,
    // src/routes/admin.cms.tsx and AdminEstateEditorForm.tsx handlePublish.
    accepts: [
      {
        resourceType: "estate",
        resourceId: ROW,
        revisionId: ROW,
        basePublishedVersion: null,
        draftEditVersion: 1,
      },
      {
        resourceType: "article",
        resourceId: ROW,
        revisionId: ROW,
        basePublishedVersion: 3,
        draftEditVersion: null,
      },
    ],
  },
  {
    name: "restoreAdminCmsRevision",
    schema: schemas.cmsRestoreSchema,
    accepts: [{ revisionId: ROW }],
  },
  {
    name: "archiveAdminCmsResource",
    schema: schemas.cmsArchiveSchema,
    accepts: [
      { resourceType: "estate", resourceId: ROW },
      { resourceType: "article", resourceId: ROW },
    ],
  },
  // ---- Campaigns ----------------------------------------------------------
  {
    name: "saveAdminAudience",
    schema: schemas.adminAudienceSchema,
    // src/routes/admin.blasts.tsx handleSaveAudience: normalizeAudienceFilters (not exported)
    // writes every key, undefined when blank.
    accepts: [
      {
        name: "深井買家",
        description: null,
        filters: {
          intent: undefined,
          source: undefined,
          estates: undefined,
          district_slug: undefined,
          assigned_agent_id: undefined,
          budget_min: undefined,
          budget_max: undefined,
          last_activity_days: undefined,
          require_whatsapp_opt_in: undefined,
        },
      },
      {
        id: ROW,
        name: "深井買家",
        description: "說明",
        filters: {
          intent: "buyer",
          source: "website",
          estates: ["深井"],
          district_slug: "sham-tseng",
          assigned_agent_id: STAFF,
          budget_min: 1000000,
          budget_max: 9000000,
          last_activity_days: 30,
          require_whatsapp_opt_in: true,
        },
      },
    ],
  },
  {
    name: "saveAdminCampaign",
    schema: schemas.adminCampaignSchema,
    // The real builder admin.blasts.tsx calls (create, then the saved draft with its id).
    accepts: [
      campaignSavePayload({
        name: " 十月推廣 ",
        template_id: ROW,
        audience_id: ROW,
        status: "draft",
        scheduled_at: null,
      }),
      campaignSavePayload({
        id: ROW,
        name: "十月推廣",
        template_id: ROW,
        audience_id: null,
        status: "review",
        scheduled_at: "2026-10-20T02:00:00.000Z",
      }),
    ],
  },
  {
    name: "materializeCampaignRecipients",
    schema: schemas.campaignIdSchema,
    // No UI caller; the wrapper's type is { campaign_id }.
    accepts: [{ campaign_id: ROW }],
  },
  {
    name: "requeueFailedCampaignRecipients",
    schema: schemas.requeueFailedCampaignRecipientsSchema,
    // src/routes/admin.blasts.tsx handleConfirmRetry: { campaignId: campaign.id, expectedCount }.
    accepts: [
      { campaignId: ROW, expectedCount: 3 },
      { campaignId: ROW, expectedCount: 0 },
    ],
  },
  {
    name: "finishCampaignWithoutSending",
    schema: schemas.finishCampaignWithoutSendingSchema,
    // src/routes/admin.blasts.tsx handleConfirmFinish: { campaignId: campaign.id }.
    accepts: [{ campaignId: ROW }],
  },
  // ---- WhatsApp -------------------------------------------------------------
  {
    name: "clearContactWhatsappOptOut",
    schema: schemas.clearContactWhatsappOptOutSchema,
    // No UI caller in src (retained for stale clients, writes nothing). The last
    // client to call it (removed in 6d5c016c) sent { contactId, reason }.
    accepts: [{ contactId: CONTACT, reason: "客戶要求恢復接收" }],
  },
];

describe("staff write schemas", () => {
  for (const { name, schema, accepts } of cases) {
    test(`${name} accepts the payload its UI sends`, () => {
      for (const payload of accepts) {
        const parsed = schema.safeParse(payload);
        expect(parsed.error?.issues ?? []).toEqual([]);
        // Nothing is stripped or rewritten: the server receives what the UI sent.
        expect(parsed.data).toEqual(payload);
        expect(Object.keys(parsed.data as object).sort()).toEqual(Object.keys(payload).sort());
      }
    });

    test(`${name} rejects an unknown key`, () => {
      const parsed = schema.safeParse({ ...accepts[0], injected_column: "x" });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    });

    test(`${name} rejects a non-object`, () => {
      expect(schema.safeParse(null).success).toBe(false);
      expect(schema.safeParse("x").success).toBe(false);
    });
  }
});

describe("wrong types are refused", () => {
  test("a lead update with a string budget", () => {
    const payload = cases.find((item) => item.name === "updateAdminLead")!.accepts[0];
    expect(schemas.adminLeadUpdateSchema.safeParse({ ...payload, budget_min: "100" }).success).toBe(
      false,
    );
  });
  test("a transaction with a string price", () => {
    const payload = cases.find((item) => item.name === "saveAdminTransaction")!.accepts[0];
    expect(schemas.adminTransactionSchema.safeParse({ ...payload, price: "1" }).success).toBe(
      false,
    );
  });
  test("a property with an unknown status or a non-string image", () => {
    const payload = cases.find((item) => item.name === "saveAdminProperty")!.accepts[0];
    expect(schemas.adminPropertySchema.safeParse({ ...payload, status: "deleted" }).success).toBe(
      false,
    );
    expect(schemas.adminPropertySchema.safeParse({ ...payload, images: [1] }).success).toBe(false);
  });
  test("an audience filter with an unknown key", () => {
    expect(
      schemas.adminAudienceSchema.safeParse({
        name: "x",
        description: null,
        filters: { opted_out: true },
      }).success,
    ).toBe(false);
  });
  test("a requeue with a negative or fractional count, or an opt-out clear without a reason", () => {
    const requeue = schemas.requeueFailedCampaignRecipientsSchema;
    expect(requeue.safeParse({ campaignId: ROW, expectedCount: -1 }).success).toBe(false);
    expect(requeue.safeParse({ campaignId: ROW, expectedCount: 1.5 }).success).toBe(false);
    expect(requeue.safeParse({ campaignId: ROW }).success).toBe(false);
    expect(schemas.finishCampaignWithoutSendingSchema.safeParse({}).success).toBe(false);
    const clear = schemas.clearContactWhatsappOptOutSchema;
    expect(clear.safeParse({ contactId: "not-a-uuid", reason: "x" }).success).toBe(false);
    expect(clear.safeParse({ contactId: CONTACT, reason: "   " }).success).toBe(false);
    expect(clear.safeParse({ contactId: CONTACT, reason: "x".repeat(501) }).success).toBe(false);
  });
  test("a CMS draft for an unknown resource type, or with a non-object payload", () => {
    expect(
      schemas.cmsDraftSaveSchema.safeParse({ resourceType: "user", payload: {} }).success,
    ).toBe(false);
    expect(
      schemas.cmsDraftSaveSchema.safeParse({ resourceType: "estate", payload: ["x"] }).success,
    ).toBe(false);
  });
});

/**
 * Every POST server function in admin-data.ts / admin-cms.ts must run a real
 * validator. The listed exceptions are read-only POSTs, or writes whose server
 * module already parses the input with its own strict Zod schema.
 */
describe("no staff write keeps a pass-through validator", () => {
  const PASS_THROUGH_ALLOWED = new Set([
    // Read-only.
    "previewAdminCrmSegmentServer",
    "checkAdminFaqConflictsServer",
    // The server module parses `value: unknown` with a .strict() schema.
    "setWhatsappMarketingConsentServer", // whatsapp-consent.server.ts
    "clearAccidentalWhatsappOptOutServer", // whatsapp-opt-out.server.ts
    "dismissOptOutNearMissServer", // whatsapp-opt-out-near-miss.server.ts
    "resolveAdminUnknownOutboundServer", // woztell/outbound-resolution.server.ts
  ]);

  function postValidators(file: string) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const found: { name: string; passThrough: boolean; body: string }[] = [];
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const text = declaration.initializer?.getText(sf) ?? "";
        if (!/createServerFn\(\{\s*method:\s*"POST"\s*\}\)/.test(text)) continue;
        let passThrough = false;
        let body = "";
        const visit = (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "inputValidator"
          ) {
            const [arg] = node.arguments;
            if (arg && ts.isArrowFunction(arg)) {
              const param = arg.parameters[0]?.name.getText(sf);
              passThrough = ts.isIdentifier(arg.body) && arg.body.text === param;
              body = arg.body.getText(sf);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(declaration.initializer!);
        found.push({ name: declaration.name.getText(sf), passThrough, body });
      }
    }
    return found;
  }

  test("admin-data.ts and admin-cms.ts", () => {
    const all = [
      ...postValidators("src/lib/neon/admin-data.ts"),
      ...postValidators("src/lib/neon/admin-cms.ts"),
    ];
    expect(all.length).toBeGreaterThan(30);
    const passThrough = all.filter((item) => item.passThrough).map((item) => item.name);
    expect(passThrough.filter((name) => !PASS_THROUGH_ALLOWED.has(name))).toEqual([]);
    // The allowlist cannot go stale.
    for (const name of PASS_THROUGH_ALLOWED) expect(passThrough).toContain(name);
  });

  test("each staff write parses its input with its own schema", () => {
    const expected: Record<string, keyof typeof schemas> = {
      saveAdminAgentProfileServer: "adminAgentProfileSchema",
      saveAdminPropertyServer: "adminPropertySchema",
      saveAdminCmsVideoServer: "adminCmsVideoSchema",
      saveAdminCrmSegmentServer: "adminCrmSegmentSaveSchema",
      materializeAdminCrmSegmentServer: "adminCrmSegmentIdSchema",
      createAdminAudienceFromSegmentServer: "adminCrmSegmentIdSchema",
      completeAdminLeadActivityServer: "completeAdminLeadActivitySchema",
      updateAdminInquiryStatusServer: "updateAdminInquiryStatusSchema",
      saveAdminFaqServer: "adminFaqSchema",
      deleteAdminFaqServer: "adminRowIdSchema",
      restoreAdminFaqServer: "adminRowIdSchema",
      bulkUpdateAdminLeadsServer: "bulkUpdateAdminLeadsSchema",
      updateAdminMediaAssetServer: "adminMediaAssetUpdateSchema",
      updateAdminPropertyStatusServer: "adminPropertyStatusSchema",
      saveAdminTransactionServer: "adminTransactionSchema",
      approveAdminAiTagServer: "adminAiTagDecisionSchema",
      rejectAdminAiTagServer: "adminAiTagDecisionSchema",
      updateAdminLeadServer: "adminLeadUpdateSchema",
      createAdminLeadActivityServer: "adminLeadActivitySchema",
      saveAdminAudienceServer: "adminAudienceSchema",
      deleteAdminAudienceServer: "adminRowIdSchema",
      saveAdminCampaignServer: "adminCampaignSchema",
      materializeCampaignRecipientsServer: "campaignIdSchema",
      cancelAdminCampaignServer: "adminRowIdSchema",
      requeueFailedCampaignRecipientsServer: "requeueFailedCampaignRecipientsSchema",
      finishCampaignWithoutSendingServer: "finishCampaignWithoutSendingSchema",
      clearContactWhatsappOptOutServer: "clearContactWhatsappOptOutSchema",
      saveAdminCmsDraftServer: "cmsDraftSaveSchema",
      publishAdminCmsRevisionServer: "cmsPublishSchema",
      restoreAdminCmsRevisionServer: "cmsRestoreSchema",
      archiveAdminCmsResourceServer: "cmsArchiveSchema",
    };
    const bodies = new Map(
      [
        ...postValidators("src/lib/neon/admin-data.ts"),
        ...postValidators("src/lib/neon/admin-cms.ts"),
      ].map((item) => [item.name, item.body]),
    );
    for (const [server, schema] of Object.entries(expected)) {
      expect(schemas[schema]).toBeDefined();
      expect({ server, body: bodies.get(server) }).toEqual({
        server,
        body: `${schema}.parse(data)`,
      });
    }
  });
});
