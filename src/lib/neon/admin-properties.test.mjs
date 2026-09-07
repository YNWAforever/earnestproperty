import assert from "node:assert/strict";
import test from "node:test";
import { propertyManagementSchema, propertyGroupFiltersSchema } from "./admin-properties.types.ts";
test("rejects broad or ambiguous management payloads", () => {
  const base = { propertyNo: "R075733", expectedVersion: "version", scope: "rent" };
  assert.equal(
    propertyManagementSchema.safeParse({ ...base, payload: { price: 20 } }).success,
    false,
  );
  assert.equal(
    propertyManagementSchema.safeParse({ ...base, payload: { rent: 20 } }).success,
    true,
  );
  assert.equal(
    propertyManagementSchema.safeParse({ ...base, scope: "all", payload: { status: "sold" } })
      .success,
    false,
  );
  assert.equal(
    propertyManagementSchema.safeParse({ ...base, scope: "shared", payload: {} }).success,
    false,
  );
  assert.equal(
    propertyManagementSchema.safeParse({ ...base, scope: "shared", payload: { listing_no: "x" } })
      .success,
    false,
  );
});
test("defaults active grouped view and bounds paging", () => {
  assert.equal(propertyGroupFiltersSchema.parse({}).status, "active");
  assert.equal(propertyGroupFiltersSchema.safeParse({ pageSize: 10000 }).success, false);
});

test("sort inputs are bounded with a recent-update default", () => {
  assert.equal(propertyGroupFiltersSchema.parse({}).sort, "updated");
  assert.equal(propertyGroupFiltersSchema.parse({}).direction, "desc");
  assert.equal(
    propertyGroupFiltersSchema.safeParse({ sort: "price; DROP TABLE properties" }).success,
    false,
  );
  assert.equal(propertyGroupFiltersSchema.safeParse({ direction: "sideways" }).success, false);
  for (const sort of ["updated", "propertyNo", "estate", "area", "salePrice", "rentPrice"])
    assert.equal(propertyGroupFiltersSchema.safeParse({ sort, direction: "asc" }).success, true);
});
