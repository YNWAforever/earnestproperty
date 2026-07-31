import { describe, expect, test } from "bun:test";

import { normaliseLicence, normalisePhone } from "./licence";

describe("normalisePhone", () => {
  test("accepts an 8-digit HK number and strips formatting", () => {
    expect(normalisePhone("2688 2988")).toBe("26882988");
    expect(normalisePhone("+852 9123 4567")).toBe("91234567");
    expect(normalisePhone("(852) 6123-4567")).toBe("61234567");
  });

  test("rejects anything that is not a plausible HK number", () => {
    // Wrong length, or a leading digit Hong Kong does not allocate. Returning null
    // leaves the field blank; writing a guess would misroute a real enquiry.
    for (const input of ["123456", "123456789", "12345678", "42345678", "", "n/a"]) {
      expect(normalisePhone(input)).toBeNull();
    }
  });

  test("handles null and undefined without throwing", () => {
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
  });
});

describe("normaliseLicence", () => {
  test("accepts an EAA individual licence and normalises its shape", () => {
    expect(normaliseLicence("E-123456")).toBe("E-123456");
    expect(normaliseLicence("e123456")).toBe("E-123456");
    expect(normaliseLicence("  s-654321 ")).toBe("S-654321");
  });

  test("rejects the agency licence in an individual field", () => {
    // C-018613 is Earnest Property's own agency licence and appears throughout the
    // site copy, so it reads as plausible. On an individual card it is a
    // transcription error, not a value.
    expect(normaliseLicence("C-018613")).toBeNull();
    expect(normaliseLicence("c018613")).toBeNull();
  });

  test("rejects malformed values", () => {
    // "1233" is the literal junk sitting in the production test row today.
    for (const input of ["1233", "E-12345", "E-1234567", "", "TBC", "EE-123456"]) {
      expect(normaliseLicence(input)).toBeNull();
    }
  });
});
