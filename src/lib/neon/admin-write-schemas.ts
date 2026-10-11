/**
 * FX-19d-1 H-08: input schemas for the staff writes in admin-data.ts and
 * admin-cms.ts. Each one mirrors the wrapper's TypeScript input type and is
 * .strict(), so an unknown key or a wrong type is refused before the handler
 * runs. Business rules (lengths, formats, allowlists) stay where they already
 * are, in the server modules.
 *
 * Every schema accepts exactly what its admin UI sends; see
 * admin-write-schemas.test.ts, and the browser fixtures that parse the real
 * pages' payloads through these same schemas.
 */
import { z } from "zod";

import type { CmsArchiveInput, CmsPublishInput, CmsRestoreInput } from "./admin-cms.types";
import type {
  AdminAgentProfileMutationInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminCmsVideoInput,
  AdminFaqInput,
  AdminLeadActivityInput,
  AdminLeadUpdateInput,
  AdminPropertyInput,
  AdminTransactionInput,
} from "./admin-data.types";
import type { CrmSegmentFilters } from "@/lib/ai/ai-types";
import { CMS_RESOURCE_TYPES } from "./cms-revisions";

const text = z.string();
const nullableText = z.string().nullable();
const plainObject = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ---- Leads ----------------------------------------------------------------

export const bulkUpdateAdminLeadsSchema = z
  .object({
    ids: z.array(text),
    stage: text.optional(),
    assigned_agent_id: nullableText.optional(),
    assignAgent: z.boolean().optional(),
  })
  .strict();

export const adminLeadUpdateSchema = z
  .object({
    id: text,
    stage: text,
    intent: text,
    budget_min: z.number().nullable(),
    budget_max: z.number().nullable(),
    preferred_estates: z.array(text),
    assigned_agent_id: nullableText,
    note: nullableText,
    expected_version: text,
  })
  .strict() satisfies z.ZodType<AdminLeadUpdateInput>;

export const adminLeadActivitySchema = z
  .object({
    lead_id: text,
    contact_id: nullableText.optional(),
    activity_type: z.enum(["note", "call", "viewing", "follow_up"]),
    body: text,
    due_at: nullableText,
    completed_at: nullableText,
  })
  .strict() satisfies z.ZodType<AdminLeadActivityInput>;

export const completeAdminLeadActivitySchema = z
  .object({ activity_id: text, lead_id: text })
  .strict();

export const updateAdminInquiryStatusSchema = z.object({ id: text, status: text }).strict();

export const adminAiTagDecisionSchema = z.object({ tagId: text }).strict();

export const adminCrmSegmentSaveSchema = z
  .object({
    id: text.optional(),
    name: text,
    description: nullableText,
    natural_language_prompt: text,
    // A filter object from the preview or a stored segment. The server
    // normalizes it (normalizeSegmentFilters) before it is stored.
    structured_filters: z.custom<CrmSegmentFilters>(plainObject, "Expected a filter object"),
    status: z.enum(["draft", "active", "archived"]),
  })
  .strict();

export const adminCrmSegmentIdSchema = z.object({ segmentId: text }).strict();

// ---- Transactions ---------------------------------------------------------

export const adminTransactionSchema = z
  .object({
    id: text.optional(),
    estate_id: text,
    deal_type: z.enum(["sale", "rent"]),
    price: z.number(),
    saleable_area: z.number(),
    deal_date: text,
    unit: nullableText,
    block: nullableText,
    floor_band: nullableText,
    source: nullableText,
    source_url: nullableText,
    verified: z.boolean(),
    published: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<AdminTransactionInput>;

// ---- Listings and staff ---------------------------------------------------

const propertyStatus = z.enum(["draft", "active", "sold", "rented", "offline"]);

export const adminPropertySchema = z
  .object({
    id: text.optional(),
    listing_no: text,
    title_zh: text,
    title_en: nullableText,
    deal_type: z.enum(["sale", "rent"]),
    estate_id: nullableText,
    district_slug: text,
    address: nullableText,
    price: z.number().nullable(),
    rent: z.number().nullable(),
    saleable_area: z.number().nullable(),
    bedrooms: z.number().nullable(),
    bathrooms: z.number().nullable(),
    floor: nullableText,
    description: nullableText,
    features: z.array(text),
    status: propertyStatus,
    featured: z.boolean(),
    images: z.array(text),
    agent_id: nullableText,
    seo_title: nullableText.optional(),
    seo_description: nullableText.optional(),
    video_url: nullableText.optional(),
  })
  .strict() satisfies z.ZodType<AdminPropertyInput>;

export const adminPropertyStatusSchema = z.object({ id: text, status: propertyStatus }).strict();

export const adminAgentProfileSchema = z
  .object({
    id: text.optional(),
    // Present only when the editor may manage identity; the server reads their
    // presence (hasOwnProperty), and a parse keeps an absent key absent.
    auth_user_id: nullableText.optional(),
    email: nullableText.optional(),
    active: z.boolean().optional(),
    name_zh: nullableText,
    name_en: nullableText,
    job_title: nullableText,
    phone: nullableText,
    whatsapp: nullableText,
    licence_no: nullableText,
    avatar_url: nullableText,
    branch: nullableText,
    branch_id: nullableText,
    bio: nullableText,
    specialties: z.array(text),
    served_estate_slugs: z.array(text),
    public_slug: nullableText,
    show_on_website: z.boolean(),
    display_order: z.number().nullable(),
  })
  .strict() satisfies z.ZodType<AdminAgentProfileMutationInput>;

// ---- CMS ------------------------------------------------------------------

export const adminCmsVideoSchema = z
  .object({
    id: text.optional(),
    title: text,
    video_url: text,
    description: nullableText,
    sort_order: z.number(),
    published: z.boolean(),
    category: nullableText,
    expected_version: text.optional(),
  })
  .strict() satisfies z.ZodType<AdminCmsVideoInput>;

export const adminFaqSchema = z
  .object({
    id: text.optional(),
    scope: text,
    question: text,
    answer: text,
    sort_order: z.number(),
    upsert: z.boolean().optional(),
    expected_version: text.optional(),
  })
  .strict() satisfies z.ZodType<AdminFaqInput>;

/** `{ id }`: deleteAdminFaq, restoreAdminFaq, deleteAdminAudience, cancelAdminCampaign. */
export const adminRowIdSchema = z.object({ id: text }).strict();

export const adminMediaAssetUpdateSchema = z
  .object({
    id: text,
    alt_text: nullableText,
    owner_type: text,
    owner_id: nullableText,
  })
  .strict();

const cmsResourceType = z.enum(CMS_RESOURCE_TYPES);

export const cmsDraftSaveSchema = z
  .object({
    resourceType: cmsResourceType,
    resourceId: text.optional(),
    draftRevisionId: nullableText.optional(),
    // The resource's own fields; validatePayload checks them per resource type.
    payload: z.record(z.string(), z.unknown()),
    basePublishedVersion: z.number().nullable().optional(),
    restoredFromRevisionId: nullableText.optional(),
    draftEditVersion: z.number().nullable().optional(),
  })
  .strict();

export const cmsPublishSchema = z
  .object({
    resourceType: cmsResourceType,
    resourceId: text,
    revisionId: text,
    basePublishedVersion: z.number().nullable().optional(),
    draftEditVersion: z.number().nullable().optional(),
  })
  .strict() satisfies z.ZodType<CmsPublishInput>;

export const cmsRestoreSchema = z
  .object({ revisionId: text })
  .strict() satisfies z.ZodType<CmsRestoreInput>;

export const cmsArchiveSchema = z
  .object({ resourceType: cmsResourceType, resourceId: text })
  .strict() satisfies z.ZodType<CmsArchiveInput>;

// ---- Campaigns ------------------------------------------------------------

export const adminAudienceSchema = z
  .object({
    id: text.optional(),
    name: text,
    description: nullableText,
    filters: z
      .object({
        intent: text.optional(),
        source: text.optional(),
        estates: z.array(text).optional(),
        district_slug: text.optional(),
        assigned_agent_id: text.optional(),
        budget_min: z.number().optional(),
        budget_max: z.number().optional(),
        last_activity_days: z.number().optional(),
        require_whatsapp_opt_in: z.boolean().optional(),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<AdminAudienceInput>;

export const adminCampaignSchema = z
  .object({
    id: text.optional(),
    name: text,
    template_id: nullableText,
    audience_id: nullableText,
    status: z.enum(["draft", "review", "scheduled"]),
    scheduled_at: nullableText,
  })
  .strict() satisfies z.ZodType<AdminCampaignInput>;

export const campaignIdSchema = z.object({ campaign_id: text }).strict();
