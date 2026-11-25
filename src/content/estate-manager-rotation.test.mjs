// The estate -> manager rotation comes from the agency's own printed sheet, so
// these tests pin both the transcription and its link to the live registry. A
// wrong slug or a typo in a phone number would otherwise only show up as a lead
// going to nobody, weeks later.
import assert from "node:assert/strict";
import test from "node:test";

import { estateRegistry } from "./estate-registry.ts";
import {
  ESTATE_MANAGERS,
  ESTATE_MANAGER_BY_NAME,
  ESTATE_MANAGER_BY_SLUG,
  ESTATE_MANAGER_ROTATION_SOURCE,
  UNMAPPED_ESTATE_NAMES,
  estateManagerContact,
  managerRotationForEstate,
} from "./estate-manager-rotation.ts";

const registrySlugs = new Set(estateRegistry.map((entry) => entry.slug));

test("the three managers are the rows the notification plan already carries", () => {
  assert.deepEqual(
    ESTATE_MANAGERS.map((contact) => contact.rotation),
    [1, 2, 3],
  );
  assert.deepEqual(
    ESTATE_MANAGERS.map((contact) => contact.recipientKey),
    ["manager:1", "manager:2", "manager:3"],
  );
  // Phones as written on the sheet, digits only, company prefixed.
  assert.deepEqual(
    ESTATE_MANAGERS.map((contact) => contact.phone),
    ["85266442444", "85291005322", "85266266608"],
  );
  for (const contact of ESTATE_MANAGERS) {
    assert.match(contact.staffId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.ok(contact.nameZh && contact.nameEn, "both names are recorded");
  }
  // Distinct people, not three labels for one account.
  assert.equal(new Set(ESTATE_MANAGERS.map((contact) => contact.staffId)).size, 3);
});

test("every slug-keyed estate exists in the registry", () => {
  const unknown = Object.keys(ESTATE_MANAGER_BY_SLUG).filter((slug) => !registrySlugs.has(slug));
  assert.deepEqual(unknown, [], "a slug that is not in estate-registry.ts cannot be routed");
  assert.ok(
    Object.keys(ESTATE_MANAGER_BY_SLUG).length >= 45,
    `expected the transcribed sheet to cover at least 45 live estates, got ${
      Object.keys(ESTATE_MANAGER_BY_SLUG).length
    }`,
  );
  for (const rotation of Object.values(ESTATE_MANAGER_BY_SLUG)) {
    assert.ok([1, 2, 3].includes(rotation), `unexpected rotation ${rotation}`);
  }
});

test("names without a live page are listed instead of being dropped", () => {
  for (const name of UNMAPPED_ESTATE_NAMES) {
    assert.ok(Object.hasOwn(ESTATE_MANAGER_BY_NAME, name), `${name} is still recorded by name`);
    assert.equal(managerRotationForEstate({ name }), ESTATE_MANAGER_BY_NAME[name]);
    assert.equal(managerRotationForEstate({ slug: null, name }), ESTATE_MANAGER_BY_NAME[name]);
  }
  // 村屋 and 其他 are not estates and must never be routed as one.
  assert.equal(Object.hasOwn(ESTATE_MANAGER_BY_NAME, "村屋"), false);
  assert.equal(Object.hasOwn(ESTATE_MANAGER_BY_NAME, "其他"), false);
  assert.equal(managerRotationForEstate({ name: "村屋" }), null);
  assert.equal(managerRotationForEstate({ name: "其他" }), null);
});

test("the live slug wins, the printed name is the fallback", () => {
  assert.equal(managerRotationForEstate({ slug: "mun-ming-shan" }), 1);
  assert.equal(managerRotationForEstate({ slug: "bellagio" }), 3);
  assert.equal(managerRotationForEstate({ slug: null, name: "滿名山" }), 1);
  assert.equal(managerRotationForEstate({ slug: null, name: " 滿名山 " }), 1);
  // A slug we know beats a name that disagrees: the page is the live identity.
  assert.equal(managerRotationForEstate({ slug: "napa", name: "滿名山" }), 2);
  assert.equal(managerRotationForEstate({ slug: "not-an-estate" }), null);
  assert.equal(managerRotationForEstate({}), null);
  assert.equal(managerRotationForEstate({ slug: null, name: null }), null);
});

test("an unknown or unscoped enquiry has no manager, which is the copy-only case", () => {
  assert.equal(estateManagerContact(managerRotationForEstate({ slug: "unknown-estate" })), null);
  assert.equal(estateManagerContact(null), null);
  assert.equal(estateManagerContact(undefined), null);
  assert.equal(estateManagerContact(4), null);
  assert.equal(estateManagerContact(2)?.nameZh, "鄧錦雄");
});

test("the transcription records where it came from", () => {
  assert.equal(ESTATE_MANAGER_ROTATION_SOURCE.photoTakenAt, "2026-11-11");
  assert.equal(ESTATE_MANAGER_ROTATION_SOURCE.transcribedAt, "2026-11-24");
  assert.ok(ESTATE_MANAGER_ROTATION_SOURCE.marking.includes("①"));
});
