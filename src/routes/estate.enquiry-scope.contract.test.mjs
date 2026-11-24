// 只講屋苑 entry point B: the estate page must hand its own slug to the enquiry
// form, or an estate-scoped enquiry lands unowned and Willy's three-case rule
// never fires for the estate case.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("the estate page renders the enquiry form with its own slug", () => {
  const routePath = "src/routes/estate.$slug.tsx";
  assert.equal(existsSync(join(root, routePath)), true, `${routePath} should exist`);

  const route = read(routePath);
  assert.match(
    route,
    /import \{ ContactInquiryForm \} from "@\/components\/site\/ContactInquiryForm";/,
  );
  assert.match(route, /<ContactInquiryForm estateSlug=\{estate\.slug\} \/>/);
  // The form sits in its own anchored section, so a CTA can link straight to it.
  assert.match(route, /id="estate-enquiry"/);
  assert.match(route, /\{estateName\} 屋苑查詢/);
});

test("the contact form passes the slug through to the enquiry payload", () => {
  const form = read("src/components/site/ContactInquiryForm.tsx");
  assert.match(form, /export function ContactInquiryForm\(\{ estateSlug \}/);
  assert.match(form, /estateSlug: estateSlug \?\? null/);

  const helper = read("src/lib/contact-inquiry-form.ts");
  // Only a real slug travels; an absent one must not add an empty field.
  assert.match(helper, /\.\.\.\(estateSlug \? \{ estateSlug \} : \{\}\),/);
  assert.match(
    helper,
    /buildWebsiteInquiryPayload\(parsed\.data, consentWhatsapp, website, estateSlug\)/,
  );
});

test("both entry points resolve the slug against the estate registry", () => {
  const contact = read("src/routes/contact.tsx");
  assert.match(contact, /estateRegistry\.find\(\(entry\) => entry\.slug === search\.estate\)/);

  const server = read("src/lib/neon/admin-data.server.ts");
  // Server-side is the authority: an unknown slug is dropped, never trusted.
  assert.match(server, /estateRegistry\.find\(\(entry\) => entry\.slug === rawEstateSlug\)/);
  assert.match(server, /managerRotationForEstate\(\{ slug: requestedEstateSlug \}\)/);
});
