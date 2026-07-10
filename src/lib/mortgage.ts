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

export const DEFAULT_MORTGAGE_INPUTS: MortgageInputs = {
  price: 8_000_000,
  ltv: 70,
  years: 30,
  annualInterestRate: 3.25,
  stressRate: 2,
};

const MAX_PROPERTY_PRICE = 1_000_000_000;
const MAX_YEARS = 50;
const MAX_RATE = 100;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizedInputs(input: Partial<MortgageInputs>): MortgageInputs {
  const price =
    isFiniteNumber(input.price) && input.price > 0
      ? clamp(input.price, 1, MAX_PROPERTY_PRICE)
      : DEFAULT_MORTGAGE_INPUTS.price;
  const ltv = isFiniteNumber(input.ltv) ? clamp(input.ltv, 0, 100) : DEFAULT_MORTGAGE_INPUTS.ltv;
  const years =
    isFiniteNumber(input.years) && input.years >= 1
      ? clamp(input.years, 1, MAX_YEARS)
      : DEFAULT_MORTGAGE_INPUTS.years;
  const annualInterestRate = isFiniteNumber(input.annualInterestRate)
    ? clamp(input.annualInterestRate, 0, MAX_RATE)
    : DEFAULT_MORTGAGE_INPUTS.annualInterestRate;
  const stressRate = isFiniteNumber(input.stressRate)
    ? clamp(input.stressRate, 0, MAX_RATE)
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

function monthlyPayment(principal: number, annualInterestRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;

  const monthlyRate = annualInterestRate / 1_200;
  if (monthlyRate === 0) return principal / months;

  const growth = (1 + monthlyRate) ** months;
  return (principal * monthlyRate * growth) / (growth - 1);
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
      const principalPortion = Math.min(balance, Math.max(0, payment - interest));

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
  if (price <= 4_323_780) return 100 + (price - 4_000_000) * 0.2;
  if (price <= 4_500_000) return price * 0.015;
  if (price <= 4_935_480) return 67_500 + (price - 4_500_000) * 0.1;
  if (price <= 6_000_000) return price * 0.0225;
  if (price <= 6_642_860) return 135_000 + (price - 6_000_000) * 0.1;
  if (price <= 9_000_000) return price * 0.03;
  if (price <= 10_080_000) return 270_000 + (price - 9_000_000) * 0.1;
  if (price <= 20_000_000) return price * 0.0375;
  if (price <= 21_739_120) return 750_000 + (price - 20_000_000) * 0.1;
  if (price <= 100_000_000) return price * 0.0425;
  if (price <= 109_574_470) return 4_250_000 + (price - 100_000_000) * 0.3;
  return price * 0.065;
}

export function calculateMortgage(input: Partial<MortgageInputs> = {}): MortgageResult {
  const inputs = normalizedInputs(input);
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
  const totalInterest = totalRepayment - loanAmount;
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
    dsr: income && income > 0 ? ((payment + debtExpenses) / income) * 100 : null,
    stressedDsr: income && income > 0 ? ((stressedPayment + debtExpenses) / income) * 100 : null,
    stampDuty: calculateResidentialStampDuty(inputs.price),
    amortization,
  };
}

function parseSearchNumber(value: unknown, minimum: number): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : undefined;
}

export function parseMortgageSearch(search: Record<string, unknown>): MortgageSearch {
  const price = parseSearchNumber(search.price, 1);
  const income = parseSearchNumber(search.income, 0);
  const expenses = parseSearchNumber(search.expenses, 0);

  return {
    ...(price === undefined ? {} : { price }),
    ...(income === undefined ? {} : { income }),
    ...(expenses === undefined ? {} : { expenses }),
  };
}
