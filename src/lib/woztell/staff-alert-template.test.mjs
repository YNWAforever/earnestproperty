import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStaffTemplateResponse,
  parseStaffAlertTemplate,
  sanitizeTemplateParam,
} from "./staff-alert-template.ts";
import { describeTemplateParameters } from "./template-preview.ts";

const approved = JSON.stringify({
  name: "staff_lead_alert",
  language: "zh_HK",
  params: ["name", "source", "link"],
});

test("parses the approved template and rejects malformed or unknown params", () => {
  assert.deepEqual(parseStaffAlertTemplate(approved), {
    name: "staff_lead_alert",
    language: "zh_HK",
    params: ["name", "source", "link"],
  });
  assert.deepEqual(
    parseStaffAlertTemplate(JSON.stringify({ name: "a1_b", language: "en", params: ["link"] })),
    { name: "a1_b", language: "en", params: ["link"] },
  );
  const reject = (value) => assert.equal(parseStaffAlertTemplate(value), null, String(value));
  reject(undefined);
  reject("");
  reject("   ");
  reject("not json");
  reject("{}");
  reject("[]");
  reject("null");
  reject(JSON.stringify({ name: "staff_lead_alert", language: "zh_HK", params: ["phone"] }));
  reject(JSON.stringify({ name: "staff_lead_alert", language: "zh_HK", params: ["name", "name"] }));
  reject(JSON.stringify({ name: "staff_lead_alert", language: "zh-HK", params: ["name"] }));
  reject(JSON.stringify({ name: "staff_lead_alert", language: "chinese", params: ["name"] }));
  reject(JSON.stringify({ name: "Staff-Alert", language: "zh_HK", params: ["name"] }));
  reject(JSON.stringify({ name: "", language: "zh_HK", params: ["name"] }));
  reject(JSON.stringify({ name: "a".repeat(513), language: "zh_HK", params: ["name"] }));
  reject(JSON.stringify({ name: "staff_lead_alert", language: "zh_HK", params: [] }));
  reject(
    JSON.stringify({
      name: "staff_lead_alert",
      language: "zh_HK",
      params: ["name", "source", "link", "name"],
    }),
  );
  reject(JSON.stringify({ name: "staff_lead_alert", language: "zh_HK", params: "name" }));
  reject(
    JSON.stringify({
      name: "staff_lead_alert",
      language: "zh_HK",
      params: ["name"],
      body: "extra",
    }),
  );
});

test("template params are single-line, trimmed, capped and never empty", () => {
  assert.equal(sanitizeTemplateParam("陳\n先生\t  ", "客戶"), "陳 先生");
  assert.equal(sanitizeTemplateParam("  a\r\n\r\nb  ", "客戶"), "a b");
  const long = sanitizeTemplateParam("名".repeat(200), "客戶");
  assert.ok(Array.from(long).length <= 60, `length ${Array.from(long).length}`);
  assert.ok(Array.from(sanitizeTemplateParam("x".repeat(200), "客戶", 10)).length <= 10);
  assert.equal(sanitizeTemplateParam("", "客戶"), "客戶");
  assert.equal(sanitizeTemplateParam(null, "客戶"), "客戶");
  assert.equal(sanitizeTemplateParam(undefined, "客戶"), "客戶");
  assert.equal(sanitizeTemplateParam(" \n\t ", "客戶"), "客戶");
  assert.equal(sanitizeTemplateParam("\u0000\u0007", "客戶"), "客戶");
  for (const value of ["a     b", "a\t\t\t\tb", "a     b", "a    b", "a" + " ".repeat(59) + "b"]) {
    const clean = sanitizeTemplateParam(value, "客戶");
    assert.doesNotMatch(clean, / {4}/, JSON.stringify(value));
    assert.doesNotMatch(clean, /[\n\r\t]/, JSON.stringify(value));
    assert.equal(clean, clean.trim());
  }
  // Cutting at the cap never leaves a trailing space.
  const capped = sanitizeTemplateParam("a".repeat(59) + " b", "客戶");
  assert.equal(capped, capped.trim());
  assert.ok(capped.length > 0);
});

test("builds the Meta body components in configured order", () => {
  const template = parseStaffAlertTemplate(
    JSON.stringify({ name: "staff_lead_alert", language: "zh_HK", params: ["link", "name"] }),
  );
  const response = buildStaffTemplateResponse(template, {
    name: "陳\n先生",
    source: "網站查詢",
    link: "https://earnest.example.invalid/admin/leads?lead=00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(response, {
    type: "TEMPLATE",
    elementName: "staff_lead_alert",
    languageCode: "zh_HK",
    components: [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: "https://earnest.example.invalid/admin/leads?lead=00000000-0000-4000-8000-000000000001",
          },
          { type: "text", text: "陳 先生" },
        ],
      },
    ],
  });
  assert.deepEqual(describeTemplateParameters(response.components), [
    {
      label: "內文",
      value:
        "https://earnest.example.invalid/admin/leads?lead=00000000-0000-4000-8000-000000000001 · 陳 先生",
    },
  ]);
  const empty = buildStaffTemplateResponse(parseStaffAlertTemplate(approved), {
    name: "",
    source: " ",
    link: "",
  });
  for (const parameter of empty.components[0].parameters) assert.ok(parameter.text.trim());
});
