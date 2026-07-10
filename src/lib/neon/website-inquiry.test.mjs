import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./website-inquiry.js", import.meta.url);

test("active rental listings assign only active staff and derive renter intent", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry routing helper must exist");
  const { deriveWebsiteInquiryRouting } = await import(moduleUrl);

  assert.deepEqual(
    deriveWebsiteInquiryRouting({
      id: "property-rent",
      dealType: "rent",
      agentId: "agent-active",
      agentActive: true,
    }),
    {
      propertyId: "property-rent",
      assignedAgentId: "agent-active",
      intent: "renter",
    },
  );
});

test("inactive or missing staff never receive an automatic assignment", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry routing helper must exist");
  const { deriveWebsiteInquiryRouting } = await import(moduleUrl);

  assert.deepEqual(
    deriveWebsiteInquiryRouting({
      id: "property-sale",
      dealType: "sale",
      agentId: "agent-inactive",
      agentActive: false,
    }),
    {
      propertyId: "property-sale",
      assignedAgentId: null,
      intent: "buyer",
    },
  );
  assert.deepEqual(
    deriveWebsiteInquiryRouting({
      id: "property-sale",
      dealType: "sale",
      agentId: null,
      agentActive: false,
    }),
    {
      propertyId: "property-sale",
      assignedAgentId: null,
      intent: "buyer",
    },
  );
});

test("unresolved listings remain unassigned and do not retain a caller property id", async () => {
  assert.equal(existsSync(moduleUrl), true, "website inquiry routing helper must exist");
  const { deriveWebsiteInquiryRouting } = await import(moduleUrl);

  assert.deepEqual(deriveWebsiteInquiryRouting(null), {
    propertyId: null,
    assignedAgentId: null,
    intent: "buyer",
  });
});

test("website inquiry SQL resolves active listings and active staff before inserting", () => {
  const source = readFileSync(new URL("./admin-data.server.ts", import.meta.url), "utf8");
  const inquiryStart = source.indexOf("export async function createWebsiteInquiry");
  const inquiryEnd = source.indexOf("export async function updateInquiryStatus", inquiryStart);
  const inquirySource = source.slice(inquiryStart, inquiryEnd);

  assert.notEqual(inquiryStart, -1);
  assert.notEqual(inquiryEnd, -1);
  assert.match(inquirySource, /FROM properties p[\s\S]*p\.status = 'active'/);
  assert.match(inquirySource, /LEFT JOIN staff_users s ON s\.id = p\.agent_id/);
  assert.match(inquirySource, /s\.active/);
  assert.match(inquirySource, /deriveWebsiteInquiryRouting/);
  assert.doesNotMatch(inquirySource, /SELECT contact\.id, \$5::uuid, NULL, 'new', 'buyer'/);
});
