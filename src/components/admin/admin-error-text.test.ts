import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { adminErrorMessage, ADMIN_ERROR_CODES, staffActionErrorText } from "./admin-error-text";
import { ServerFnResponseError } from "@/lib/neon/server-fn-response";

const fallback = "操作未完成，請重試。";

test("staffActionErrorText maps 401, 403 and 409 to the existing zh-HK strings", () => {
  expect(staffActionErrorText(new ServerFnResponseError("Unauthorized", 401), fallback)).toBe(
    "登入已失效，請重新登入後再試。",
  );
  expect(staffActionErrorText(new Response("Forbidden", { status: 403 }), fallback)).toBe(
    "你沒有權限進行此操作。",
  );
  expect(staffActionErrorText({ status: 409 }, fallback)).toBe(
    "資料版本已變更，請重新載入並核對後再儲存。",
  );
});

test("other statuses fall back to the screen's own message", () => {
  expect(staffActionErrorText(new ServerFnResponseError("BATCH_ROWS_INVALID", 400), fallback)).toBe(
    fallback,
  );
  expect(staffActionErrorText({ status: 500 }, "覆蓋資料未能載入")).toBe("覆蓋資料未能載入");
});

test("local validation errors keep their text", () => {
  expect(staffActionErrorText(new Error("最多 1000 筆，請縮小篩選。"), fallback)).toBe(
    "最多 1000 筆，請縮小篩選。",
  );
  expect(staffActionErrorText(new Error("Failed to fetch"), fallback)).toBe(
    "無法連線到伺服器，請檢查網絡後重試。",
  );
  expect(staffActionErrorText(new Error(""), fallback)).toBe(fallback);
  expect(staffActionErrorText("Forbidden", fallback)).toBe(fallback);
  expect(staffActionErrorText(null, fallback)).toBe(fallback);
});

test("plain link conflict codes read in zh-HK with existing copy", () => {
  expect(staffActionErrorText(new Error("WA_LINK_VERSION_CONFLICT"), fallback)).toBe(
    "資料版本已變更，請重新載入並核對後再儲存。",
  );
  expect(staffActionErrorText(new Error("STAFF_REFERENCE_CONFLICT_OR_EXPIRED"), fallback)).toBe(
    "同事來源代碼已過期或衝突",
  );
});

test("404 maps to the existing not-found copy so staff reload instead of retrying", () => {
  expect(staffActionErrorText(new Response("Not found", { status: 404 }), "連結未能載入")).toBe(
    "找不到資料，可能已被刪除，請重新載入頁面。",
  );
  expect(staffActionErrorText(new ServerFnResponseError("NOT_FOUND", 404), fallback)).toBe(
    "找不到資料，可能已被刪除，請重新載入頁面。",
  );
  expect(staffActionErrorText({ status: 404 }, fallback)).toBe(
    "找不到資料，可能已被刪除，請重新載入頁面。",
  );
});

test("a delisted offer code reads in zh-HK with the existing batch copy", () => {
  expect(staffActionErrorText(new Error("WA_LINK_PUBLIC_OFFER_UNAVAILABLE"), fallback)).toBe(
    "目前租售盤已下架或版本改變",
  );
});

const read = (p: string) => readFileSync(p, "utf8");

test("known codes and statuses map, zh-HK text passes, unknown English, SQL and stack text fall back", () => {
  expect(adminErrorMessage(new Error("CMS_REVISION_CONFLICT"))).toBe(
    ADMIN_ERROR_CODES.CMS_REVISION_CONFLICT,
  );
  expect(ADMIN_ERROR_CODES.CMS_REVISION_CONFLICT).toContain("發布版本");
  expect(adminErrorMessage({ status: 403 })).toBe("你沒有權限進行此操作。");
  expect(adminErrorMessage(new Error("最多 1000 筆，請縮小篩選。"))).toBe(
    "最多 1000 筆，請縮小篩選。",
  );
  const generic = "操作未完成，請重試。";
  expect(adminErrorMessage(new Error('relation "x" does not exist'))).toBe(generic);
  expect(
    adminErrorMessage(
      new Error("TypeError: Cannot read properties of undefined\n    at foo (x.ts:1:1)"),
    ),
  ).toBe(generic);
  expect(adminErrorMessage(new Error("Forbidden"), "自訂")).toBe(
    "你的帳戶沒有權限查看這項資料，請聯絡系統管理員。",
  );
  expect(adminErrorMessage("Something odd", "自訂")).toBe("自訂");
  expect(adminErrorMessage("Forbidden", "自訂")).toBe("自訂");
  expect(adminErrorMessage(null)).toBe(generic);
  expect(adminErrorMessage({ message: "boom" })).toBe(generic);
  expect(adminErrorMessage({ status: 500, message: "SELECT * FROM x" }, "自訂")).toBe("自訂");
  expect(adminErrorMessage(new Error("duplicate key value violates unique constraint"))).toBe(
    "資料重複，未能儲存。請檢查是否已有相同記錄。",
  );
});

test("our own zh-HK server safety messages pass through unchanged", () => {
  // Real thrown/returned zh-HK text: FX-12 identity review (fix/fx-12-phone-identity),
  // forwarded-enquiries.ts / .server.ts, admin-data.server.ts, admin-property-bulk.server.ts.
  const own = [
    "此對話身分待核對，請先確認客戶身分再回覆。",
    "此對話身分待核對：訊息已保存，但未連結客戶，暫時不能回覆。",
    "轉交未能保存。",
    "請求編號無效。",
    "來源網址只接受安全 HTTPS 網址。",
    "未能確認此物業是否已更新。請重新載入並核對結果後再操作。",
    "此範圍已有相同問題，請改用編輯。",
  ];
  for (const m of own) {
    expect(adminErrorMessage(new Error(m))).toBe(m);
    expect(adminErrorMessage(m)).toBe(m);
    expect(adminErrorMessage({ message: m })).toBe(m);
  }
});

test("CMS codes have exactly one source", () => {
  expect(read("src/routes/admin.cms.tsx")).not.toContain("CMS_RESOURCE_NOT_FOUND:");
  expect(read("src/components/admin/estates/AdminEstateEditorForm.tsx")).not.toContain(
    "CMS_RESOURCE_NOT_FOUND:",
  );
  expect(ADMIN_ERROR_CODES.CMS_RESOURCE_NOT_FOUND).toContain("找不到此資源");
  expect(ADMIN_ERROR_CODES.NOTHING_TO_RETRY).toContain("沒有可重新發送");
});

test("no admin route keeps a raw errorText", () => {
  const files = [
    "agents",
    "blasts",
    "cms",
    "leads",
    "leads_.command-center",
    "segments",
    "whatsapp",
  ];
  for (const f of files) {
    const src = read(`src/routes/admin.${f}.tsx`);
    const m = src.match(/function errorText\(error: unknown\)[^{]*\{([\s\S]*?)\n\}/);
    expect(m, f).not.toBeNull();
    expect(m![1], f).toContain("adminErrorMessage");
  }
});
