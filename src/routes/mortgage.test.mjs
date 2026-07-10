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
    "Property price",
    "Loan-to-value ratio",
    "Mortgage term",
    "Annual interest rate",
    "Monthly income",
    "Existing monthly debt expenses",
    "Monthly repayment",
    "Stressed monthly repayment",
    "Debt servicing ratio",
    "Annual amortization",
    "Slider",
    "calculateMortgage",
    "normalizeMortgageInputs",
    "mortgageInputsFromSearch",
    "https://www.ird.gov.hk/chi/faq/avd.htm",
    "https://www.hkmc.com.hk/eng/our_business/mortgage_insurance_programme.html",
    "Mortgage insurance premiums are not estimated",
  ]) {
    assert.match(component, new RegExp(text.replaceAll(".", "\\.")), `${text} should be present`);
  }

  assert.match(component, /htmlFor=/);
  assert.match(component, /aria-label=/);
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noreferrer"/);
  assert.match(
    component,
    /setInputs\(\(current\)\s*=>\s*normalizeMortgageInputs\(\{\s*\.\.\.current,\s*\[key\]: value\s*\}\)\)/,
    "committed controls should store the same normalized values used by calculation",
  );
});
