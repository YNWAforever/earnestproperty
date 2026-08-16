export type MortgageInputs = {
  price: number;
  ltv: number;
  years: number;
  annualInterestRate: number;
  stressRate: number;
  monthlyIncome?: number;
  monthlyDebtExpenses?: number;
};

export type AmortizationRow = {
  year: number;
  openingBalance: number;
  principalPaid: number;
  interestPaid: number;
  closingBalance: number;
};

export type MortgageResult = {
  inputs: MortgageInputs;
  loanAmount: number;
  deposit: number;
  monthlyPayment: number;
  stressedMonthlyPayment: number;
  totalRepayment: number;
  totalInterest: number;
  dsr: number | null;
  stressedDsr: number | null;
  stampDuty: number;
  amortization: AmortizationRow[];
};

export type MortgageSearch = {
  price?: number;
  income?: number;
  expenses?: number;
};

export type MortgageDraftParseResult =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "valid"; value: number };

export const DEFAULT_MORTGAGE_INPUTS: MortgageInputs = {
  price: 8_000_000,
  ltv: 70,
  years: 30,
  annualInterestRate: 3.25,
  stressRate: 2,
};

export const MORTGAGE_INPUT_LIMITS = {
  price: { min: 1_000_000, max: 500_000_000 },
  ltv: { min: 0, max: 100 },
  years: { min: 1, max: 50 },
  annualInterestRate: { min: 0, max: 10 },
  stressRate: { min: 0, max: 10 },
} as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeMortgageInputs(input: Partial<MortgageInputs>): MortgageInputs {
  const price =
    isFiniteNumber(input.price) && input.price > 0
      ? clamp(input.price, MORTGAGE_INPUT_LIMITS.price.min, MORTGAGE_INPUT_LIMITS.price.max)
      : DEFAULT_MORTGAGE_INPUTS.price;
  const ltv = isFiniteNumber(input.ltv)
    ? clamp(input.ltv, MORTGAGE_INPUT_LIMITS.ltv.min, MORTGAGE_INPUT_LIMITS.ltv.max)
    : DEFAULT_MORTGAGE_INPUTS.ltv;
  const years =
    isFiniteNumber(input.years) && input.years >= 1
      ? clamp(
          Math.round(input.years),
          MORTGAGE_INPUT_LIMITS.years.min,
          MORTGAGE_INPUT_LIMITS.years.max,
        )
      : DEFAULT_MORTGAGE_INPUTS.years;
  const annualInterestRate = isFiniteNumber(input.annualInterestRate)
    ? clamp(
        input.annualInterestRate,
        MORTGAGE_INPUT_LIMITS.annualInterestRate.min,
        MORTGAGE_INPUT_LIMITS.annualInterestRate.max,
      )
    : DEFAULT_MORTGAGE_INPUTS.annualInterestRate;
  const stressRate = isFiniteNumber(input.stressRate)
    ? clamp(
        input.stressRate,
        MORTGAGE_INPUT_LIMITS.stressRate.min,
        MORTGAGE_INPUT_LIMITS.stressRate.max,
      )
    : DEFAULT_MORTGAGE_INPUTS.stressRate;
  const monthlyIncome =
    isFiniteNumber(input.monthlyIncome) && input.monthlyIncome >= 0
      ? input.monthlyIncome
      : undefined;
  const monthlyDebtExpenses =
    isFiniteNumber(input.monthlyDebtExpenses) && input.monthlyDebtExpenses >= 0
      ? input.monthlyDebtExpenses
      : undefined;

  return {
    price,
    ltv,
    years,
    annualInterestRate,
    stressRate,
    ...(monthlyIncome === undefined ? {} : { monthlyIncome }),
    ...(monthlyDebtExpenses === undefined ? {} : { monthlyDebtExpenses }),
  };
}

export function mortgageInputsFromSearch(search: MortgageSearch): MortgageInputs {
  return normalizeMortgageInputs({
    ...(search.price === undefined ? {} : { price: search.price }),
    ...(search.income === undefined ? {} : { monthlyIncome: search.income }),
    ...(search.expenses === undefined ? {} : { monthlyDebtExpenses: search.expenses }),
  });
}

export function parseMortgageDraft(draft: string): MortgageDraftParseResult {
  const trimmed = draft.trim();
  if (trimmed === "") return { status: "empty" };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return { status: "invalid" };

  const value = Number(trimmed);
  return Number.isFinite(value) ? { status: "valid", value } : { status: "invalid" };
}

export function commitMortgageDraft(
  inputs: MortgageInputs,
  key: keyof MortgageInputs,
  draft: string,
): MortgageInputs {
  const parsed = parseMortgageDraft(draft);

  if (parsed.status === "empty" && key === "monthlyIncome") {
    const { monthlyIncome: _monthlyIncome, ...remaining } = inputs;
    return normalizeMortgageInputs(remaining);
  }

  if (parsed.status === "empty" && key === "monthlyDebtExpenses") {
    const { monthlyDebtExpenses: _monthlyDebtExpenses, ...remaining } = inputs;
    return normalizeMortgageInputs(remaining);
  }

  if (parsed.status !== "valid") return normalizeMortgageInputs(inputs);
  return normalizeMortgageInputs({ ...inputs, [key]: parsed.value });
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function debtServicingRatio(
  payment: number,
  debtExpenses: number,
  income: number | undefined,
): number | null {
  if (income === undefined || income <= 0) return null;

  const ratio = ((payment + debtExpenses) / income) * 100;
  return Number.isFinite(ratio) ? ratio : null;
}

function monthlyPayment(principal: number, annualInterestRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;

  const monthlyRate = annualInterestRate / 1_200;
  if (monthlyRate === 0) return finiteOrZero(principal / months);

  const denominator = -Math.expm1(-months * Math.log1p(monthlyRate));
  if (denominator <= 0) return finiteOrZero(principal / months);

  return finiteOrZero((principal * monthlyRate) / denominator);
}

function annualAmortization(
  principal: number,
  annualInterestRate: number,
  years: number,
  payment: number,
): AmortizationRow[] {
  const rows: AmortizationRow[] = [];
  const monthlyRate = annualInterestRate / 1_200;
  let balance = principal;

  for (let year = 1; year <= years; year += 1) {
    const openingBalance = balance;
    let principalPaid = 0;
    let interestPaid = 0;

    for (let month = 0; month < 12 && balance > 0; month += 1) {
      const interest = monthlyRate === 0 ? 0 : balance * monthlyRate;
      const isFinalScheduledPayment = year === years && month === 11;
      const principalPortion = isFinalScheduledPayment
        ? balance
        : Math.min(balance, Math.max(0, payment - interest));

      interestPaid += interest;
      principalPaid += principalPortion;
      balance = Math.max(0, balance - principalPortion);
    }

    rows.push({ year, openingBalance, principalPaid, interestPaid, closingBalance: balance });
  }

  return rows;
}

export function calculateResidentialStampDuty(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (price <= 4_000_000) return 100;
  if (price <= 4_323_780) return Math.ceil(100 + (price - 4_000_000) * 0.2);
  if (price <= 4_500_000) return Math.ceil(price * 0.015);
  if (price <= 4_935_480) return Math.ceil(67_500 + (price - 4_500_000) * 0.1);
  if (price <= 6_000_000) return Math.ceil(price * 0.0225);
  if (price <= 6_642_860) return Math.ceil(135_000 + (price - 6_000_000) * 0.1);
  if (price <= 9_000_000) return Math.ceil(price * 0.03);
  if (price <= 10_080_000) return Math.ceil(270_000 + (price - 9_000_000) * 0.1);
  if (price <= 20_000_000) return Math.ceil(price * 0.0375);
  if (price <= 21_739_120) return Math.ceil(750_000 + (price - 20_000_000) * 0.1);
  if (price <= 100_000_000) return Math.ceil(price * 0.0425);
  if (price <= 109_574_470) return Math.ceil(4_250_000 + (price - 100_000_000) * 0.3);
  return Math.ceil(price * 0.065);
}

export function calculateMortgage(input: Partial<MortgageInputs> = {}): MortgageResult {
  const inputs = normalizeMortgageInputs(input);
  const loanAmount = inputs.price * (inputs.ltv / 100);
  const deposit = inputs.price - loanAmount;
  const months = inputs.years * 12;
  const payment = monthlyPayment(loanAmount, inputs.annualInterestRate, months);
  const stressedPayment = monthlyPayment(
    loanAmount,
    inputs.annualInterestRate + inputs.stressRate,
    months,
  );
  const totalRepayment = payment * months;
  const totalInterest = Math.max(0, totalRepayment - loanAmount);
  const debtExpenses = inputs.monthlyDebtExpenses ?? 0;
  const income = inputs.monthlyIncome;
  const amortization = annualAmortization(
    loanAmount,
    inputs.annualInterestRate,
    inputs.years,
    payment,
  );

  return {
    inputs,
    loanAmount,
    deposit,
    monthlyPayment: payment,
    stressedMonthlyPayment: stressedPayment,
    totalRepayment,
    totalInterest,
    dsr: debtServicingRatio(payment, debtExpenses, income),
    stressedDsr: debtServicingRatio(stressedPayment, debtExpenses, income),
    stampDuty: calculateResidentialStampDuty(inputs.price),
    amortization,
  };
}

function parseSearchNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseMortgageSearch(search: Record<string, unknown>): MortgageSearch {
  const price = parseSearchNumber(search.price);
  const income = parseSearchNumber(search.income);
  const expenses = parseSearchNumber(search.expenses);
  const normalized = normalizeMortgageInputs({
    ...(price === undefined ? {} : { price }),
    ...(income === undefined ? {} : { monthlyIncome: income }),
    ...(expenses === undefined ? {} : { monthlyDebtExpenses: expenses }),
  });

  return {
    ...(price === undefined ? {} : { price: normalized.price }),
    ...(normalized.monthlyIncome === undefined ? {} : { income: normalized.monthlyIncome }),
    ...(normalized.monthlyDebtExpenses === undefined
      ? {}
      : { expenses: normalized.monthlyDebtExpenses }),
  };
}
