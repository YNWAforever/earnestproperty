import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WhatsappBatchImport } from "./WhatsappBatchImport";
import { WhatsappLinkWizard } from "./WhatsappLinkWizard";

test("paste-table import displays the fixed template and starts without a false error", () => {
  const html = renderToStaticMarkup(
    createElement(WhatsappBatchImport, {
      onImported: () => {},
    }),
  );
  expect(html).toContain("public_listing_no,deal_type,source,placement_url_or_id,staff_reference");
  expect(html).toContain("貼表格");
  expect(html).not.toContain('role="alert"');
});
test("the existing wizard exposes paste-table import before preview", () => {
  const html = renderToStaticMarkup(
    createElement(WhatsappLinkWizard, {
      seed: [],
      agents: [],
      actorScope: "actor-test",
      onCreated: () => {},
    }),
  );
  expect(html).toContain("貼表格匯入多來源");
  expect(html).toContain("第 1／5 步");
});

test("pausing batch import keeps the ordinary link wizard available", () => {
  const html = renderToStaticMarkup(
    createElement(WhatsappLinkWizard, {
      seed: [],
      agents: [],
      actorScope: "actor-test",
      enableBatchImport: false,
      onCreated: () => {},
    }),
  );
  expect(html).not.toContain("貼表格匯入多來源");
  expect(html).toContain("第 1／5 步");
});
