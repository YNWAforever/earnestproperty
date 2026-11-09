import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extract28hseAgentLicences,
  extract28hseAgentNames,
  normalizeLicence,
  pickBranchManager,
  propertyhkAgentSlug,
} from "./backfill-property-agents.mjs";

test("normalizeLicence reads the EAA licence out of free text", () => {
  assert.equal(normalizeLicence("S-098767"), "S-098767");
  assert.equal(normalizeLicence("s 098767"), "S-098767");
  assert.equal(normalizeLicence("代理個人牌照號碼: E-226447"), "E-226447");
  assert.equal(normalizeLicence("C-018613"), null);
  assert.equal(normalizeLicence(null), null);
});

test("extract28hseAgentLicences returns the two agent licences in page order", () => {
  const html = `
    <div>代理個人牌照號碼: <span>S-098767</span></div>
    <div>代理個人牌照號碼：<b>E-226447</b></div>
    <div>代理個人牌照號碼: S-098767</div>
    <div>公司牌照號碼: C-018613</div>`;
  assert.deepEqual(extract28hseAgentLicences(html), ["S-098767", "E-226447"]);
  assert.deepEqual(extract28hseAgentLicences("<p>沒有代理</p>"), []);
});

test("extract28hseAgentNames keeps the 放盤聯絡人 names in page order", () => {
  const html = `
    <p>放盤聯絡人 <strong>李偉增</strong></p>
    <p>放盤聯絡人 姚頌溏 </p>`;
  assert.deepEqual(extract28hseAgentNames(html), ["李偉增", "姚頌溏"]);
});

test("propertyhkAgentSlug reads the agent blog slug from an asking_detail URL", () => {
  assert.equal(
    propertyhkAgentSlug("https://www.property.hk/asking_detail/ept/tommyyiu/6742186.html"),
    "ept/tommyyiu",
  );
  assert.equal(
    propertyhkAgentSlug("https://www.property.hk/asking_detail/eps/wendy/6813270.html"),
    "eps/wendy",
  );
  assert.equal(propertyhkAgentSlug("https://www.property.hk/asking_detail/100.html"), null);
  assert.throws(() => propertyhkAgentSlug("not a url"));
});

test("pickBranchManager prefers the branch 營業經理", () => {
  const branchStaff = [
    { id: "agent", job_title: "高級客戶經理", display_order: 1, is_duty_manager: false },
    { id: "manager", job_title: "高級營業經理", display_order: 9, is_duty_manager: false },
    { id: "duty", job_title: "高級客戶經理", display_order: 2, is_duty_manager: true },
  ];
  assert.equal(pickBranchManager(branchStaff, "agent").id, "manager");
});

test("pickBranchManager falls back to the duty manager, then display order", () => {
  const branchStaff = [
    { id: "agent", job_title: "高級客戶經理", display_order: 1, is_duty_manager: false },
    { id: "duty", job_title: "高級客戶經理", display_order: 5, is_duty_manager: true },
    { id: "colleague", job_title: "客戶經理", display_order: 2, is_duty_manager: false },
  ];
  assert.equal(pickBranchManager(branchStaff, "agent").id, "duty");
  assert.equal(
    pickBranchManager(
      branchStaff.filter((row) => row.id !== "duty"),
      "agent",
    ).id,
    "colleague",
  );
});

test("pickBranchManager uses the next colleague when the agent is the manager", () => {
  const branchStaff = [
    { id: "manager", job_title: "高級營業經理", display_order: 1, is_duty_manager: false },
    { id: "senior", job_title: "高級客戶經理", display_order: 4, is_duty_manager: false },
    { id: "junior", job_title: "客戶經理", display_order: 7, is_duty_manager: false },
  ];
  assert.equal(pickBranchManager(branchStaff, "manager").id, "senior");
  assert.equal(pickBranchManager([{ id: "manager" }], "manager"), null);
  assert.equal(pickBranchManager([], "agent"), null);
});
