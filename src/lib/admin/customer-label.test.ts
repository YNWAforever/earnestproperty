import { expect, test } from "bun:test";

import { customerConfirmLabel } from "./customer-label";

test("falls back to WhatsApp 客戶 and 未有電話, and masks to the last four digits", () => {
  expect(customerConfirmLabel({ name: null, phone: null })).toEqual({
    name: "WhatsApp 客戶",
    phone: "未有電話",
  });
  expect(customerConfirmLabel({ name: "   ", phone: "" })).toEqual({
    name: "WhatsApp 客戶",
    phone: "未有電話",
  });
  expect(customerConfirmLabel({ name: " 陳小姐 ", phone: "+852 9123 4567" })).toEqual({
    name: "陳小姐",
    phone: "••••4567",
  });
  // Separators never count as digits: only the last four digits are shown.
  expect(customerConfirmLabel({ name: "陳小姐", phone: "+852 9123-4567" }).phone).toBe("••••4567");
  expect(customerConfirmLabel({ name: "陳小姐", phone: "(852) 9123 45-67" }).phone).toBe(
    "••••4567",
  );
  // A phone with no digits is no phone.
  expect(customerConfirmLabel({ name: "陳小姐", phone: " - " }).phone).toBe("未有電話");
});

test("never shows the full number as the name", () => {
  // The conversation list falls back to the phone as the display name; a confirmation must not.
  for (const name of ["+852 9123 4567", "85291234567", "9123-4567"]) {
    const label = customerConfirmLabel({ name, phone: "+852 9123 4567" });
    expect(label).toEqual({ name: "WhatsApp 客戶", phone: "••••4567" });
    expect(JSON.stringify(label)).not.toContain("9123");
  }
});
