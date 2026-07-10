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
  DEFAULT_MORTGAGE_INPUTS,
  calculateMortgage,
  type MortgageInputs,
  type MortgageSearch,
} from "@/lib/mortgage";

type MortgageCalculatorProps = {
  initialSearch: MortgageSearch;
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

function formatPercent(value: number | null): string {
  return value === null ? "Add income to calculate" : `${percentFormatter.format(value)}%`;
}

function getSliderValue(value: number[] | undefined, fallback: number): number {
  return value?.[0] ?? fallback;
}

function Field({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
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
          value={[value]}
          onValueChange={(nextValue) => onChange(getSliderValue(nextValue, value))}
        />
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          inputMode="decimal"
          onChange={(event) => {
            const nextValue = Number(event.target.value);
            if (Number.isFinite(nextValue)) onChange(nextValue);
          }}
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
  const [inputs, setInputs] = useState<MortgageInputs>({
    ...DEFAULT_MORTGAGE_INPUTS,
    ...(initialSearch.price === undefined ? {} : { price: initialSearch.price }),
    ...(initialSearch.income === undefined ? {} : { monthlyIncome: initialSearch.income }),
    ...(initialSearch.expenses === undefined
      ? {}
      : { monthlyDebtExpenses: initialSearch.expenses }),
  });
  const result = useMemo(() => calculateMortgage(inputs), [inputs]);

  const updateInput = <K extends keyof MortgageInputs>(key: K, value: MortgageInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
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
              value={inputs.price}
              min={1_000_000}
              max={50_000_000}
              step={100_000}
              onChange={(value) => updateInput("price", value)}
            >
              {formatMoney(inputs.price)}
            </Field>
            <Field
              id="ltv"
              label="Loan-to-value ratio"
              value={inputs.ltv}
              min={0}
              max={100}
              step={1}
              onChange={(value) => updateInput("ltv", value)}
            >
              {inputs.ltv}%
            </Field>
            <Field
              id="mortgage-term"
              label="Mortgage term"
              value={inputs.years}
              min={1}
              max={50}
              step={1}
              onChange={(value) => updateInput("years", value)}
            >
              {inputs.years} years
            </Field>
            <Field
              id="interest-rate"
              label="Annual interest rate"
              value={inputs.annualInterestRate}
              min={0}
              max={10}
              step={0.05}
              onChange={(value) => updateInput("annualInterestRate", value)}
            >
              {inputs.annualInterestRate.toFixed(2)}%
            </Field>
            <Field
              id="stress-rate"
              label="Stress-test rate increase"
              value={inputs.stressRate}
              min={0}
              max={10}
              step={0.25}
              onChange={(value) => updateInput("stressRate", value)}
            >
              +{inputs.stressRate.toFixed(2)}%
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
                <Input
                  id="monthly-income"
                  aria-label="Monthly income"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={inputs.monthlyIncome ?? ""}
                  placeholder="Optional"
                  onChange={(event) =>
                    updateInput(
                      "monthlyIncome",
                      event.target.value === "" ? undefined : Number(event.target.value),
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthly-debt">Existing monthly debt expenses</Label>
                <Input
                  id="monthly-debt"
                  aria-label="Existing monthly debt expenses"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={inputs.monthlyDebtExpenses ?? ""}
                  placeholder="Optional"
                  onChange={(event) =>
                    updateInput(
                      "monthlyDebtExpenses",
                      event.target.value === "" ? undefined : Number(event.target.value),
                    )
                  }
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

          <div className="mt-5">
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
            <ResultRow label="Total interest over term" value={formatMoney(result.totalInterest)} />
            <ResultRow label="Debt servicing ratio" value={formatPercent(result.dsr)} />
            <ResultRow
              label="Stressed debt servicing ratio"
              value={formatPercent(result.stressedDsr)}
            />
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
            Total repayment: {formatMoney(result.totalRepayment)}
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
              {result.amortization.map((row) => (
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
              ))}
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
