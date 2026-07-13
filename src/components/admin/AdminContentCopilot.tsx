import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, FileText, Sparkles, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  allowedContentCopilotFields,
  applySelectedContentPatches,
  type ContentCopilotAction,
  type ContentCopilotPatch,
  type ContentCopilotProposal,
  type ContentCopilotResearchMode,
  type ContentCopilotResourceType,
  type ContentCopilotTone,
  type ContentCopilotValue,
} from "@/lib/ai/content-copilot";
import {
  contentCopilotCharacterCount,
  getContentCopilotPatchSelection,
} from "./content-copilot-ui";

type PanelState =
  | "disabled-unsaved"
  | "ready"
  | "generating"
  | "review"
  | "failed"
  | "stale"
  | "applied";

type ReviewProposal = ContentCopilotProposal & {
  id: string;
  selectedFields: string[];
};

const actionOptions: Array<{ value: ContentCopilotAction; label: string }> = [
  { value: "generate", label: "產生內容" },
  { value: "improve", label: "改善文案" },
  { value: "shorten", label: "精簡內容" },
  { value: "translate", label: "翻譯" },
  { value: "seo_optimize", label: "SEO 優化" },
  { value: "fact_check", label: "核對事實" },
];

const toneOptions: Array<{ value: ContentCopilotTone; label: string }> = [
  { value: "professional_property", label: "專業地產" },
  { value: "concise_portal", label: "精簡平台" },
  { value: "cantonese_conversational", label: "廣東話自然" },
  { value: "neutral_informational", label: "中立資訊" },
];

const languageOptions = [
  { value: "none", label: "維持原有語言" },
  { value: "zh-HK", label: "繁體中文（香港）" },
  { value: "en", label: "English" },
] as const;

const fieldLabels: Record<string, string> = {
  name_zh: "中文名稱",
  name_en: "英文名稱",
  title: "標題",
  title_zh: "中文標題",
  title_en: "英文標題",
  excerpt: "摘要",
  content: "內容",
  description: "描述",
  features: "特色",
  question: "問題",
  answer: "答案",
  seo_title: "SEO 標題",
  seo_description: "SEO 描述",
};

export function AdminContentCopilot({
  resourceType,
  resourceId,
  values,
  onApply,
}: {
  resourceType: ContentCopilotResourceType;
  resourceId: string | null;
  values: Record<string, ContentCopilotValue>;
  onApply: (patch: Record<string, ContentCopilotValue>) => void;
}) {
  const availableFields = useMemo(
    () => allowedContentCopilotFields(resourceType).filter((field) => Object.hasOwn(values, field)),
    [resourceType, values],
  );
  const [state, setState] = useState<PanelState>(resourceId ? "ready" : "disabled-unsaved");
  const [action, setAction] = useState<ContentCopilotAction>("improve");
  const [selectedFields, setSelectedFields] = useState<string[]>(() => availableFields.slice(0, 6));
  const [tone, setTone] = useState<ContentCopilotTone>("professional_property");
  const [targetLanguage, setTargetLanguage] = useState<"zh-HK" | "en" | null>(null);
  const [researchMode, setResearchMode] = useState<ContentCopilotResearchMode>("internal");
  const [proposal, setProposal] = useState<ReviewProposal | null>(null);
  const [acceptedFields, setAcceptedFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const displayState = resourceId
    ? state === "disabled-unsaved"
      ? "ready"
      : state
    : "disabled-unsaved";

  useEffect(() => {
    setSelectedFields((current) => {
      const retained = current.filter((field) => new Set<string>(availableFields).has(field));
      return retained.length ? retained : availableFields.slice(0, 6);
    });
  }, [availableFields]);

  function toggleField(field: string) {
    setSelectedFields((current) =>
      current.includes(field)
        ? current.filter((value) => value !== field)
        : [...current, field].slice(0, 6),
    );
  }

  function toggleAcceptedPatch(patch: ContentCopilotPatch) {
    if (patch.unsupportedClaims.length > 0) return;
    setAcceptedFields((current) =>
      current.includes(patch.field)
        ? current.filter((field) => field !== patch.field)
        : [...current, patch.field],
    );
  }

  async function generate() {
    if (!resourceId || selectedFields.length === 0) return;
    setState("generating");
    setError(null);
    setProposal(null);
    setAcceptedFields([]);

    try {
      const { generateAdminContentProposal } = await import("@/lib/ai/content-copilot-admin");
      const result = await generateAdminContentProposal({
        data: {
          resourceType,
          resourceId,
          action,
          selectedFields,
          tone,
          targetLanguage,
          researchMode,
        },
      });
      if (!result.ok || !isReviewProposal(result.proposal)) {
        setError(result.error || "COPILOT_GENERATION_FAILED");
        setState("failed");
        return;
      }
      setProposal(result.proposal);
      setAcceptedFields(
        result.proposal.patches
          .filter((patch) => patch.unsupportedClaims.length === 0)
          .map((patch) => patch.field),
      );
      setState("review");
    } catch {
      setError("COPILOT_GENERATION_FAILED");
      setState("failed");
    }
  }

  async function apply() {
    if (!proposal) return;
    setError(null);
    try {
      const { decideAdminContentProposal } = await import("@/lib/ai/content-copilot-admin");
      const decision = await decideAdminContentProposal({
        data: { proposalId: proposal.id, decision: "apply", acceptedFields },
      });
      if (!decision.ok) {
        setError(decision.error || "COPILOT_DECISION_FAILED");
        setState(decision.error === "COPILOT_STALE_PROPOSAL" ? "stale" : "failed");
        return;
      }
      const patchResult = applySelectedContentPatches(values, proposal.patches, acceptedFields, {
        resourceType,
        sourceFingerprint: proposal.sourceFingerprint,
        currentFingerprint: proposal.sourceFingerprint,
      });
      if (!patchResult.ok) {
        setError(patchResult.error);
        setState(patchResult.error === "COPILOT_STALE_PROPOSAL" ? "stale" : "failed");
        return;
      }
      onApply(patchResult.value);
      setState("applied");
    } catch {
      setError("COPILOT_DECISION_FAILED");
      setState("failed");
    }
  }

  return (
    <aside
      className="w-full space-y-4 rounded-md border bg-muted/20 p-4 lg:w-[24rem] lg:flex-none"
      data-content-copilot
      data-content-copilot-state={displayState}
      aria-label="AI 內容助手"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">AI 內容助手</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            建議只會套用到目前表單，仍需由你儲存或發佈。
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground" aria-label="內容助手說明">
                <FileText className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              只會處理可編輯的內容欄位，不會修改售價、狀態或已發佈資料。
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {displayState === "disabled-unsaved" ? (
        <p
          className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
          data-content-copilot-disabled
        >
          請先儲存一次，才可產生 AI 建議。
        </p>
      ) : null}
      {displayState === "generating" ? (
        <div className="space-y-2" aria-live="polite">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {displayState === "failed" || displayState === "stale" ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <TriangleAlert className="mr-2 inline size-4" aria-hidden="true" />
          {displayState === "stale"
            ? "內容已更新，請重新產生建議。"
            : `未能完成：${error ?? "COPILOT_GENERATION_FAILED"}`}
        </p>
      ) : null}
      {displayState === "applied" ? (
        <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <Check className="mr-2 inline size-4" aria-hidden="true" />
          已套用到目前表單，請使用原有儲存功能提交變更。
        </p>
      ) : null}

      <fieldset
        disabled={displayState === "disabled-unsaved" || displayState === "generating"}
        className="space-y-4"
      >
        <Control label="內容動作">
          <Select
            value={action}
            onValueChange={(value) => setAction(value as ContentCopilotAction)}
          >
            <SelectTrigger aria-label="內容動作">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <div>
          <p className="mb-2 text-sm font-medium">選擇欄位</p>
          <div className="space-y-2">
            {availableFields.map((field) => (
              <label key={field} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedFields.includes(field)}
                    onCheckedChange={() => toggleField(field)}
                    aria-label={fieldLabels[field] ?? field}
                  />
                  {fieldLabels[field] ?? field}
                </span>
                <span className="text-xs text-muted-foreground">
                  {contentCopilotCharacterCount(values[field])}
                </span>
              </label>
            ))}
          </div>
        </div>
        <Control label="語氣">
          <Select value={tone} onValueChange={(value) => setTone(value as ContentCopilotTone)}>
            <SelectTrigger aria-label="語氣">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {toneOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label="目標語言">
          <Select
            value={targetLanguage ?? "none"}
            onValueChange={(value) =>
              setTargetLanguage(value === "none" ? null : (value as "zh-HK" | "en"))
            }
          >
            <SelectTrigger aria-label="目標語言">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label="研究來源">
          <Select
            value={researchMode}
            onValueChange={(value) => setResearchMode(value as ContentCopilotResearchMode)}
          >
            <SelectTrigger aria-label="研究來源">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="internal">內部資料</SelectItem>
              <SelectItem value="web">內部資料及網頁研究</SelectItem>
            </SelectContent>
          </Select>
        </Control>
      </fieldset>

      {displayState !== "review" ? (
        <Button
          type="button"
          className="w-full"
          disabled={!resourceId || selectedFields.length === 0 || displayState === "generating"}
          onClick={generate}
        >
          <Sparkles aria-hidden="true" />
          產生建議
        </Button>
      ) : null}
      {displayState === "review" && proposal ? (
        <Review
          proposal={proposal}
          acceptedFields={acceptedFields}
          onTogglePatch={toggleAcceptedPatch}
          onApply={apply}
        />
      ) : null}
    </aside>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Review({
  proposal,
  acceptedFields,
  onTogglePatch,
  onApply,
}: {
  proposal: ReviewProposal;
  acceptedFields: string[];
  onTogglePatch: (patch: ContentCopilotPatch) => void;
  onApply: () => void;
}) {
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">建議內容</h3>
        <Badge variant="outline">請先覆核</Badge>
      </div>
      <ScrollArea className="max-h-72 pr-3">
        <div className="space-y-3">
          {proposal.patches.map((patch) => {
            const selection = getContentCopilotPatchSelection(
              patch,
              acceptedFields.includes(patch.field),
            );
            return (
              <article key={patch.field} className="rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selection.checked}
                    disabled={selection.disabled}
                    onCheckedChange={() => onTogglePatch(patch)}
                    aria-label={`套用 ${fieldLabels[patch.field] ?? patch.field}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">{fieldLabels[patch.field] ?? patch.field}</strong>
                      <Badge variant={patch.confidence === "high" ? "default" : "secondary"}>
                        {patch.confidence}
                      </Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{formatValue(patch.after)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{patch.reason}</p>
                    {patch.unsupportedClaims.length ? (
                      <p className="mt-2 text-xs text-destructive">
                        未支援聲稱：{patch.unsupportedClaims.join("、")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </ScrollArea>
      {proposal.evidence.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">資料來源</p>
          {proposal.evidence.map((evidence) =>
            evidence.url ? (
              <a
                key={evidence.id}
                href={evidence.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-start gap-2 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{evidence.title}</span>
              </a>
            ) : (
              <p key={evidence.id} className="text-sm text-muted-foreground">
                {evidence.title}
              </p>
            ),
          )}
        </div>
      ) : null}
      <Button type="button" className="w-full" onClick={onApply} disabled={!acceptedFields.length}>
        <Check aria-hidden="true" />
        套用已選建議
      </Button>
    </div>
  );
}

function formatValue(value: ContentCopilotValue) {
  return Array.isArray(value) ? value.join("\n") : value || "（留空）";
}

function isReviewProposal(value: unknown): value is ReviewProposal {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    "sourceFingerprint" in value &&
    "patches" in value &&
    "evidence" in value &&
    "selectedFields" in value,
  );
}
