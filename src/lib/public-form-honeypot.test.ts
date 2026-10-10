import { expect, test } from "bun:test";

import { HONEYPOT_FIELD, isHoneypotFilled } from "./public-form-honeypot";

test("the honeypot field is named website", () => {
  expect(HONEYPOT_FIELD).toBe("website");
});

test("an empty or absent honeypot is not flagged", () => {
  for (const value of [undefined, null, "", "   ", "\n\t "]) {
    expect(isHoneypotFilled(value), JSON.stringify(value)).toBe(false);
  }
});

test("any non-empty honeypot value is flagged, whatever its type or length", () => {
  const values: unknown[] = [
    "x",
    "https://spam.example",
    123,
    0,
    true,
    { url: "https://spam.example" },
    ["https://spam.example"],
    "a".repeat(10_000),
    `${" ".repeat(5_000)}x`,
  ];
  for (const value of values) {
    expect(isHoneypotFilled(value), typeof value).toBe(true);
  }
});

test("a hostile value never throws", () => {
  const throwing = {
    toString() {
      throw new Error("hostile");
    },
  };
  const nullProto = Object.create(null);
  expect(isHoneypotFilled(throwing)).toBe(true);
  expect(isHoneypotFilled(nullProto)).toBe(true);
  expect(isHoneypotFilled(Symbol("x"))).toBe(true);
});
