import { useMemo, useState } from "react";
import {
  Building2,
  Calculator,
  ChevronDown,
  ExternalLink,
  Info,
  Layers,
  ShieldCheck,
  Trash2,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { DataNote } from "@/components/layout/DataNote";
import { RESIDENTIAL_STAMP_DUTY_SCHEDULE } from "@/content/policy-rates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MAX_MORTGAGE_SCENARIOS,
  MORTGAGE_INPUT_LIMITS,
  calculateMortgage,
  commitMortgageDraft,
  mortgageInputsFromSearch,
  normalizeMortgageInputs,
  parseMortgageDraft,
  removeMortgageScenario,
  saveMortgageScenario,
  type MortgageInputs,
  type MortgageScenario,
  type MortgageSearch,
} from "@/lib/mortgage";
import { buildContext, track } from "@/lib/analytics/events";

type MortgageCalculatorProps = {
  initialSearch: MortgageSearch;
};

type MortgageInputKey = keyof MortgageInputs;
type MortgageDrafts = Record<MortgageInputKey, string>;

type CalculatorState = {
  inputs: MortgageInputs;
  drafts: MortgageDrafts;
  editingField: MortgageInputKey | null;
};

const OPTIONAL_INPUT_KEYS = new Set<MortgageInputKey>(["monthlyIncome", "monthlyDebtExpenses"]);

const INPUT_LABELS: Record<MortgageInputKey, string> = {
  price: "樓價",
  ltv: "按揭成數",
  years: "按揭年期",
  annualInterestRate: "年利率",
  stressRate: "壓力測試加息幅度",
  monthlyIncome: "每月入息",
  monthlyDebtExpenses: "現有每月債務支出",
};

const moneyFormatter = new Intl.NumberFormat("en-HK", {
  style: "currency",
  currency: "HKD",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("en-HK", {
  maximumFractionDigits: 1,
});

function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}

function formatPercent(value: number | null, incomeWasSupplied: boolean): string {
  if (value !== null) return `${percentFormatter.format(value)}%`;
  return incomeWasSupplied ? "此入息無法計算" : "輸入入息以計算";
}

function getSliderValue(value: number[] | undefined, fallback: number): number {
  return value?.[0] ?? fallback;
}

function draftValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function draftsFromInputs(inputs: MortgageInputs): MortgageDrafts {
  return {
    price: draftValue(inputs.price),
    ltv: draftValue(inputs.ltv),
    years: draftValue(inputs.years),
    annualInterestRate: draftValue(inputs.annualInterestRate),
    stressRate: draftValue(inputs.stressRate),
    monthlyIncome: draftValue(inputs.monthlyIncome),
    monthlyDebtExpenses: draftValue(inputs.monthlyDebtExpenses),
  };
}

function DraftInput({
  id,
  label,
  draft,
  inputMode = "decimal",
  placeholder,
  isInvalid,
  onStartEditing,
  onDraftChange,
  onCommitDraft,
}: {
  id: string;
  label: string;
  draft: string;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  isInvalid: boolean;
  onStartEditing: () => void;
  onDraftChange: (value: string) => void;
  onCommitDraft: () => void;
}) {
  const messageId = `${id}-draft-message`;

  return (
    <div>
      <Input
        id={id}
        aria-label={label}
        aria-invalid={isInvalid}
        aria-describedby={isInvalid ? messageId : undefined}
        type="text"
        inputMode={inputMode}
        value={draft}
        placeholder={placeholder}
        onFocus={onStartEditing}
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={onCommitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {isInvalid ? (
        <p id={messageId} className="mt-1 text-xs font-medium text-destructive">
          請輸入有效數字，然後按 Enter 或移至其他欄位。
        </p>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  committedValue,
  draft,
  min,
  max,
  step,
  isInvalid,
  onStartEditing,
  onDraftChange,
  onCommitDraft,
  onSliderCommit,
  children,
}: {
  id: string;
  label: string;
  committedValue: number;
  draft: string;
  min: number;
  max: number;
  step: number;
  isInvalid: boolean;
  onStartEditing: () => void;
  onDraftChange: (value: string) => void;
  onCommitDraft: () => void;
  onSliderCommit: (value: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id} className="font-medium text-foreground">
          {label}
        </Label>
        <span className="text-sm font-semibold tabular-nums text-primary">{children}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-3">
        <Slider
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={[committedValue]}
          onValueChange={(nextValue) => onSliderCommit(getSliderValue(nextValue, committedValue))}
        />
        <DraftInput
          id={id}
          label={label}
          draft={draft}
          isInvalid={isInvalid}
          onStartEditing={onStartEditing}
          onDraftChange={onDraftChange}
          onCommitDraft={onCommitDraft}
        />
      </div>
    </div>
  );
}

function ResultRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={
          emphasized ? "text-xl font-bold tabular-nums text-primary" : "font-semibold tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function MortgageCalculator({ initialSearch }: MortgageCalculatorProps) {
  const [state, setState] = useState<CalculatorState>(() => {
    const inputs = mortgageInputsFromSearch(initialSearch);
    return { inputs, drafts: draftsFromInputs(inputs), editingField: null };
  });
  // Collapsed by default -- the annual schedule is a detail most visitors
  // won't need immediately; a toggle keeps the page shorter without hiding it.
  const [showAmortization, setShowAmortization] = useState(false);
  // Saved snapshots for side-by-side comparison. Client-side component
  // state only -- no localStorage, no server round-trip: this is a
  // "compare while you're on the page" tool, not a saved-search feature.
  const [scenarios, setScenarios] = useState<MortgageScenario[]>([]);
  const result = useMemo(
    () => (state.editingField === null ? calculateMortgage(state.inputs) : null),
    [state.editingField, state.inputs],
  );
  const scenarioSummaries = useMemo(
    () => scenarios.map((scenario) => ({ scenario, result: calculateMortgage(scenario.inputs) })),
    [scenarios],
  );
  const canSaveScenario = result !== null && scenarios.length < MAX_MORTGAGE_SCENARIOS;
  const activeDraftParse =
    state.editingField === null ? null : parseMortgageDraft(state.drafts[state.editingField]);
  const activeDraftIsInvalid =
    state.editingField !== null &&
    (activeDraftParse?.status === "invalid" ||
      (activeDraftParse?.status === "empty" && !OPTIONAL_INPUT_KEYS.has(state.editingField)));

  const startEditing = (key: MortgageInputKey) => {
    setState((current) => ({ ...current, editingField: key }));
  };

  const updateDraft = (key: MortgageInputKey, value: string) => {
    setState((current) => ({
      ...current,
      drafts: { ...current.drafts, [key]: value },
      editingField: key,
    }));
  };

  const commitDraft = (key: MortgageInputKey) => {
    setState((current) => {
      const inputs = commitMortgageDraft(current.inputs, key, current.drafts[key]);
      track(
        { name: "mortgage_calculate", payload: { hasIncome: inputs.monthlyIncome !== undefined } },
        buildContext(),
      );
      return {
        inputs,
        drafts: { ...current.drafts, [key]: draftValue(inputs[key]) },
        editingField: current.editingField === key ? null : current.editingField,
      };
    });
  };

  const commitSlider = (key: MortgageInputKey, value: number) => {
    setState((current) => {
      const inputs = normalizeMortgageInputs({ ...current.inputs, [key]: value });
      track(
        { name: "mortgage_calculate", payload: { hasIncome: inputs.monthlyIncome !== undefined } },
        buildContext(),
      );
      return {
        inputs,
        drafts: { ...current.drafts, [key]: draftValue(inputs[key]) },
        editingField: null,
      };
    });
  };

  const handleSaveScenario = () => {
    setScenarios((current) => saveMortgageScenario(current, state.inputs));
    track(
      { name: "mortgage_scenario_save", payload: { scenarioCount: scenarios.length + 1 } },
      buildContext(),
    );
  };

  const handleRemoveScenario = (id: string) => {
    setScenarios((current) => removeMortgageScenario(current, id));
  };

  return (
    // Not <main> -- __root.tsx already wraps every route's <Outlet/> in its
    // own <main className="flex-1">, so a second <main> here produced two
    // nested main landmarks (axe: landmark-no-duplicate-main /
    // landmark-unique), caught by P7b's new a11y suite.
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-coral">
          <Calculator className="h-4 w-4" aria-hidden="true" />
          物業融資
        </div>
        <h1 className="mt-3 text-3xl font-bold text-primary sm:text-4xl">香港按揭計算機</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          調整樓價、按揭及供款能力數字，出價前先了解每月供款壓力。
        </p>
      </header>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
        <section
          aria-labelledby="mortgage-inputs"
          className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="mortgage-inputs" className="text-lg font-semibold text-foreground">
                樓價與按揭
              </h2>
              <p className="text-sm text-muted-foreground">輸入您預期的按揭條款。</p>
            </div>
          </div>

          <div className="mt-7 space-y-7">
            <Field
              id="property-price"
              label="樓價"
              committedValue={state.inputs.price}
              draft={state.drafts.price}
              min={MORTGAGE_INPUT_LIMITS.price.min}
              max={MORTGAGE_INPUT_LIMITS.price.max}
              step={100_000}
              isInvalid={state.editingField === "price" && activeDraftIsInvalid}
              onStartEditing={() => startEditing("price")}
              onDraftChange={(value) => updateDraft("price", value)}
              onCommitDraft={() => commitDraft("price")}
              onSliderCommit={(value) => commitSlider("price", value)}
            >
              {formatMoney(state.inputs.price)}
            </Field>
            <Field
              id="ltv"
              label="按揭成數"
              committedValue={state.inputs.ltv}
              draft={state.drafts.ltv}
              min={MORTGAGE_INPUT_LIMITS.ltv.min}
              max={MORTGAGE_INPUT_LIMITS.ltv.max}
              step={1}
              isInvalid={state.editingField === "ltv" && activeDraftIsInvalid}
              onStartEditing={() => startEditing("ltv")}
              onDraftChange={(value) => updateDraft("ltv", value)}
              onCommitDraft={() => commitDraft("ltv")}
              onSliderCommit={(value) => commitSlider("ltv", value)}
            >
              {state.inputs.ltv}%
            </Field>
            <Field
              id="mortgage-term"
              label="按揭年期"
              committedValue={state.inputs.years}
              draft={state.drafts.years}
              min={MORTGAGE_INPUT_LIMITS.years.min}
              max={MORTGAGE_INPUT_LIMITS.years.max}
              step={1}
              isInvalid={state.editingField === "years" && activeDraftIsInvalid}
              onStartEditing={() => startEditing("years")}
              onDraftChange={(value) => updateDraft("years", value)}
              onCommitDraft={() => commitDraft("years")}
              onSliderCommit={(value) => commitSlider("years", value)}
            >
              {state.inputs.years} 年
            </Field>
            <Field
              id="interest-rate"
              label="年利率"
              committedValue={state.inputs.annualInterestRate}
              draft={state.drafts.annualInterestRate}
              min={MORTGAGE_INPUT_LIMITS.annualInterestRate.min}
              max={MORTGAGE_INPUT_LIMITS.annualInterestRate.max}
              step={0.05}
              isInvalid={state.editingField === "annualInterestRate" && activeDraftIsInvalid}
              onStartEditing={() => startEditing("annualInterestRate")}
              onDraftChange={(value) => updateDraft("annualInterestRate", value)}
              onCommitDraft={() => commitDraft("annualInterestRate")}
              onSliderCommit={(value) => commitSlider("annualInterestRate", value)}
            >
              {state.inputs.annualInterestRate.toFixed(2)}%
            </Field>
            <Field
              id="stress-rate"
              label="壓力測試加息幅度"
              committedValue={state.inputs.stressRate}
              draft={state.drafts.stressRate}
              min={MORTGAGE_INPUT_LIMITS.stressRate.min}
              max={MORTGAGE_INPUT_LIMITS.stressRate.max}
              step={0.25}
              isInvalid={state.editingField === "stressRate" && activeDraftIsInvalid}
              onStartEditing={() => startEditing("stressRate")}
              onDraftChange={(value) => updateDraft("stressRate", value)}
              onCommitDraft={() => commitDraft("stressRate")}
              onSliderCommit={(value) => commitSlider("stressRate", value)}
            >
              +{state.inputs.stressRate.toFixed(2)}%
            </Field>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <div className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-coral" aria-hidden="true" />
              <h2 className="font-semibold text-foreground">供款能力</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              此為選填資料，用作計算債務供款比率。
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="monthly-income">每月入息</Label>
                <DraftInput
                  id="monthly-income"
                  label="每月入息"
                  inputMode="numeric"
                  draft={state.drafts.monthlyIncome}
                  placeholder="選填"
                  isInvalid={state.editingField === "monthlyIncome" && activeDraftIsInvalid}
                  onStartEditing={() => startEditing("monthlyIncome")}
                  onDraftChange={(value) => updateDraft("monthlyIncome", value)}
                  onCommitDraft={() => commitDraft("monthlyIncome")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthly-debt">現有每月債務支出</Label>
                <DraftInput
                  id="monthly-debt"
                  label="現有每月債務支出"
                  inputMode="numeric"
                  draft={state.drafts.monthlyDebtExpenses}
                  placeholder="選填"
                  isInvalid={state.editingField === "monthlyDebtExpenses" && activeDraftIsInvalid}
                  onStartEditing={() => startEditing("monthlyDebtExpenses")}
                  onDraftChange={(value) => updateDraft("monthlyDebtExpenses", value)}
                  onCommitDraft={() => commitDraft("monthlyDebtExpenses")}
                />
              </div>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="mortgage-results"
          className="rounded-lg border border-primary/20 bg-card p-5 shadow-sm sm:p-6 lg:sticky lg:top-6"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-coral/15 text-coral">
              <Calculator className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="mortgage-results" className="text-lg font-semibold text-foreground">
                您的預算
              </h2>
              <p className="text-sm text-muted-foreground">預算每月供款及所需現金。</p>
            </div>
          </div>

          <div className="mt-5" aria-live="polite">
            {result === null ? (
              <div
                role="status"
                className="rounded-md border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground"
              >
                <p className="font-semibold text-foreground">編輯中，暫無法顯示結果</p>
                <p className="mt-1">
                  {activeDraftIsInvalid
                    ? `請輸入有效的「${INPUT_LABELS[state.editingField!]}」以繼續。`
                    : `請完成編輯「${INPUT_LABELS[state.editingField!]}」以更新預算結果。`}
                </p>
              </div>
            ) : (
              <>
                <ResultRow label="每月供款" value={formatMoney(result.monthlyPayment)} emphasized />
                <ResultRow
                  label="壓力測試後每月供款"
                  value={formatMoney(result.stressedMonthlyPayment)}
                />
                <ResultRow label="貸款金額" value={formatMoney(result.loanAmount)} />
                <ResultRow label="首期" value={formatMoney(result.deposit)} />
                <ResultRow label="住宅印花稅" value={formatMoney(result.stampDuty)} />
                {/* Purely additive: sums calculateMortgage's already-computed
                    deposit + stampDuty fields -- same computation and wording
                    as PropertyDecisionActions.tsx's mortgage teaser card. */}
                <ResultRow
                  label="預計上會現金需求（首期＋印花稅）"
                  value={formatMoney(result.deposit + result.stampDuty)}
                />
                <ResultRow label="全期總利息" value={formatMoney(result.totalInterest)} />
                <ResultRow
                  label="債務供款比率"
                  value={formatPercent(result.dsr, result.inputs.monthlyIncome !== undefined)}
                />
                <ResultRow
                  label="壓力測試後債務供款比率"
                  value={formatPercent(
                    result.stressedDsr,
                    result.inputs.monthlyIncome !== undefined,
                  )}
                />
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSaveScenario}
                    disabled={!canSaveScenario}
                  >
                    <Layers className="mr-1 h-4 w-4" aria-hidden="true" />
                    儲存此方案作比較
                  </Button>
                </div>
                {scenarios.length >= MAX_MORTGAGE_SCENARIOS ? (
                  <p className="mt-1 text-right text-xs text-muted-foreground">
                    已達 {MAX_MORTGAGE_SCENARIOS} 個方案上限，請先在下方移除一個方案再儲存新方案。
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="mt-6 rounded-md border border-coral/25 bg-coral/5 p-4 text-sm leading-6 text-muted-foreground">
            <div className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-coral" aria-hidden="true" />
              <p>
                此為參考估算，並非貸款批核。實際利率、資格審查、物業估價及銀行壓力測試結果，
                均可能影響最終批核條件。
              </p>
            </div>
          </div>
        </section>
      </div>

      {scenarios.length > 0 ? (
        <section
          aria-labelledby="scenario-comparison-heading"
          className="mt-8 border-t border-border pt-8"
        >
          <h2 id="scenario-comparison-heading" className="text-xl font-semibold text-foreground">
            方案比較
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            並排比較已儲存的樓價與按揭組合，最多 {MAX_MORTGAGE_SCENARIOS} 個。
          </p>
          <div
            className={`mt-4 grid gap-4 ${
              scenarioSummaries.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"
            }`}
          >
            {scenarioSummaries.map(({ scenario, result: scenarioResult }, index) => (
              <div
                key={scenario.id}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">方案 {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`移除方案 ${index + 1}`}
                    onClick={() => handleRemoveScenario(scenario.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">樓價</dt>
                    <dd className="font-medium tabular-nums">
                      {formatMoney(scenario.inputs.price)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">按揭成數</dt>
                    <dd className="font-medium tabular-nums">{scenario.inputs.ltv}%</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">按揭年期</dt>
                    <dd className="font-medium tabular-nums">{scenario.inputs.years} 年</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">年利率</dt>
                    <dd className="font-medium tabular-nums">
                      {scenario.inputs.annualInterestRate.toFixed(2)}%
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                    <dt className="text-muted-foreground">每月供款</dt>
                    <dd className="font-semibold tabular-nums text-primary">
                      {formatMoney(scenarioResult.monthlyPayment)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">預計上會現金需求（首期＋印花稅）</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatMoney(scenarioResult.deposit + scenarioResult.stampDuty)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="amortization-heading"
        className="mt-8 border-y border-border py-8 sm:py-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="amortization-heading" className="text-xl font-semibold text-foreground">
              年度還款明細
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">顯示所選年期內貸款餘額的預算變化。</p>
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            總還款額： {result === null ? "編輯中無法顯示" : formatMoney(result.totalRepayment)}
          </span>
        </div>
        <Collapsible open={showAmortization} onOpenChange={setShowAmortization} className="mt-4">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              {showAmortization ? "隱藏年度還款明細" : "顯示年度還款明細"}
              <ChevronDown
                className={`ml-1 h-4 w-4 transition-transform duration-200 ${
                  showAmortization ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-4 rounded-lg border border-border bg-card px-3 py-1 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>年度</TableHead>
                    <TableHead className="text-right">年初結欠</TableHead>
                    <TableHead className="text-right">已還本金</TableHead>
                    <TableHead className="text-right">已付利息</TableHead>
                    <TableHead className="text-right">年末結欠</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result === null ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        請完成編輯以查看最新的還款明細。
                      </TableCell>
                    </TableRow>
                  ) : (
                    result.amortization.map((row) => (
                      <TableRow key={row.year}>
                        <TableCell className="font-medium">{row.year}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.openingBalance)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.principalPaid)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.interestPaid)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.closingBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <section
        aria-labelledby="mortgage-notes"
        className="mt-8 grid gap-6 border-l-4 border-primary/30 pl-5 md:grid-cols-2"
      >
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="mortgage-notes" className="font-semibold text-foreground">
              重要事項
            </h2>
          </div>
          <DataNote
            className="mt-2"
            source={RESIDENTIAL_STAMP_DUTY_SCHEDULE.source}
            sourceUrl={RESIDENTIAL_STAMP_DUTY_SCHEDULE.sourceUrl ?? undefined}
            asOf={RESIDENTIAL_STAMP_DUTY_SCHEDULE.effectiveDate}
            caveat="住宅印花稅按香港稅階計算，如需核實最新稅階請以官方公佈為準。"
          />
          <DataNote
            className="mt-3"
            source="本網站預設參考值（可自行調整）"
            caveat="利率、按揭成數及壓力測試假設並非銀行實際批核條件，僅供試算參考，實際按揭條款以銀行審批為準。"
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold text-foreground">按揭保險</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            本計算機並未估算按揭保險保費，如需了解申請資格及最新計劃詳情，請直接查閱{" "}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://www.hkmc.com.hk/eng/our_business/mortgage_insurance_programme.html"
              target="_blank"
              rel="noreferrer"
            >
              按揭證券公司按揭保險計劃
            </a>
            。
          </p>
        </div>
      </section>
    </div>
  );
}
