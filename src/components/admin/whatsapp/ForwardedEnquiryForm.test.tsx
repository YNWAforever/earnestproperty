import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ForwardedEnquiryForm } from "./ForwardedEnquiryForm";
test("manual forward form keeps optional unverified original contact separate from chat reply", () => {
  const html = renderToStaticMarkup(
    <ForwardedEnquiryForm
      agents={[{ id: "a", name: "職員甲", active: true }]}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(html).toContain("人工轉交");
  expect(html).toContain("原客戶聯絡線索（選填，未核實）");
  expect(html).toContain("不可用來直接回覆");
  expect(html).toContain("到期時間");
  expect(html).toContain("職員甲");
  expect(html).not.toContain("發送 WhatsApp");
});
