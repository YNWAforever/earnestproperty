import { test } from "node:test";
import assert from "node:assert/strict";
import { schoolNets, getSchoolNet } from "./school-nets.ts";

test("schoolNets has both net 62 and net 71, each with empty primarySchools", () => {
  assert.equal(schoolNets["62"].netCode, "62");
  assert.equal(schoolNets["62"].districtLabel, "荃灣");
  assert.deepEqual(schoolNets["62"].primarySchools, []);
  assert.equal(schoolNets["71"].netCode, "71");
  assert.equal(schoolNets["71"].districtLabel, "屯門");
  assert.deepEqual(schoolNets["71"].primarySchools, []);
});

test("getSchoolNet returns the matching net or null for an unknown code", () => {
  assert.equal(getSchoolNet("62")?.netCode, "62");
  assert.equal(getSchoolNet("71")?.netCode, "71");
  assert.equal(getSchoolNet("999"), null);
  assert.equal(getSchoolNet(null), null);
  assert.equal(getSchoolNet(undefined), null);
});
