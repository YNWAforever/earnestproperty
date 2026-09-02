import { describe, expect, test } from "bun:test";

import { staffSessionDenialCopy } from "./staff-session";

// A signed-in Neon Auth user who is not (yet) a bound staff member used to see
// the full admin shell with every page failing "你的帳戶沒有權限查看這項資料".
// The shell now names the actual reason so the member and the admin know what
// to do next.
describe("staffSessionDenialCopy", () => {
  test("unverified email tells the member to ask an admin to link the account", () => {
    const copy = staffSessionDenialCopy("staff-email-unverified");
    expect(copy.title).toContain("尚未連結");
    expect(copy.description).toContain("驗證");
    expect(copy.description).toContain("管理員");
    expect(copy.description).toContain("連結帳戶");
  });

  test("forbidden explains the account is not a staff record", () => {
    const copy = staffSessionDenialCopy("forbidden");
    expect(copy.title).toContain("職員");
    expect(copy.description).toContain("管理員");
  });

  test("unauthorized asks for a fresh sign-in", () => {
    const copy = staffSessionDenialCopy("unauthorized");
    expect(copy.description).toContain("重新登入");
  });
});
