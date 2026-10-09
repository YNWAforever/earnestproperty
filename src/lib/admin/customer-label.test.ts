import { expect, test } from "bun:test";

import { customerConfirmLabel, templateRecipientLabel } from "./customer-label";

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

test("a name that contains an 8-digit HK number falls back, in any width or dash", () => {
  for (const name of [
    "陳生 91234567",
    "91234567 Chan",
    "陳生 9123 4567",
    "陳生 9123-4567",
    "陳生 9123‑4567", // non-breaking hyphen
    "陳生 9123‒4567", // figure dash
    "陳生 ９１２３４５６７", // full-width digits
    "陳生（852）9123 4567",
  ]) {
    const label = customerConfirmLabel({ name, phone: null });
    expect(label.name).toBe("WhatsApp 客戶");
  }
  // Short numbers in a name are not a phone and stay.
  // NFKC is only for detection: the name keeps its full-width brackets.
  expect(customerConfirmLabel({ name: "陳生（業主）", phone: null }).name).toBe("陳生（業主）");
  for (const name of ["Flat 12A 陳生", "陳生 2號", "Room 1234"])
    expect(customerConfirmLabel({ name, phone: null }).name).toBe(name);
  // Full-width digits in the phone still mask to the last four.
  expect(customerConfirmLabel({ name: "陳生", phone: "＋852 ９１２３ ４５６７" }).phone).toBe(
    "••••4567",
  );
});

test("the template recipient is the member id the send goes to, not the CRM phone", () => {
  expect(templateRecipientLabel({ name: "陳小姐", memberId: "85296663333" })).toEqual({
    name: "陳小姐",
    phone: "••••3333",
  });
  expect(templateRecipientLabel({ name: "陳小姐", memberId: "+852 9666 3333" }).phone).toBe(
    "••••3333",
  );
});

test("a member id that is not phone-like shows 未有電話, never digits from an opaque id", () => {
  for (const memberId of [
    null,
    undefined,
    "",
    "synthetic-member",
    "64b7f2e1a9c3d4e5f6a70812", // provider object id: has digits, is not a phone
    "member-85291234567",
  ])
    expect(templateRecipientLabel({ name: null, memberId })).toEqual({
      name: "WhatsApp 客戶",
      phone: "未有電話",
    });
});
