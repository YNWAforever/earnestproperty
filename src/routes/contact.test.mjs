import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("/contact route wires the new enquiry-type/preferred-contact fields and the duplicate-submit guard", () => {
  const routePath = "src/routes/contact.tsx";
  assert.equal(existsSync(join(root, routePath)), true, `${routePath} should exist`);

  const route = read(routePath);
  assert.match(route, /createFileRoute\("\/contact"\)/);

  // The pure logic lives in contact-inquiry-form.ts, not duplicated inline --
  // this asserts the route actually wires to it, not that it reimplements
  // the same schema/guard locally.
  assert.match(route, /from "@\/lib\/contact-inquiry-form"/);
  assert.match(route, /createSubmitGuard/);
  assert.match(route, /submitContactInquiry/);
  assert.match(route, /ENQUIRY_TYPE_OPTIONS/);
  assert.match(route, /PREFERRED_CONTACT_OPTIONS/);

  // The guard must be checked before any React state is touched inside
  // handleSubmit -- i.e. the tryStart() check appears before the first
  // setSubmitting(true) call, and finish() is called (in a finally block,
  // so it always releases regardless of outcome).
  const handlerStart = route.indexOf("async function handleSubmit");
  assert.notEqual(handlerStart, -1, "handleSubmit must exist");
  const handlerBody = route.slice(handlerStart, route.indexOf("\n  }\n", handlerStart));
  const tryStartIndex = handlerBody.indexOf(".tryStart()");
  const firstSetSubmittingTrue = handlerBody.indexOf("setSubmitting(true)");
  assert.notEqual(tryStartIndex, -1, "handleSubmit must call the guard's tryStart()");
  assert.notEqual(firstSetSubmittingTrue, -1);
  assert.ok(
    tryStartIndex < firstSetSubmittingTrue,
    "the duplicate-submit guard must be checked before any submitting-state UI update, " +
      "not just before the network call",
  );
  assert.match(handlerBody, /finally\s*{[\s\S]*\.finish\(\)/, "guard must release in a finally");
});

test("/contact's enquiry-type and preferred-contact options use this site's existing terminology", () => {
  const source = read("src/lib/contact-inquiry-form.ts");
  for (const label of ["買樓", "租樓", "放盤估價", "一般查詢"]) {
    assert.ok(source.includes(label), `enquiry type options should include ${label}`);
  }
  for (const label of ["WhatsApp", "電話", "Email"]) {
    assert.ok(source.includes(label), `preferred contact options should include ${label}`);
  }
});

test("PICS copy renders near the form and links to a real /privacy route", () => {
  const route = read("src/routes/contact.tsx");
  assert.match(route, /私隱政策/, "PICS copy should mention the privacy policy");
  assert.match(route, /href="\/privacy"/, "PICS copy must link to /privacy");
  assert.equal(existsSync(join(root, "src/routes/privacy.tsx")), true, "/privacy must exist");

  // The PICS paragraph must sit before the <form> opens, not folded into the
  // marketing-consent checkbox or the operational-reply disclaimer.
  const picsIndex = route.indexOf("私隱政策");
  const formOpenIndex = route.indexOf("<form onSubmit={handleSubmit}");
  assert.ok(picsIndex > -1 && formOpenIndex > -1 && picsIndex < formOpenIndex);
});

test("direct-marketing consent stays structurally separate from the operational-reply disclaimer", () => {
  const route = read("src/routes/contact.tsx");

  // The marketing checkbox: unchecked by default, a real opt-in control.
  assert.match(route, /consentWhatsapp,\s*setConsentWhatsapp\]\s*=\s*useState\(false\)/);
  assert.match(route, /id="contact-consentWhatsapp"/);
  assert.match(route, /checked=\{consentWhatsapp\}/);
  assert.match(route, /我同意透過\s*WhatsApp\s*接收樓盤資訊及推廣訊息/);

  // The operational disclaimer: plain text, not a checkbox, appears after
  // the submit button (i.e. it is not the same element as the consent
  // checkbox and does not gate submission).
  const consentIndex = route.indexOf('id="contact-consentWhatsapp"');
  const submitButtonIndex = route.indexOf("提交查詢");
  const disclaimerIndex = route.indexOf("按提交即表示同意我們透過上述聯絡方式回覆查詢");
  assert.ok(consentIndex > -1 && submitButtonIndex > -1 && disclaimerIndex > -1);
  assert.ok(
    consentIndex < submitButtonIndex && submitButtonIndex < disclaimerIndex,
    "marketing consent and the operational disclaimer must remain two distinct elements, " +
      "not merged into one",
  );
});

test("enquiryType and preferredContact are required selects, not optional decoration", () => {
  const route = read("src/routes/contact.tsx");
  assert.match(
    route,
    /<Select\s+value=\{enquiryType\}\s+onValueChange=\{setEnquiryType\}\s+name="enquiryType"\s+required/,
  );
  assert.match(
    route,
    /value=\{preferredContact\}[\s\S]{0,80}onValueChange=\{setPreferredContact\}/,
  );
  assert.match(route, /查詢類型 \*/);
  assert.match(route, /偏好聯絡方式 \*/);
});
