import assert from "node:assert/strict";
import test from "node:test";

import { whatsappPhoneProblem } from "./whatsapp-phone.js";

// This validator exists because the build guard that was supposed to prevent a
// broken WhatsApp CTA did not. It only asked "is the variable set?", so
// .env.example's placeholder satisfied it perfectly -- and the live site sent
// every 我要買樓 enquiry to +852 0000 0000 for eight days before anyone noticed.
// Presence is not plausibility.

test("the .env.example placeholder is rejected", () => {
  assert.match(whatsappPhoneProblem("85200000000"), /placeholder/);
});

test("branch landlines are rejected -- they cannot receive WhatsApp", () => {
  // .env.example names these three explicitly, and site-branches.js carries
  // `whatsapp: null` with a TODO for each, so pasting one here is a live risk.
  for (const landline of ["85226882988", "85226886996", "85226882883"]) {
    assert.match(whatsappPhoneProblem(landline), /landline/, `${landline} must be rejected`);
  }
});

// whatsappUrl() interpolates the raw value into `https://wa.me/${phone}`, and
// wa.me needs bare digits. A leading + produces a malformed link on every CTA.
test("a leading + or any non-digit is rejected", () => {
  assert.match(whatsappPhoneProblem("+85297987774"), /digits/);
  assert.match(whatsappPhoneProblem("852 9798 7774"), /digits/);
  assert.match(whatsappPhoneProblem("852-9798-7774"), /digits/);
});

test("obviously fake shapes are rejected", () => {
  assert.match(whatsappPhoneProblem("85200000000"), /placeholder/);
  assert.match(whatsappPhoneProblem("85300000000"), /all-zero/);
  assert.match(whatsappPhoneProblem("11111111111"), /repeated digit/);
});

test("empty and missing values are rejected", () => {
  for (const value of ["", "   ", null, undefined]) {
    assert.ok(whatsappPhoneProblem(value), `${JSON.stringify(value)} must be rejected`);
  }
});

test("a real Hong Kong mobile passes", () => {
  // The number this agency actually uses, plus other valid HK mobile prefixes.
  for (const value of ["85297987774", "85251234567", "85261234567"]) {
    assert.equal(whatsappPhoneProblem(value), null, `${value} must be accepted`);
  }
});

// The validator must not be so strict that it blocks a legitimate future
// number -- a guard that fails good input is its own outage.
test("non-Hong Kong numbers are not rejected merely for being foreign", () => {
  assert.equal(whatsappPhoneProblem("6591234567"), null, "a Singapore mobile must be accepted");
  assert.equal(whatsappPhoneProblem("447700900123"), null, "a UK mobile must be accepted");
});
