import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneDigits,
  toTelHref,
  toWhatsAppHref,
  DEFAULT_AGENT_WHATSAPP_MESSAGE,
} from "./contact-links.ts";

test("normalizePhoneDigits: plain 8-digit HK number gets 852 prefix", () => {
  assert.equal(normalizePhoneDigits("2688 2988"), "85226882988");
  assert.equal(normalizePhoneDigits("26882988"), "85226882988");
});

test("normalizePhoneDigits: already-prefixed +852 number", () => {
  assert.equal(normalizePhoneDigits("+852 2688 2988"), "85226882988");
});

test("normalizePhoneDigits: digits-only 852-prefixed number", () => {
  assert.equal(normalizePhoneDigits("85226882988"), "85226882988");
});

test("normalizePhoneDigits: null/empty/short input returns null", () => {
  assert.equal(normalizePhoneDigits(null), null);
  assert.equal(normalizePhoneDigits(undefined), null);
  assert.equal(normalizePhoneDigits(""), null);
  assert.equal(normalizePhoneDigits("123"), null);
});

test("toTelHref: builds tel: link with + prefix", () => {
  assert.equal(toTelHref("26882988"), "tel:+85226882988");
  assert.equal(toTelHref(null), null);
});

test("toWhatsAppHref: builds wa.me link with default message", () => {
  const href = toWhatsAppHref("26882988");
  assert.ok(href?.startsWith("https://wa.me/85226882988?text="));
  assert.ok(href?.includes(encodeURIComponent(DEFAULT_AGENT_WHATSAPP_MESSAGE)));
});

test("toWhatsAppHref: returns null for invalid number (no button should render)", () => {
  assert.equal(toWhatsAppHref("123"), null);
  assert.equal(toWhatsAppHref(null), null);
});

test("toWhatsAppHref: custom message is encoded", () => {
  const href = toWhatsAppHref("26882988", "test message");
  assert.ok(href?.endsWith("text=test%20message"));
});
