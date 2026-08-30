import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("mortgage calculator route is registered with safe search parsing and SEO metadata", () => {
  const routePath = "src/routes/mortgage.tsx";
  assert.equal(existsSync(join(root, routePath)), true, `${routePath} should exist`);

  const route = read(routePath);
  assert.match(route, /createFileRoute\("\/mortgage"\)/);
  assert.match(route, /validateSearch:\s*parseMortgageSearch/);
  assert.match(route, /按揭計算機/);
  assert.match(route, /name:\s*"description"/);
  assert.match(route, /MortgageCalculator/);
  assert.match(
    route,
    /<MortgageCalculator\s+key=\{JSON\.stringify\(search\)\}\s+initialSearch=\{search\}\s*\/>/,
    "route search changes should remount the calculator with synchronized state",
  );
});

test("mortgage calculator exposes practical controls, results, and official references", () => {
  const componentPath = "src/components/site/MortgageCalculator.tsx";
  assert.equal(existsSync(join(root, componentPath)), true, `${componentPath} should exist`);

  const component = read(componentPath);
  for (const text of [
    "樓價",
    "按揭成數",
    "按揭年期",
    "年利率",
    "每月入息",
    "現有每月債務支出",
    "每月供款",
    "壓力測試後每月供款",
    "債務供款比率",
    "年度還款明細",
    "Slider",
    "calculateMortgage",
    "commitMortgageDraft",
    "normalizeMortgageInputs",
    "parseMortgageDraft",
    "mortgageInputsFromSearch",
    "編輯中，暫無法顯示結果",
    "此入息無法計算",
    "https://www.ird.gov.hk/chi/faq/avd.htm",
    "https://www.hkmc.com.hk/eng/our_business/mortgage_insurance_programme.html",
    "本計算機並未估算按揭保險保費",
  ]) {
    assert.match(component, new RegExp(text.replaceAll(".", "\\.")), `${text} should be present`);
  }

  assert.match(component, /htmlFor=/);
  assert.match(component, /aria-label=/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noreferrer"/);
  assert.match(
    component,
    /type="text"/,
    "keyboard inputs should preserve draft strings instead of coercing every keystroke",
  );
  assert.match(
    component,
    /onChange=\{\(event\) => onDraftChange\(event\.target\.value\)\}/,
    "keyboard changes should update only the visible draft",
  );
  assert.match(component, /onBlur=\{onCommitDraft\}/, "keyboard drafts should commit on blur");
  assert.match(
    component,
    /event\.currentTarget\.blur\(\)/,
    "Enter should commit by completing the field edit",
  );
  assert.match(
    component,
    /editingField === null \? calculateMortgage\(state\.inputs\) : null/,
    "results must not be calculated from a hidden committed value during keyboard editing",
  );
});

test("mortgage calculator has no remaining English UI copy from the pre-translation baseline", () => {
  const componentPath = "src/components/site/MortgageCalculator.tsx";
  const component = read(componentPath);

  // Every English string this plan's research enumerated as present before
  // translation -- a regression guard against a partial/missed translation,
  // not a generic Latin-character regex (which would false-positive on
  // "HKD"/"en-HK" formatter config and code identifiers that must stay).
  const legacyEnglishStrings = [
    "PROPERTY FINANCE",
    "Property price",
    "Loan-to-value ratio",
    "Mortgage term",
    "Annual interest rate",
    "Stress-test rate increase",
    "Monthly income",
    "Existing monthly debt expenses",
    "Unavailable for this income",
    "Add income to calculate",
    "Enter a valid number, then press Enter or leave the field.",
    "Purchase and loan",
    "Use your expected loan terms.",
    "Affordability",
    "Optional figures for debt servicing ratios.",
    "Your estimate",
    "Indicative monthly cost and cash required.",
    "Results unavailable while editing",
    "Finish editing",
    "Monthly repayment",
    "Stressed monthly repayment",
    "Loan amount",
    "Deposit",
    "Residential stamp duty",
    "Total interest over term",
    "Debt servicing ratio",
    "Stressed debt servicing ratio",
    "This is an illustration, not a lending approval.",
    "Annual amortization",
    "How the projected balance changes over the selected term.",
    "Total repayment:",
    "Unavailable while editing",
    "Opening balance",
    "Principal paid",
    "Interest paid",
    "Closing balance",
    "Finish editing to view the updated amortization schedule.",
    "Important notes",
    "Inland Revenue Department",
    "Mortgage insurance",
    "Mortgage insurance premiums are not estimated.",
    "HKMC Mortgage Insurance Programme",
  ];

  for (const text of legacyEnglishStrings) {
    assert.equal(component.includes(text), false, `${text} should have been translated to zh-HK`);
  }
});

test("mortgage calculator shows a cash-required-at-closing figure matching PropertyDecisionActions' wording", () => {
  const component = read("src/components/site/MortgageCalculator.tsx");

  // Same label and computation PropertyDecisionActions.tsx's mortgage teaser
  // card already uses -- this must not become a second, differently-worded
  // implementation of the same figure.
  assert.match(component, /預計上會現金需求（首期＋印花稅）/);
  assert.match(component, /result\.deposit \+ result\.stampDuty/);
});

test("mortgage calculator collapses the annual amortization table behind a toggle, default collapsed", () => {
  const component = read("src/components/site/MortgageCalculator.tsx");

  assert.match(component, /const \[showAmortization, setShowAmortization\] = useState\(false\)/);
  assert.match(component, /顯示年度還款明細/);
  assert.match(component, /隱藏年度還款明細/);
  assert.match(
    component,
    /<Collapsible open=\{showAmortization\} onOpenChange=\{setShowAmortization\}/,
  );
});
