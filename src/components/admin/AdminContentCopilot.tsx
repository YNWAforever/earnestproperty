import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
} from "lucide-react";

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
  buildContentFingerprint,
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
  { value: "social", label: "社交媒體文案" },
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

/**
 * Staff on this page read Chinese only, so a bare `COPILOT_*` code told them
 * nothing about what to do next. Each message states the cause and the fix; the
 * raw code stays available under 技術詳情 for bug reports.
 */
const errorMessages: Record<string, string> = {
  COPILOT_GENERATION_FAILED: "AI 未能產生建議，可能是服務暫時中斷。請稍後再按「產生建議」。",
  COPILOT_GENERATION_IN_PROGRESS: "上一個建議仍在產生中，請等待完成後再試。",
  COPILOT_DECISION_FAILED: "未能記錄你的決定，建議並未套用。請重試一次。",
  COPILOT_STALE_PROPOSAL: "表單內容在產生建議後已改動，請重新產生建議再套用。",
  COPILOT_PATCH_CONFLICT: "建議與表單現有內容衝突，請重新產生建議。",
  COPILOT_FINGERPRINT_INVALID: "未能核對表單內容，請儲存一次後重新產生建議。",
  COPILOT_PROPOSAL_EXPIRED: "建議已過期，請重新產生。",
  COPILOT_PROPOSAL_INVALID: "AI 回覆格式不正確，請重新產生建議。",
  COPILOT_PROPOSAL_CONTEXT_MISMATCH: "建議屬於另一筆資料，請重新產生建議。",
  COPILOT_UNKNOWN_FIELD: "建議包含不可編輯的欄位，請減少選擇欄位後重試。",
  COPILOT_EVIDENCE_MISSING: "建議缺少資料來源，請改用「內部資料及網頁研究」後重試。",
  COPILOT_EVIDENCE_REQUIRED: "建議缺少資料來源，請改用「內部資料及網頁研究」後重試。",
  COPILOT_CITATION_REQUIRED: "網頁研究建議缺少可引用連結，請重新產生建議。",
  COPILOT_SAVE_FIRST: "請先儲存一次，才可產生 AI 建議。",
  // The server counts requests over `interval '1 hour'`
  // (content-copilot-repository.server.ts:111), so "a minute or two" sent staff
  // back to retry roughly thirty times before it could possibly clear.
  COPILOT_RATE_LIMITED: "已達到每小時的 AI 請求上限，請稍後（約一小時內）再試，或先手動編輯。",
  COPILOT_UNAUTHORIZED: "登入狀態已過期，請重新登入後再試。",
  COPILOT_FORBIDDEN: "你的帳戶未獲授權使用 AI 內容助手，請聯絡管理員。",
  COPILOT_PROVIDER_UNSUPPORTED: "AI 服務尚未設定，請通知技術同事啟用。",
  COPILOT_DATABASE_CONFLICT: "資料庫忙碌未能儲存建議紀錄，請稍後再試。",
  COPILOT_RESOURCE_NOT_FOUND: "找不到這筆資料，可能已被刪除，請重新載入頁面。",
  COPILOT_RESEARCH_UNAVAILABLE: "網頁研究服務暫時無法使用，可改用「只用內部資料」產生建議。",
  COPILOT_CONTENT_TOO_LONG: "內容過長，AI 未能處理。請先縮短描述後再試。",
  COPILOT_TIMEOUT: "AI 回應逾時。請重試一次；如持續逾時請減少選擇的欄位。",
  VALIDATION_ERROR: "提交的資料不正確，請重新載入頁面後再試。",
};

const confidenceLabels: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

// Server warnings arrive as codes or raw English strings; neither is actionable
// for a Cantonese-speaking editor deciding whether to publish the copy.
const warningMessages: Record<string, string> = {
  RESEARCH_UNAVAILABLE: "網頁研究未能執行，此建議只根據內部資料產生。",
  RESEARCH_PARTIAL: "網頁研究只取得部分資料，請自行核實外部事實。",
  EVIDENCE_LIMITED: "可用資料有限，請仔細核對建議內容。",
};

function copilotWarningText(warning: string) {
  return warningMessages[warning] ?? warning;
}

const fallbackErrorMessage = "AI 內容助手未能完成，請稍後再試；如持續失敗請通知技術同事。";

/** Tooltips never open on touch, so this also sits permanently in the intro. */
const blastRadiusNote = "只會處理可編輯的內容欄位，不會修改售價、狀態或已發佈資料。";

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
  fingerprintValues,
  onApply,
}: {
  resourceType: ContentCopilotResourceType;
  resourceId: string | null;
  values: Record<string, ContentCopilotValue>;
  fingerprintValues?: Record<string, unknown>;
  onApply: (patch: Record<string, ContentCopilotValue>) => void;
}) {
  const valueFieldKey = Object.keys(values).sort().join("|");
  const availableFields = useMemo(() => {
    const valueFields = new Set(valueFieldKey ? valueFieldKey.split("|") : []);
    return allowedContentCopilotFields(resourceType).filter((field) => valueFields.has(field));
  }, [resourceType, valueFieldKey]);
  const [state, setState] = useState<PanelState>(resourceId ? "ready" : "disabled-unsaved");
  const [action, setAction] = useState<ContentCopilotAction>("improve");
  const [selectedFields, setSelectedFields] = useState<string[]>(() => availableFields.slice(0, 6));
  const [tone, setTone] = useState<ContentCopilotTone>("professional_property");
  const [targetLanguage, setTargetLanguage] = useState<"zh-HK" | "en" | null>(null);
  const [researchMode, setResearchMode] = useState<ContentCopilotResearchMode>("internal");
  const [proposal, setProposal] = useState<ReviewProposal | null>(null);
  // The server fingerprint protects the persisted record and is rechecked by
  // the decision endpoint. Browser form drift is a separate concern: capture
  // this browser's own snapshot when generation starts so Date/string and
  // database-driver serialization cannot mark an unchanged form as stale.
  const [proposalClientFingerprint, setProposalClientFingerprint] = useState<string | null>(null);
  const [acceptedFields, setAcceptedFields] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  // Snapshot of the fields the last 套用 overwrote, so the banner can put the
  // human-written copy back. Without it AI text is indistinguishable from
  // staff-written text the moment it lands.
  const [undoValues, setUndoValues] = useState<Record<string, ContentCopilotValue> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The values as they stood immediately after the last apply.
  const appliedValuesRef = useRef<Record<string, ContentCopilotValue> | null>(null);
  // True once the form has drifted from the snapshot the proposal was built on.
  const [proposalStale, setProposalStale] = useState(false);

  const displayState = resourceId
    ? state === "disabled-unsaved"
      ? "ready"
      : state
    : "disabled-unsaved";
  const errorCode =
    error ?? (state === "stale" ? "COPILOT_STALE_PROPOSAL" : "COPILOT_GENERATION_FAILED");

  useEffect(() => {
    setState(resourceId ? "ready" : "disabled-unsaved");
    setProposal(null);
    setProposalClientFingerprint(null);
    setAcceptedFields([]);
    setUndoValues(null);
    setError(null);
    setSelectedFields((current) => {
      const retained = current.filter((field) => new Set<string>(availableFields).has(field));
      return retained.length ? retained : availableFields.slice(0, 6);
    });
  }, [availableFields, resourceId]);

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

  function acceptAllPatches() {
    if (!proposal) return;
    setAcceptedFields(
      proposal.patches
        .filter((patch) => patch.unsupportedClaims.length === 0)
        .map((patch) => patch.field),
    );
  }

  function discardProposal() {
    setProposal(null);
    setProposalClientFingerprint(null);
    setAcceptedFields([]);
    setError(null);
    setState("ready");
  }

  async function generate() {
    if (!resourceId || selectedFields.length === 0) return;
    setState("generating");
    setError(null);
    setProposal(null);
    setProposalClientFingerprint(null);
    setProposalStale(false);
    setAcceptedFields([]);

    try {
      const generationFingerprint = await buildContentFingerprint(fingerprintValues ?? values);
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
      setProposalClientFingerprint(generationFingerprint);
      // Opt-in, not opt-out: pre-checking every patch made "replace all my copy"
      // the default one-click gesture. 全選 is one extra click when wanted.
      setAcceptedFields([]);
      setState("review");
    } catch {
      setError("COPILOT_GENERATION_FAILED");
      setState("failed");
    }
  }

  async function apply() {
    if (!proposal || !proposalClientFingerprint || applying) return;
    setError(null);
    setApplying(true);
    try {
      const patchResult = applySelectedContentPatches(values, proposal.patches, acceptedFields, {
        resourceType,
        sourceFingerprint: proposalClientFingerprint,
        currentFingerprint: await buildContentFingerprint(fingerprintValues ?? values),
      });
      if (!patchResult.ok) {
        setError(patchResult.error);
        setState(patchResult.error === "COPILOT_STALE_PROPOSAL" ? "stale" : "review");
        return;
      }

      const { decideAdminContentProposal } = await import("@/lib/ai/content-copilot-admin");
      const decision = await decideAdminContentProposal({
        data: { proposalId: proposal.id, decision: "apply", acceptedFields },
      });
      if (!decision.ok) {
        setError(decision.error || "COPILOT_DECISION_FAILED");
        // Only a stale proposal is unrecoverable. Anything else keeps the review
        // panel and the ticked boxes so a retry does not cost another 10+ second
        // generation and re-reading five diff cards.
        setState(decision.error === "COPILOT_STALE_PROPOSAL" ? "stale" : "review");
        return;
      }
      // Snapshot only the fields actually accepted. Snapshotting every key of
      // the patched value meant 復原為套用前內容 rewound edits the user made after
      // the apply -- a hand-fixed 標題 and a rewritten 特色 both silently reverted
      // even though neither came from the AI.
      setUndoValues(
        Object.fromEntries(acceptedFields.map((field) => [field, values[field] ?? null])),
      );
      appliedValuesRef.current = { ...values, ...patchResult.value };
      onApply(patchResult.value);
      setState("applied");
    } catch {
      setError("COPILOT_DECISION_FAILED");
      setState("review");
    } finally {
      setApplying(false);
    }
  }

  // The proposal is voided the moment any watched field changes -- including
  // re-typing the same text with a stray space -- but that was only discovered
  // at apply time, after staff had spent minutes reading diff cards and ticking
  // boxes. The panel now says so while there is still time to regenerate.
  useEffect(() => {
    if (state !== "review" || !proposal || !proposalClientFingerprint) {
      setProposalStale(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void buildContentFingerprint(fingerprintValues ?? values)
        .then((current) => {
          if (!cancelled) setProposalStale(current !== proposalClientFingerprint);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fingerprintValues, proposal, proposalClientFingerprint, state, values]);

  function undoApply() {
    if (!undoValues) return;
    onApply(undoValues);
    setUndoValues(null);
    setState("ready");
  }

  // Once the form diverges from the post-apply state the snapshot no longer
  // describes "before the apply", so the button is retired rather than left
  // offering a rewind that would clobber newer work.
  useEffect(() => {
    if (!undoValues) return;
    const stillMatches = Object.keys(undoValues).every(
      (field) => appliedValuesRef.current?.[field] === values[field],
    );
    if (!stillMatches) setUndoValues(null);
  }, [undoValues, values]);
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
            <h3 className="text-sm font-semibold">AI 內容助手</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            建議只會套用到目前表單，仍需由你儲存或發佈。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{blastRadiusNote}</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="內容助手說明"
              >
                <FileText className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{blastRadiusNote}</TooltipContent>
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
          {/* The live region needs text: skeletons alone announced nothing for
              the 10s+ the LLM call takes. */}
          <p className="text-sm text-muted-foreground">AI 正在產生建議，通常需要十多秒…</p>
          <Skeleton className="h-16 w-full" aria-hidden="true" />
          <Skeleton className="h-16 w-full" aria-hidden="true" />
        </div>
      ) : null}
      {displayState === "failed" ||
      displayState === "stale" ||
      (displayState === "review" && error) ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          <p>
            <TriangleAlert className="mr-2 inline size-4" aria-hidden="true" />
            {errorMessages[errorCode] ?? fallbackErrorMessage}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs">技術詳情</summary>
            <code className="text-xs">{errorCode}</code>
          </details>
        </div>
      ) : null}
      {displayState === "applied" ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <p>
            <Check className="mr-2 inline size-4" aria-hidden="true" />
            已套用到目前表單，請使用原有儲存功能提交變更。
          </p>
          {undoValues ? (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={undoApply}>
              <Undo2 aria-hidden="true" />
              復原為套用前內容
            </Button>
          ) : null}
        </div>
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
          applying={applying}
          stale={proposalStale}
          onTogglePatch={toggleAcceptedPatch}
          onAcceptAll={acceptAllPatches}
          onDiscard={discardProposal}
          onRegenerate={generate}
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
  applying,
  stale,
  onTogglePatch,
  onAcceptAll,
  onDiscard,
  onRegenerate,
  onApply,
}: {
  proposal: ReviewProposal;
  acceptedFields: string[];
  applying: boolean;
  stale: boolean;
  onTogglePatch: (patch: ContentCopilotPatch) => void;
  onAcceptAll: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  onApply: () => void;
}) {
  const acceptableFields = proposal.patches
    .filter((patch) => patch.unsupportedClaims.length === 0)
    .map((patch) => patch.field);
  const allAccepted =
    acceptableFields.length > 0 &&
    acceptableFields.every((field) => acceptedFields.includes(field));

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">建議內容（共 {proposal.patches.length} 項）</h4>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAcceptAll}
            disabled={allAccepted}
          >
            全選
          </Button>
          <Badge variant="outline">請先覆核</Badge>
        </div>
      </div>

      {/* proposal.warnings was fetched and never rendered. A staff member who
          chose 內部資料及網頁研究 specifically for externally-sourced facts would
          see a normal proposal even when the research step had failed and the
          model fell back to internal evidence only. */}
      {proposal.warnings?.length ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">產生時有以下警告：</p>
          <ul className="mt-1 list-inside list-disc">
            {proposal.warnings.map((warning) => (
              <li key={warning}>{copilotWarningText(warning)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {stale ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">表單已改動，此建議已過時。</p>
          <p className="mt-1">套用會被拒絕。請按「重新產生」以目前的表單內容取得新建議。</p>
        </div>
      ) : null}

      {proposal.patches.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          AI 認為目前內容已符合要求，沒有提出修改建議。你可以調整語氣或選擇其他欄位後重新產生。
        </p>
      ) : null}
      {/* h-72, not max-h-72: with max-h the ScrollArea viewport never gets a
          definite height, so a proposal of up to 12 patches was clipped after
          roughly two cards with no affordance that more existed. */}
      <ScrollArea className="h-72 pr-3">
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
                        信心：{confidenceLabels[patch.confidence] ?? patch.confidence}
                      </Badge>
                    </div>
                    {/* Both sides, always: staff could not previously see what
                        the suggestion was about to overwrite. */}
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md bg-muted/40 p-2">
                        <p className="text-xs font-medium text-muted-foreground">目前內容</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {formatValue(patch.before)}
                        </p>
                      </div>
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                        <p className="text-xs font-medium text-muted-foreground">建議內容</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {formatValue(patch.after)}
                        </p>
                      </div>
                    </div>
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
      <Button
        type="button"
        className="w-full"
        onClick={onApply}
        disabled={applying || stale || !acceptedFields.length}
        aria-busy={applying ? true : undefined}
      >
        {applying ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {applying ? "套用中…" : `套用已選建議（${acceptedFields.length}）`}
      </Button>
      {/* The button sat disabled by default -- selection starts empty by design
          -- with no indication that ticking a box was the missing step. */}
      {!applying && !stale && !acceptedFields.length && proposal.patches.length > 0 ? (
        <p className="text-xs text-muted-foreground">請先勾選要套用的建議。</p>
      ) : null}
      {/* Without these the only way out of review was closing the dialog, which
          discarded the whole draft. */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onDiscard}
          disabled={applying}
        >
          捨棄建議
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onRegenerate}
          disabled={applying}
        >
          <Sparkles aria-hidden="true" />
          重新產生
        </Button>
      </div>
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
