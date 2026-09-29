import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { staffAuthZhHK } from "../lib/admin/auth-localization.ts";

const authRoute = await readFile(new URL("./auth.$pathname.tsx", import.meta.url), "utf8");
const adminShell = await readFile(
  new URL("../components/admin/AdminShell.tsx", import.meta.url),
  "utf8",
);

test("staff sign-in offers zh-HK labels and English without exposing provider jargon", () => {
  assert.match(authRoute, /localization=\{locale === "zh-HK"/);
  assert.match(authRoute, /English/);
  assert.match(authRoute, /職員登入/);
  assert.doesNotMatch(adminShell, /請先使用 Neon Auth 登入/);
});

test("installed AuthView localization includes actionable sign-in and recovery labels", () => {
  assert.equal(staffAuthZhHK.SIGN_IN, "職員登入");
  assert.equal(staffAuthZhHK.EMAIL, "電郵地址");
  assert.equal(staffAuthZhHK.PASSWORD, "密碼");
  assert.equal(staffAuthZhHK.FORGOT_PASSWORD_ACTION, "發送重設連結");
  assert.doesNotMatch(staffAuthZhHK.FORGOT_PASSWORD_EMAIL, /帳戶不存在|找不到帳戶/);
});
