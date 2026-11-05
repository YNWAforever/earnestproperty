// Owned browser fixture only: no provider, database or network call.
import type {
  ContentCopilotRequest,
  ContentCopilotProposal,
} from "../../../src/lib/ai/content-copilot";
import { articleCopilotValues } from "../../../src/components/admin/blog/article-copilot-state";
import { fixture as blog } from "./synthetic-blog";
export const copilotFixture = {
  generationCalls: 0,
  decisionCalls: 0,
  failGenerate: sessionStorage.getItem("copilot-fail-generate") === "yes",
  failDecision: false,
  generateDelayMs: Number(sessionStorage.getItem("copilot-delay") ?? 0),
  decisionDelayMs: 0,
};
(window as unknown as { copilotFixture: typeof copilotFixture }).copilotFixture = copilotFixture;
export async function generateAdminContentProposal({ data }: { data: ContentCopilotRequest }) {
  copilotFixture.generationCalls++;
  const article = blog.records().find((a) => a.id === data.resourceId)!;
  const before = articleCopilotValues(article);
  await new Promise((resolve) => setTimeout(resolve, copilotFixture.generateDelayMs));
  if (copilotFixture.failGenerate)
    return { ok: false, proposal: null, error: "COPILOT_GENERATION_FAILED" };
  const proposal: ContentCopilotProposal & { id: string; selectedFields: string[] } = {
    id: "70000000-0000-4000-8000-000000009001",
    resourceType: "article",
    sourceFingerprint: "a".repeat(64),
    selectedFields: data.selectedFields,
    patches: data.selectedFields.map((field) => ({
      field,
      before: before[field],
      after:
        field === "content"
          ? "  <b>建議文字</b>\n第二段  "
          : field === "title"
            ? "建議標題"
            : "建議摘要",
      reason: "合成建議",
      confidence: "high",
      evidenceIds: [],
      unsupportedClaims: [],
      claimType: "subjective",
    })),
    evidence: [],
    warnings: [],
  };
  return { ok: true, proposal, error: null };
}
export async function decideAdminContentProposal() {
  copilotFixture.decisionCalls++;
  await new Promise((resolve) => setTimeout(resolve, copilotFixture.decisionDelayMs));
  return copilotFixture.failDecision
    ? { ok: false, error: "COPILOT_DECISION_FAILED" }
    : { ok: true, error: null };
}
