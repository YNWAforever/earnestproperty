import { expect, test } from "bun:test";
import { staffActionErrorText } from "./admin-error-text";
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
