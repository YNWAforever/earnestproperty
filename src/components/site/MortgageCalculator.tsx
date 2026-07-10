import { useMemo, useState } from "react";
import { Building2, Calculator, ExternalLink, Info, ShieldCheck, WalletCards } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MORTGAGE_INPUT_LIMITS,
  calculateMortgage,
  commitMortgageDraft,
  mortgageInputsFromSearch,
  normalizeMortgageInputs,
  parseMortgageDraft,
  type MortgageInputs,
  type MortgageSearch,
} from "@/lib/mortgage";

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
  price: "Property price",
  ltv: "Loan-to-value ratio",
  years: "Mortgage term",
  annualInterestRate: "Annual interest rate",
  stressRate: "Stress-test rate increase",
  monthlyIncome: "Monthly income",
  monthlyDebtExpenses: "Existing monthly debt expenses",
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
  return incomeWasSupplied ? "Unavailable for this income" : "Add income to calculate";
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
          Enter a valid number, then press Enter or leave the field.
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
  const result = useMemo(
    () => (state.editingField === null ? calculateMortgage(state.inputs) : null),
    [state.editingField, state.inputs],
  );
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
      return {
        inputs,
        drafts: { ...current.drafts, [key]: draftValue(inputs[key]) },
        editingField: null,
      };
    });
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-coral">
          <Calculator className="h-4 w-4" aria-hidden="true" />
          PROPERTY FINANCE
        </div>
        <h1 className="mt-3 text-3xl font-bold text-primary sm:text-4xl">香港按揭計算機</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Adjust the purchase price, financing and affordability figures to understand your monthly
          commitment before you make an offer.
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
                Purchase and loan
              </h2>
              <p className="text-sm text-muted-foreground">Use your expected loan terms.</p>
            </div>
          </div>

          <div className="mt-7 space-y-7">
            <Field
              id="property-price"
              label="Property price"
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
              label="Loan-to-value ratio"
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
              label="Mortgage term"
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
              {state.inputs.years} years
            </Field>
            <Field
              id="interest-rate"
              label="Annual interest rate"
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
              label="Stress-test rate increase"
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
              <h2 className="font-semibold text-foreground">Affordability</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional figures for debt servicing ratios.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="monthly-income">Monthly income</Label>
                <DraftInput
                  id="monthly-income"
                  label="Monthly income"
                  inputMode="numeric"
                  draft={state.drafts.monthlyIncome}
                  placeholder="Optional"
                  isInvalid={state.editingField === "monthlyIncome" && activeDraftIsInvalid}
                  onStartEditing={() => startEditing("monthlyIncome")}
                  onDraftChange={(value) => updateDraft("monthlyIncome", value)}
                  onCommitDraft={() => commitDraft("monthlyIncome")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthly-debt">Existing monthly debt expenses</Label>
                <DraftInput
                  id="monthly-debt"
                  label="Existing monthly debt expenses"
                  inputMode="numeric"
                  draft={state.drafts.monthlyDebtExpenses}
                  placeholder="Optional"
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
                Your estimate
              </h2>
              <p className="text-sm text-muted-foreground">
                Indicative monthly cost and cash required.
              </p>
            </div>
          </div>

          <div className="mt-5" aria-live="polite">
            {result === null ? (
              <div
                role="status"
                className="rounded-md border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground"
              >
                <p className="font-semibold text-foreground">Results unavailable while editing</p>
                <p className="mt-1">
                  {activeDraftIsInvalid
                    ? `Enter a valid ${INPUT_LABELS[state.editingField!].toLowerCase()} to continue.`
                    : `Finish editing ${INPUT_LABELS[state.editingField!].toLowerCase()} to update your estimate.`}
                </p>
              </div>
            ) : (
              <>
                <ResultRow
                  label="Monthly repayment"
                  value={formatMoney(result.monthlyPayment)}
                  emphasized
                />
                <ResultRow
                  label="Stressed monthly repayment"
                  value={formatMoney(result.stressedMonthlyPayment)}
                />
                <ResultRow label="Loan amount" value={formatMoney(result.loanAmount)} />
                <ResultRow label="Deposit" value={formatMoney(result.deposit)} />
                <ResultRow label="Residential stamp duty" value={formatMoney(result.stampDuty)} />
                <ResultRow
                  label="Total interest over term"
                  value={formatMoney(result.totalInterest)}
                />
                <ResultRow
                  label="Debt servicing ratio"
                  value={formatPercent(result.dsr, result.inputs.monthlyIncome !== undefined)}
                />
                <ResultRow
                  label="Stressed debt servicing ratio"
                  value={formatPercent(
                    result.stressedDsr,
                    result.inputs.monthlyIncome !== undefined,
                  )}
                />
              </>
            )}
          </div>

          <div className="mt-6 rounded-md border border-coral/25 bg-coral/5 p-4 text-sm leading-6 text-muted-foreground">
            <div className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-coral" aria-hidden="true" />
              <p>
                This is an illustration, not a lending approval. Rates, eligibility, valuation and
                bank stress tests can change your actual offer.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section
        aria-labelledby="amortization-heading"
        className="mt-8 border-y border-border py-8 sm:py-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="amortization-heading" className="text-xl font-semibold text-foreground">
              Annual amortization
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              How the projected balance changes over the selected term.
            </p>
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            Total repayment:{" "}
            {result === null ? "Unavailable while editing" : formatMoney(result.totalRepayment)}
          </span>
        </div>
        <div className="mt-5 rounded-lg border border-border bg-card px-3 py-1 sm:px-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Opening balance</TableHead>
                <TableHead className="text-right">Principal paid</TableHead>
                <TableHead className="text-right">Interest paid</TableHead>
                <TableHead className="text-right">Closing balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result === null ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Finish editing to view the updated amortization schedule.
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
      </section>

      <section
        aria-labelledby="mortgage-notes"
        className="mt-8 grid gap-6 border-l-4 border-primary/30 pl-5 md:grid-cols-2"
      >
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="mortgage-notes" className="font-semibold text-foreground">
              Important notes
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Residential stamp duty follows the Hong Kong scale effective 26 February 2026. Check the
            current position with the{" "}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://www.ird.gov.hk/chi/faq/avd.htm"
              target="_blank"
              rel="noreferrer"
            >
              Inland Revenue Department
            </a>
            .
          </p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold text-foreground">Mortgage insurance</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Mortgage insurance premiums are not estimated. Review the eligibility and current
            programme details directly with the{" "}
            <a
              className="font-medium text-primary underline underline-offset-4"
              href="https://www.hkmc.com.hk/eng/our_business/mortgage_insurance_programme.html"
              target="_blank"
              rel="noreferrer"
            >
              HKMC Mortgage Insurance Programme
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
