import assert from "node:assert/strict";
import test from "node:test";
import {
  ENQUIRY_COPY,
  ENQUIRY_ESTATE_ROUTES,
  ENQUIRY_MANAGERS,
  matchEnquiryEstate,
  mentionsSpecificProperty,
  notificationPhone,
  planEnquiryRouting,
} from "./enquiry-routing.mjs";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const primary = {
  staffId: id(1),
  position: 1,
  active: true,
  showOnWebsite: true,
  phone: "9123 4567",
  whatsapp: "9123 4567",
};
const secondary = {
  staffId: id(2),
  position: 2,
  active: true,
  showOnWebsite: true,
  whatsapp: "+852 9234 5678",
};
const property = {
  id: id(10),
  current: true,
  status: "active",
  publicListingNo: "A123456",
  dealType: "sale",
};
const keys = (plan) => plan.recipients.map((r) => r.key);
const approved = [
  [
    1,
    "豪景花園/帝華軒/龍騰閣/逸璟龍灣/深井汀九村屋/滿名山/星堤/上源/The Carmel/南岸/愛琴海岸/帝御/凱和山/愛琴灣/海澄軒/龍珠島/碧翠花園/海譽/青榕臺/海景花園/翠峰小築/容龍居/翠濤居/棕月灣/青山別墅/蟠龍半島/青麗灣別墅",
  ],
  [
    2,
    "浪翠園/麗都花園/海雲軒/嘉御龍庭/皇璧/新麗苑/金麗苑/NAPA/Oma Oma/黃金海灣/帝濤灣/漣山/瑜翠園/雅德苑/雅翠苑/春和海景花園",
  ],
  [3, "碧堤半島/海韻花園/縉皇居/海韻臺/琨崙/黃金海岸/OMA by the Sea/飛揚/浪濤灣/海慧花園/屯門閣"],
];
test("all 54 photographed cells route to their approved manager and the one copy contact", () => {
  assert.equal(ENQUIRY_ESTATE_ROUTES.length, 54);
  assert.equal(new Set(ENQUIRY_ESTATE_ROUTES.map((r) => r.scopeKey)).size, 54);
  for (const [manager, labels] of approved)
    for (const label of labels.split("/")) {
      const result = planEnquiryRouting({ estateLabel: label });
      assert.equal(result.routingKind, "estate", label);
      assert.deepEqual(keys(result), [`manager:${manager}`, "copy"], label);
      assert.ok(result.routeKey);
      assert.equal(result.routeRevision, 1);
    }
  assert.equal(ENQUIRY_COPY.phone, "85297987774");
  assert.equal(ENQUIRY_COPY.staffId, null);
  assert.deepEqual(
    Object.values(ENQUIRY_MANAGERS).map((r) => r.phone),
    ["85266442444", "85291005322", "85266266608"],
  );
});
for (const [label, manager] of [
  ["皇壁", 2],
  ["青榕台", 1],
  ["海韻台", 3],
  ["oma OMA", 2],
  ["OMA-by-the-Sea", 3],
  ["the　carmel", 1],
  ["深井村屋", 1],
  ["汀九村屋", 1],
  ["深井/汀九村屋", 1],
]) {
  test(`approved exact case, punctuation and photo alias: ${label}`, () =>
    assert.deepEqual(keys(planEnquiryRouting({ estateLabel: label })), [
      `manager:${manager}`,
      "copy",
    ]));
}
test("longer overlapping 春和海景花園 is not mistaken for 海景花園", () => {
  assert.deepEqual(keys(planEnquiryRouting({ text: "想問春和海景花園有冇租盤？" })), [
    "manager:2",
    "copy",
  ]);
  assert.deepEqual(keys(planEnquiryRouting({ text: "想問海景花園有冇租盤？" })), [
    "manager:1",
    "copy",
  ]);
  assert.deepEqual(keys(planEnquiryRouting({ text: "春和海景花園或者海景花園都想睇" })), ["copy"]);
});
for (const text of [
  "青山公路村屋",
  "屯門村屋",
  "村屋",
  "其他",
  "想問租盤",
  "不知名花園",
  "SNAPA",
  "OMAX OMAX",
  "",
]) {
  test(`unmapped or unscoped never broadcasts managers: ${text}`, () =>
    assert.deepEqual(keys(planEnquiryRouting({ text })), ["copy"]));
}
test("Latin estate names match whole names inside normal prose", () => {
  assert.deepEqual(keys(planEnquiryRouting({ text: "NAPA apartment please" })), [
    "manager:2",
    "copy",
  ]);
  assert.deepEqual(keys(planEnquiryRouting({ text: "想問 oma by the sea 的租盤" })), [
    "manager:3",
    "copy",
  ]);
});
test("multiple estates, conflicting explicit context and unmapped declared estate remain copy only", () => {
  for (const input of [
    { text: "豪景花園或麗都花園" },
    { text: "豪景花園或帝華軒" },
    { estateLabel: "碧堤半島", text: "麗都花園" },
    { estateLabel: "unknown", text: "豪景花園" },
  ])
    assert.deepEqual(keys(planEnquiryRouting(input)), ["copy"]);
});
test("canonical estate IDs are explicit and do not expand approved category aliases", () => {
  const route = {
    ...ENQUIRY_ESTATE_ROUTES.find((r) => r.label === "龍珠島"),
    estateId: id(80),
    version: 3,
  };
  const found = matchEnquiryEstate({ estateId: id(80), routes: [route] });
  assert.equal(found.route.scopeKey, route.scopeKey);
  assert.equal(matchEnquiryEstate({ estateId: id(81), routes: [route] }).route, null);
  assert.equal(planEnquiryRouting({ estateId: id(80), routes: [route] }).routeRevision, 3);
});
test("specific property goes to selected valid correspondent plus copy and no estate manager", () => {
  const input = {
    specific: true,
    property,
    selectedStaffId: secondary.staffId,
    agents: [primary, secondary],
    text: "豪景花園",
  };
  assert.deepEqual(keys(planEnquiryRouting(input)), [`sales:${secondary.staffId}`, "copy"]);
  assert.deepEqual(keys(planEnquiryRouting({ ...input, selectedStaffId: id(99) })), [
    `sales:${primary.staffId}`,
    "copy",
  ]);
});
test("primary correspondent does not require staff auth roles or conversation assignment", () => {
  const result = planEnquiryRouting({ specific: true, property, agents: [primary, secondary] });
  assert.deepEqual(keys(result), [`sales:${primary.staffId}`, "copy"]);
  assert.equal(result.propertyId, property.id);
  assert.equal(result.propertyNo, "A123456");
});
test("inactive, nonpublic or phoneless selected agents cannot become recipients", () => {
  for (const bad of [
    { active: false },
    { showOnWebsite: false },
    { whatsapp: "invalid", phone: null },
  ]) {
    const result = planEnquiryRouting({
      specific: true,
      property,
      selectedStaffId: secondary.staffId,
      agents: [primary, { ...secondary, ...bad }],
    });
    assert.deepEqual(keys(result), [`sales:${primary.staffId}`, "copy"]);
  }
});
test("a Sales phone is not assumed to be WhatsApp when the WhatsApp field is absent", () => {
  const result = planEnquiryRouting({
    specific: true,
    property,
    agents: [{ ...primary, whatsapp: null }],
  });
  assert.deepEqual(keys(result), ["copy"]);
  assert.equal(result.reason, "property_sales_unavailable");
});
test("fallback uses active public p.agent_id only when primary is unavailable", () => {
  assert.deepEqual(
    keys(
      planEnquiryRouting({
        specific: true,
        property,
        agents: [{ ...primary, active: false }, secondary],
        legacyAgent: secondary,
      }),
    ),
    [`sales:${secondary.staffId}`, "copy"],
  );
  const missing = planEnquiryRouting({
    specific: true,
    property,
    agents: [{ ...primary, active: false }, secondary],
  });
  assert.deepEqual(keys(missing), ["copy"]);
  assert.equal(missing.reason, "property_sales_unavailable");
});
test("specific missing, inactive, historical or ambiguous properties never fall back to estate manager", () => {
  for (const candidate of [
    null,
    { ...property, current: false },
    { ...property, status: "withdrawn" },
  ]) {
    const result = planEnquiryRouting({
      specific: true,
      property: candidate,
      agents: [primary],
      text: "豪景花園",
    });
    assert.equal(result.routingKind, "review");
    assert.deepEqual(keys(result), ["copy"]);
  }
  assert.deepEqual(
    keys(
      planEnquiryRouting({
        specific: true,
        property,
        review: true,
        agents: [primary],
        text: "豪景花園",
      }),
    ),
    ["copy"],
  );
});
test("one canonical phone is one recipient, while the copy remains present", () => {
  assert.deepEqual(
    keys(
      planEnquiryRouting({
        specific: true,
        property,
        agents: [{ ...primary, whatsapp: "9798 7774" }],
      }),
    ),
    ["copy"],
  );
});
test("specific references and unit markers are distinguished from estate-only room criteria", () => {
  for (const text of [
    "豪景花園 A123456",
    "豪景花園第3座",
    "海景花園12樓B室",
    "EPWA:unknown",
    "物業編號:missing",
  ])
    assert.equal(mentionsSpecificProperty(text), true, text);
  for (const text of ["豪景花園兩房", "海景花園2房", "NAPA apartment"])
    assert.equal(mentionsSpecificProperty(text), false, text);
});
test("notification phone uses canonical phone identity and permits HK mobiles only", () => {
  assert.equal(notificationPhone("+852 6644 2444"), "85266442444");
  assert.equal(notificationPhone("66442444"), "85266442444");
  for (const value of [
    null,
    "",
    "1234",
    "85221234567",
    "8613812345678",
    "6644 2444 / 9234 5678",
    "opaque-member-id",
  ])
    assert.equal(notificationPhone(value), null);
});
