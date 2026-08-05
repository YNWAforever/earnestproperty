import { describe, expect, test } from "bun:test";

import { describeTemplateParameters, templateHasNoParameters } from "./template-preview";

describe("describeTemplateParameters", () => {
  test("labels header, body and footer components in Chinese", () => {
    expect(
      describeTemplateParameters([
        { type: "header", parameters: [{ type: "text", text: "深井" }] },
        {
          type: "body",
          parameters: [
            { type: "text", text: "陳先生" },
            { type: "text", text: "碧堤半島" },
          ],
        },
        { type: "footer", parameters: [{ type: "text", text: "晉誠地產" }] },
      ]),
    ).toEqual([
      { label: "標題", value: "深井" },
      { label: "內文", value: "陳先生 · 碧堤半島" },
      { label: "註腳", value: "晉誠地產" },
    ]);
  });

  test("numbers repeated button components so a value maps to a button", () => {
    expect(
      describeTemplateParameters([
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "a" }] },
        { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "b" }] },
      ]),
    ).toEqual([
      { label: "按鈕 1", value: "a" },
      { label: "按鈕 2", value: "b" },
    ]);
  });

  test("reads currency and date_time fallbacks", () => {
    expect(
      describeTemplateParameters([
        {
          type: "body",
          parameters: [
            { type: "currency", currency: { fallback_value: "HK$8,800,000" } },
            { type: "date_time", date_time: { fallback_value: "2026年8月5日" } },
          ],
        },
      ]),
    ).toEqual([{ label: "內文", value: "HK$8,800,000 · 2026年8月5日" }]);
  });

  test("a static template yields no lines rather than an error", () => {
    expect(describeTemplateParameters([])).toEqual([]);
    expect(templateHasNoParameters([])).toBe(true);
    expect(templateHasNoParameters([{ type: "body", parameters: [] }])).toBe(true);
  });

  // The column is JSONB with a '[]' default but nothing validates its shape, so
  // a malformed row must not take the send confirmation down with it.
  test("survives malformed component payloads", () => {
    expect(describeTemplateParameters(null)).toEqual([]);
    expect(describeTemplateParameters("not-an-array")).toEqual([]);
    expect(describeTemplateParameters([null, 42, { type: "body" }])).toEqual([]);
    expect(
      describeTemplateParameters([{ type: "body", parameters: [{ type: "text", text: "   " }] }]),
    ).toEqual([]);
  });

  test("keeps an unrecognised component type visible instead of dropping it", () => {
    expect(
      describeTemplateParameters([
        { type: "carousel", parameters: [{ type: "text", text: "推廣" }] },
      ]),
    ).toEqual([{ label: "carousel", value: "推廣" }]);
  });
});
