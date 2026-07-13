import { z } from "zod";

export const CONTENT_COPILOT_RESOURCE_FIELDS = {
  estate: ["name_zh", "name_en", "description", "seo_title", "seo_description"],
  article: ["title", "excerpt", "content", "seo_title", "seo_description"],
  faq: ["question", "answer"],
  video: ["title", "description"],
  listing: ["title_zh", "title_en", "description", "features", "seo_title", "seo_description"],
} as const;

export type ContentCopilotResourceType = keyof typeof CONTENT_COPILOT_RESOURCE_FIELDS;
export type ContentCopilotAction =
  | "generate"
  | "improve"
  | "shorten"
  | "translate"
  | "seo_optimize"
  | "fact_check";
export type ContentCopilotTone =
  | "professional_property"
  | "concise_portal"
  | "cantonese_conversational"
  | "neutral_informational";
export type ContentCopilotResearchMode = "internal" | "web";
export type ContentCopilotValue = string | string[] | null;

export type ContentCopilotRequest = {
  resourceType: ContentCopilotResourceType;
  resourceId: string;
  action: ContentCopilotAction;
  selectedFields: string[];
  tone: ContentCopilotTone;
  targetLanguage: "zh-HK" | "en" | null;
  researchMode: ContentCopilotResearchMode;
};

export type ContentCopilotEvidence = {
  id: string;
  type: "internal" | "web";
  title: string;
  url: string | null;
  excerpt: string;
};

export type ContentCopilotPatch = {
  field: string;
  before: ContentCopilotValue;
  after: ContentCopilotValue;
  reason: string;
  confidence: "high" | "medium" | "low";
  evidenceIds: string[];
  unsupportedClaims: string[];
  claimType: "subjective" | "factual_internal" | "factual_web";
};

export type ContentCopilotProposal = {
  resourceType: ContentCopilotResourceType;
  sourceFingerprint: string;
  patches: ContentCopilotPatch[];
  evidence: ContentCopilotEvidence[];
  warnings: string[];
};

export type ContentCopilotPatchApplyOptions = {
  resourceType: ContentCopilotResourceType;
  sourceFingerprint: string;
  currentFingerprint: string;
};

export type ContentCopilotPatchApplyResult =
  | { ok: true; value: Record<string, ContentCopilotValue>; error: null }
  | {
      ok: false;
      value: null;
      error:
        | "COPILOT_UNKNOWN_FIELD"
        | "COPILOT_STALE_PROPOSAL"
        | "COPILOT_PATCH_CONFLICT"
        | "COPILOT_FINGERPRINT_INVALID";
    };

const valueSchema = z.union([
  z.string().max(12000),
  z.array(z.string().max(300)).max(30),
  z.null(),
]);

const patchSchema = z.object({
  field: z.string(),
  before: valueSchema,
  after: valueSchema,
  reason: z.string().max(500),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceIds: z.array(z.string()).max(20),
  unsupportedClaims: z.array(z.string().max(500)).max(20),
  claimType: z.enum(["subjective", "factual_internal", "factual_web"]),
});

const resourceTypeSchema = z.enum(["estate", "article", "faq", "video", "listing"]);
const actionSchema = z.enum([
  "generate",
  "improve",
  "shorten",
  "translate",
  "seo_optimize",
  "fact_check",
]);
const evidenceBaseSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().max(300),
  excerpt: z.string().max(1000),
});
const evidenceSchema = z.discriminatedUnion("type", [
  evidenceBaseSchema.extend({
    type: z.literal("internal"),
    url: z
      .string()
      .nullable()
      .refine((url) => url === null || normalizeCitationUrl(url) !== null, "COPILOT_UNSAFE_URL"),
  }),
  evidenceBaseSchema.extend({
    type: z.literal("web"),
    url: z
      .string()
      .refine((url) => normalizeCitationUrl(url) !== null, "COPILOT_WEB_CITATION_REQUIRED"),
  }),
]);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const proposalSchema = z.object({
  resourceType: resourceTypeSchema,
  sourceFingerprint: fingerprintSchema,
  patches: z.array(patchSchema).max(12),
  evidence: z.array(evidenceSchema).max(20),
  warnings: z.array(z.string().max(500)).max(20),
});

export const contentCopilotRequestSchema = z
  .object({
    resourceType: resourceTypeSchema,
    resourceId: z.string().uuid(),
    action: actionSchema,
    selectedFields: z.array(z.string()).min(1).max(6),
    tone: z.enum([
      "professional_property",
      "concise_portal",
      "cantonese_conversational",
      "neutral_informational",
    ]),
    targetLanguage: z.enum(["zh-HK", "en"]).nullable(),
    researchMode: z.enum(["internal", "web"]).default("internal"),
  })
  .superRefine((request, context) => {
    const allowed = new Set(allowedContentCopilotFields(request.resourceType));
    for (const field of request.selectedFields) {
      if (!allowed.has(field)) {
        context.addIssue({
          code: "custom",
          message: "COPILOT_UNKNOWN_FIELD",
          path: ["selectedFields"],
        });
      }
    }
  });

export function allowedContentCopilotFields(resourceType: ContentCopilotResourceType): string[] {
  return [...CONTENT_COPILOT_RESOURCE_FIELDS[resourceType]] as string[];
}

export async function buildContentFingerprint(value: Record<string, unknown>) {
  const stable = JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeCitationUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function extractStructuredJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export function validateContentCopilotProposal(value: unknown) {
  const parsed = proposalSchema.safeParse(value);
  if (!parsed.success)
    return { ok: false as const, value: null, error: "COPILOT_PROPOSAL_INVALID" };
  const allowed = new Set(allowedContentCopilotFields(parsed.data.resourceType));
  const evidenceIds = new Set(parsed.data.evidence.map((item) => item.id));
  const evidenceById = new Map(parsed.data.evidence.map((item) => [item.id, item]));
  for (const patch of parsed.data.patches) {
    if (!allowed.has(patch.field))
      return { ok: false as const, value: null, error: "COPILOT_UNKNOWN_FIELD" };
    if (patch.evidenceIds.some((id) => !evidenceIds.has(id)))
      return { ok: false as const, value: null, error: "COPILOT_EVIDENCE_MISSING" };
    if (patch.claimType === "factual_internal" && patch.evidenceIds.length === 0) {
      return { ok: false as const, value: null, error: "COPILOT_EVIDENCE_REQUIRED" };
    }
    if (
      patch.claimType === "factual_web" &&
      !patch.evidenceIds.some((id) => evidenceById.get(id)?.type === "web")
    ) {
      return { ok: false as const, value: null, error: "COPILOT_CITATION_REQUIRED" };
    }
  }
  return { ok: true as const, value: parsed.data, error: null };
}

export function validatePersistedContentCopilotRecord(value: unknown) {
  const result = z
    .object({ resourceId: z.string().uuid(), persisted: z.literal(true) })
    .safeParse(value);
  if (!result.success)
    return { ok: false as const, value: null, error: "COPILOT_SAVE_FIRST" as const };
  return { ok: true as const, value: result.data, error: null };
}

export function applySelectedContentPatches(
  current: Record<string, ContentCopilotValue>,
  patches: ContentCopilotPatch[],
  selectedFields: string[],
  options: ContentCopilotPatchApplyOptions,
): ContentCopilotPatchApplyResult {
  const allowed = new Set(allowedContentCopilotFields(options.resourceType));
  const selected = new Set(selectedFields);
  if (
    !fingerprintSchema.safeParse(options.sourceFingerprint).success ||
    !fingerprintSchema.safeParse(options.currentFingerprint).success
  ) {
    return { ok: false, value: null, error: "COPILOT_FINGERPRINT_INVALID" };
  }
  if (options.sourceFingerprint !== options.currentFingerprint) {
    return { ok: false, value: null, error: "COPILOT_STALE_PROPOSAL" };
  }
  if (
    [...selected].some((field) => !allowed.has(field)) ||
    patches.some((patch) => !allowed.has(patch.field))
  ) {
    return { ok: false, value: null, error: "COPILOT_UNKNOWN_FIELD" };
  }
  const next = { ...current };
  for (const patch of patches) {
    if (!selected.has(patch.field) || patch.unsupportedClaims.length > 0) continue;
    if (!sameContentCopilotValue(current[patch.field] ?? null, patch.before)) {
      return { ok: false, value: null, error: "COPILOT_PATCH_CONFLICT" };
    }
    next[patch.field] = patch.after;
  }
  return { ok: true, value: next, error: null };
}

function sameContentCopilotValue(left: ContentCopilotValue, right: ContentCopilotValue) {
  return JSON.stringify(left) === JSON.stringify(right);
}
