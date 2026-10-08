import assert from "node:assert/strict";
import test from "node:test";

import {
  PHONE_LOCK_PREFIX,
  hkLocalNumber,
  normalizePhone,
  phoneEquivalentsSql,
  phoneMatchSql,
  phoneSpellingTiebreakSql,
} from "./phone.js";

// FX-12 (D-12): one canonical customer phone. Hong Kong is "852" + 8 digits;
// everything else is E.164 digits without "+". Anything unparseable is null,
// never a guess.

test("normalizePhone handles HK formats", () => {
  for (const input of [
    "9123 4567",
    "+852 9123-4567",
    "0085291234567",
    "00852 9123 4567",
    "85291234567",
    "(852) 9123 4567",
    "９１２３４５６７",
    "９１２３　４５６７",
    " 9123.4567 ",
  ]) {
    assert.equal(normalizePhone(input), "85291234567", JSON.stringify(input));
  }
});

test("labelled and punctuated HK spellings normalise (fix round 1, I-1/I-2)", () => {
  for (const input of [
    "Tel: 9123 4567",
    "T: +852 9123 4567",
    "(+852) 9123 4567",
    "+(852) 9123 4567",
    "9123/4567",
    "(852)91234567",
    "+852-9123-4567",
    "Tel. 9123 4567",
    "TEL:91234567",
    "Phone: 9123-4567",
    "Mobile +852 9123 4567",
    "WhatsApp: 9123 4567",
    "WA: 9123 4567",
    "電話：9123 4567",
    "手提: 9123 4567",
    "9123\t4567",
    "-+852 9123 4567",
  ]) {
    assert.equal(normalizePhone(input), "85291234567", JSON.stringify(input));
  }
});

test("ambiguous or malformed input is still null (fix round 1)", () => {
  for (const input of [
    "9123 4567 / 9876 5432",
    "2688 2988/9123 4567",
    "9123 4567/68",
    "Tel: 9123 4567, 9876 5432",
    "Tel: 9123456",
    "Tel: 123456789",
    "Fax: 9123 4567",
    "Tel: abc",
    "Tel:",
  ]) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
});

test("a landline is accepted", () => {
  assert.equal(normalizePhone("2688 2988"), "85226882988");
});

test("UK and CN keep their country code", () => {
  assert.equal(normalizePhone("+44 20 7946 0958"), "442079460958");
  assert.equal(normalizePhone("0044 20 7946 0958"), "442079460958");
  assert.equal(normalizePhone("+86 138 1234 5678"), "8613812345678");
  assert.equal(normalizePhone("8613812345678"), "8613812345678");
});

test("garbage is null", () => {
  for (const input of [
    "",
    null,
    undefined,
    "+",
    "abc",
    "9123456",
    "123456789",
    "01234567",
    "00000000",
    "+852 9123 456",
    "+85212345678",
    "9123 4567 ext 12",
    "+1234567890123456",
    "++85291234567",
    "9123+4567",
  ]) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
});

test("a + before an 8-digit HK number is HK", () => {
  // Open question 4 (owner decision): "+" followed by exactly 8 digits is Hong Kong.
  assert.equal(normalizePhone("+9123 4567"), "85291234567");
  assert.equal(normalizePhone("+2688 2988"), "85226882988");
});

test("hkLocalNumber only unwraps 852", () => {
  assert.equal(hkLocalNumber("85291234567"), "91234567");
  assert.equal(hkLocalNumber("442079460958"), null);
  assert.equal(hkLocalNumber("8613812345678"), null);
  assert.equal(hkLocalNumber("91234567"), null);
  assert.equal(hkLocalNumber("0085291234567"), null);
  assert.equal(hkLocalNumber(null), null);
});

test("phoneMatchSql rejects unsafe identifiers", () => {
  assert.throws(() => phoneMatchSql("c.normalized_phone; drop", "$1"));
  assert.throws(() => phoneMatchSql("x", "$1 OR 1=1"));
  assert.throws(() => phoneEquivalentsSql("c.normalized_phone) OR (true"));
  assert.throws(() => phoneSpellingTiebreakSql("x", "$1--"));
  assert.match(phoneMatchSql("c.normalized_phone", "$5"), /c\.normalized_phone/);
  assert.match(phoneEquivalentsSql("c.normalized_phone"), /ARRAY\[/);
});

test("the advisory lock prefix is the one ingest already uses", () => {
  assert.equal(PHONE_LOCK_PREFIX, "woztell-phone:");
});
