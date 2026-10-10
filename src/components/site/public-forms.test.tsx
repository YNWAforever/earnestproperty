import { expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Initial-render contract for the four public enquiry forms (contact, property enquiry,
 * valuation 放盤估價, listing alert 新盤通知). Interaction behaviour (submit -> inline
 * result) is exercised in the browser fixture; this file pins what must not change when the
 * forms are moved out of their route files: field names, ids, unchecked consents, and that
 * no result line is rendered before anything was submitted.
 *
 * `@/lib/neon/admin-data` is mocked because the real module wires TanStack Start server
 * functions, which have no business running in a static-markup render. The mocked functions
 * are never called here.
 */
mock.module("@/lib/neon/admin-data", () => ({
  createWebsiteInquiry: async () => ({ id: "inquiry-1" }),
  createValuationLead: async () => ({ id: "valuation-1" }),
  createListingAlert: async () => ({ id: "alert-1" }),
}));

const { ContactInquiryForm } = await import("./ContactInquiryForm");
const { ListingAlertForm } = await import("./ListingAlertForm");
const { ValuationLeadForm } = await import("./OwnerValuationPanel");
const { PropertyInquiryForm } = await import("../property/PropertyInquiryForm");

function renderContact() {
  return load(renderToStaticMarkup(createElement(ContactInquiryForm)));
}
function renderProperty() {
  return load(
    renderToStaticMarkup(
      createElement(PropertyInquiryForm, { propertyId: "property-1", listingNo: "A123" }),
    ),
  );
}
function renderValuation() {
  return load(renderToStaticMarkup(createElement(ValuationLeadForm, { estateId: "estate-1" })));
}
function renderAlert() {
  return load(
    renderToStaticMarkup(
      createElement(ListingAlertForm, { search: { deal: "sale", district: "sham-tseng" } }),
    ),
  );
}

const forms = [
  ["ContactInquiryForm", renderContact],
  ["PropertyInquiryForm", renderProperty],
  ["ValuationLeadForm", renderValuation],
  ["ListingAlertForm", renderAlert],
] as const;

test("each of the four forms renders without a role=alert or role=status element initially", () => {
  for (const [label, render] of forms) {
    const $ = render();
    expect($("form").length, `${label} renders a <form>`).toBe(1);
    expect($("[role='alert']").length, `${label} has no alert`).toBe(0);
    expect($("[role='status']").length, `${label} has no status`).toBe(0);
  }
});

test('PropertyInquiryForm keeps an input with id="name" and name="name"', () => {
  const $ = renderProperty();
  const input = $("input#name");
  expect(input.length).toBe(1);
  expect(input.attr("name")).toBe("name");
});

test("PropertyInquiryForm keeps its other field ids and the listing-number placeholder", () => {
  const $ = renderProperty();
  expect($("input#phone").attr("name")).toBe("phone");
  expect($("input#email").attr("name")).toBe("email");
  expect($("textarea#message").attr("name")).toBe("message");
  expect($("textarea#message").attr("placeholder")).toBe("想查詢編號 A123");
});

test("ContactInquiryForm keeps field names name, phone, email, message", () => {
  const $ = renderContact();
  for (const field of ["name", "phone", "email"]) {
    expect($(`input[name='${field}']`).length, `input ${field}`).toBe(1);
  }
  expect($("textarea[name='message']").length).toBe(1);
});

test("consent checkboxes render unchecked", () => {
  const consentIds: Array<[string, () => ReturnType<typeof load>, string]> = [
    ["ContactInquiryForm", renderContact, "contact-consentWhatsapp"],
    ["PropertyInquiryForm", renderProperty, "consentWhatsapp"],
    ["ValuationLeadForm", renderValuation, "valuation-consent"],
    ["ListingAlertForm", renderAlert, "alert-consent"],
  ];
  for (const [label, render, id] of consentIds) {
    const checkbox = render()(`button#${id}`);
    expect(checkbox.length, `${label} consent control`).toBe(1);
    expect(checkbox.attr("aria-checked"), `${label} consent is unchecked`).toBe("false");
    expect(checkbox.attr("data-state"), `${label} consent state`).toBe("unchecked");
  }
});

test("each of the four forms renders one off-screen honeypot", () => {
  for (const [label, render] of forms) {
    const $ = render();
    const honeypot = $("form input[name='website']");
    expect(honeypot.length, `${label} has exactly one honeypot`).toBe(1);
    expect(honeypot.attr("tabindex"), `${label} honeypot is out of the tab order`).toBe("-1");
    expect(honeypot.attr("autocomplete"), `${label} honeypot opts out of autofill`).toBe("off");
    expect(honeypot.attr("type"), `${label} honeypot is a text input`).toBe("text");
    // No constraint the browser could enforce: a filled field must never block a submit.
    for (const attr of ["required", "pattern", "minlength", "maxlength"]) {
      expect(honeypot.attr(attr), `${label} honeypot has no ${attr}`).toBeUndefined();
    }
    expect(
      honeypot.closest("[aria-hidden='true']").length,
      `${label} honeypot sits inside an aria-hidden ancestor`,
    ).toBe(1);
    // Off-screen, never display:none / hidden: bots skip hidden inputs.
    for (const node of [
      honeypot,
      ...honeypot
        .parents()
        .toArray()
        .map((el) => $(el)),
    ]) {
      const style = (node.attr("style") ?? "").replace(/\s/g, "");
      expect(style, `${label} has no inline display:none`).not.toContain("display:none");
      expect(node.attr("hidden"), `${label} has no hidden attribute`).toBeUndefined();
      expect((node.attr("class") ?? "").split(/\s+/), `${label} has no hidden class`).not.toContain(
        "hidden",
      );
    }
    const wrapper = honeypot.closest("[aria-hidden='true']");
    expect(wrapper.attr("class") ?? "", `${label} wrapper is positioned off-screen`).toContain(
      "-left-[10000px]",
    );
    expect(
      (honeypot.closest("form").attr("class") ?? "").split(/\s+/),
      `${label} form is the positioning context`,
    ).toContain("relative");
  }
});

test("the honeypot is not an accessible form control", () => {
  for (const [label, render] of forms) {
    const $ = render();
    const honeypot = $("form input[name='website']");
    const id = honeypot.attr("id");
    expect(id, `${label} honeypot has an id`).toBeTruthy();
    const labelEl = $(`label[for='${id}']`);
    expect(labelEl.text(), `${label} honeypot label`).toBe("請勿填寫此欄");
    // The only element labelled 請勿填寫此欄 is inside an aria-hidden subtree, so it is not
    // exposed to assistive tech as a textbox (getByRole("textbox", { name }) finds nothing).
    const exposed = $("input, textarea")
      .toArray()
      .filter((el) => {
        const elId = $(el).attr("id");
        return (
          elId &&
          $(`label[for='${elId}']`).text() === "請勿填寫此欄" &&
          $(el).closest("[aria-hidden='true']").length === 0
        );
      });
    expect(exposed.length, `${label} exposes no textbox named 請勿填寫此欄`).toBe(0);
  }
});

test("the honeypot sits after the last visible field, directly before the submit button", () => {
  for (const [label, render] of forms) {
    const $ = render();
    const wrapper = $("form input[name='website']").closest("[aria-hidden='true']");
    expect(wrapper.next().is("button[type='submit']"), `${label}: next is submit`).toBe(true);
    // Every real control (inputs, textareas, select triggers, checkboxes) comes earlier in DOM
    // order, so an on-screen keyboard's "next" from 姓名 or 電話 cannot reach the honeypot.
    const controls = $("form")
      .find("input, textarea, button")
      .toArray()
      .filter((el) => $(el).attr("name") !== "website" && $(el).attr("type") !== "submit");
    const all: unknown[] = $("form *").toArray();
    const honeypotIndex = all.indexOf(wrapper.get(0)!);
    expect(controls.length, `${label} has visible controls`).toBeGreaterThan(2);
    for (const control of controls) {
      expect(all.indexOf(control), `${label}: control before honeypot`).toBeLessThan(honeypotIndex);
    }
  }
});
