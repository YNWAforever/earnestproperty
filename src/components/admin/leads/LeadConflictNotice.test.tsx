import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LeadConflictNotice } from "./LeadConflictNotice";

const render = (reloading: boolean) =>
  load(renderToStaticMarkup(createElement(LeadConflictNotice, { reloading, onReload: () => {} })));

describe("LeadConflictNotice", () => {
  test("renders the fix-plan copy, the reload hint and an enabled reload button", () => {
    const $ = render(false);
    const alert = $('[role="alert"]');
    expect(alert.length).toBe(1);
    expect(alert.text()).toContain("此客戶查詢已被其他同事更新，請重新載入後再儲存。");
    expect(alert.text()).toContain(
      "重新載入會以最新資料取代你未儲存的修改；已新增的跟進備註不會受影響。",
    );
    const button = $("button");
    expect(button.text()).toBe("重新載入最新資料");
    expect(button.attr("disabled")).toBeUndefined();
  });

  test("disables the button while reloading", () => {
    const button = render(true)("button");
    expect(button.attr("disabled")).toBeDefined();
    expect(button.text()).toBe("載入中…");
  });
});
