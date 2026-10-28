import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FaqList } from "./FaqList";

test("FAQ questions and answers are present in the initial HTML and use native disclosures", () => {
  const html = renderToStaticMarkup(
    <FaqList
      group="estate-faq"
      items={[
        { question: "如何比較屋苑？", answer: "先比較位置、面積及實際叫價。" },
        { question: "如何聯絡？", answer: "可查看分行資料 & 預約睇樓。" },
      ]}
    />,
  );

  expect(html.match(/<details\b/g)?.length).toBe(2);
  expect(html.match(/<summary\b/g)?.length).toBe(2);
  expect(html).toContain('name="estate-faq"');
  expect(html).toContain("如何比較屋苑？");
  expect(html).toContain("先比較位置、面積及實際叫價。");
  expect(html).toContain("可查看分行資料 &amp; 預約睇樓。");
  expect(html).not.toMatch(/<details\b[^>]*\bopen(?:=|\s|>)/);
});
