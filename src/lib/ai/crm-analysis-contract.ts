import { z } from "zod";

export const CRM_ANALYSIS_SCHEMA_VERSION = "crm-analysis-v2";
export const CRM_ANALYSIS_PROMPT_VERSION = "crm-analysis-20261003";
export const crmActionTypes = [
  "mark_test",
  "complete_contact",
  "verify_source",
  "review_enquiry",
  "service_reply",
  "marketing_review",
] as const;
export type CrmActionType = (typeof crmActionTypes)[number];
export type AiResultKind = "model_validated" | "deterministic" | "fallback" | "failed";
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const analysisSchema = z
  .object({
    summary: boundedText(2000),
    urgency: z.enum(["normal", "recent", "high"]).nullable(),
    timeline: z.enum(["30_days", "90_days", "later", "unknown"]).nullable(),
    action: z.object({ type: z.enum(crmActionTypes), reason: boundedText(500) }).strict(),
    suggested_tags: z
      .array(
        z
          .object({
            tag: boundedText(80),
            confidence: z.number().finite().min(0).max(1),
            reason: boundedText(500),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type CrmAnalysis = z.infer<typeof analysisSchema>;
export type CrmAnalysisValidation =
  | { ok: true; value: CrmAnalysis }
  | { ok: false; code: "INVALID_ANALYSIS"; issues: readonly string[] };
export function validateCrmAnalysis(value: unknown): CrmAnalysisValidation {
  const result = analysisSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        code: "INVALID_ANALYSIS",
        issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`),
      };
}
