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

// Fix round 2 (controller ruling): a phone is never assembled from separate digit
// groups unless it carries an explicit "+" or "00" country prefix.
test("bare digit groups that are not a Hong Kong shape are null (fix round 2)", () => {
  for (const input of [
    "9123 4567 12",
    "1203 9123 4567",
    "9123 4567 9876",
    "91 23 45 67",
    "912 345 67",
    "86 138 1234 5678",
    "44 20 7946 0958",
    "852 912 345 67",
    "852 1234 5678",
    "Tel 9123 4567 12",
  ]) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
});

test("bare Hong Kong shapes still normalise (fix round 2)", () => {
  for (const input of [
    "91234567",
    "9123 4567",
    "9123-4567",
    "9123/4567",
    "852 9123 4567",
    "852 91234567",
    "(852) 9123 4567",
    "(852)91234567",
    "85291234567",
  ]) {
    assert.equal(normalizePhone(input), "85291234567", JSON.stringify(input));
  }
});

test("bare contiguous runs keep today's behaviour (WozTell, company number)", () => {
  assert.equal(normalizePhone("8613812345678"), "8613812345678");
  assert.equal(normalizePhone("85212345678"), "85212345678");
  assert.equal(normalizePhone("442079460958"), "442079460958");
});

test("an explicit + or 00 prefix allows grouping and drops a (0) trunk (fix round 2)", () => {
  assert.equal(normalizePhone("+44 (0)7911 123456"), "447911123456");
  assert.equal(normalizePhone("0044 (0) 20 7946 0958"), "442079460958");
  assert.equal(normalizePhone("+44 20 7946 0958"), "442079460958");
  assert.equal(normalizePhone("+86 138 0013 8000"), "8613800138000");
  assert.equal(normalizePhone("0086 138 0013 8000"), "8613800138000");
  assert.equal(normalizePhone("+852 (0) 9123 4567"), "85291234567");
});

test("a trailing label is accepted (fix round 2)", () => {
  for (const input of [
    "+852 9123 4567 (WhatsApp)",
    "9123 4567 WhatsApp",
    "9123 4567 (WA)",
    "9123 4567 (手提)",
    "Tel: 9123 4567 (WhatsApp)",
  ]) {
    assert.equal(normalizePhone(input), "85291234567", JSON.stringify(input));
  }
});

test("earlier probes still hold (fix round 2)", () => {
  for (const input of [
    "Tel: 9123 4567 / 9876 5432",
    "9123 4567 ext 12",
    "Tel 9123 4567 x12",
    "Room 1203, Tel 91234567",
    "Room 1203 91234567",
    "91234567 91234567",
    "Fax 9123 4567",
    "9123 4567 (Fax)",
  ]) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
  assert.equal(normalizePhone("電話：9123-4567"), "85291234567");
  assert.equal(normalizePhone("WA: 0085291234567"), "85291234567");
  assert.equal(normalizePhone("９１２３　４５６７"), "85291234567");
  assert.equal(normalizePhone("+86 138 1234 5678"), "8613812345678");
  assert.equal(normalizePhone("+44 7911 123456"), "447911123456");
});
