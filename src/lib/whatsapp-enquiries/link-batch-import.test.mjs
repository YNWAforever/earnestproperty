import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  parsePlacementInput,
  parseBatchImport,
  expandBatchDraft,
  resolveImportedRows,
} from "./link-batch-import.ts";

const offer = (n, dealType = "sale") => ({
  propertyId: randomUUID(),
  publicListingNo: "A" + String(n).padStart(6, "0"),
  dealType,
  title: "Fixture",
  price: null,
  agentId: null,
  agentName: null,
});
test("20 sale/rent offers expand across three sources; 1001 rows fail before preview", () => {
  const offers = Array.from({ length: 20 }, (_, i) => offer(i, i % 2 ? "rent" : "sale"));
  const placements = Object.fromEntries(
    offers.flatMap((item) => [
      [
        item.propertyId + ":28hse",
        "https://www.28hse.com/" +
          (item.dealType === "sale" ? "buy" : "rent") +
          "/example/property-123",
      ],
      [item.propertyId + ":youtube", "https://youtu.be/dQw4w9WgXcQ"],
    ]),
  );
  const expanded = expandBatchDraft(offers, ["website", "28hse", "youtube"], placements);
  assert.equal(expanded.offerCount, 20);
  assert.equal(expanded.rowCount, 60);
  assert.equal(expanded.rows.length, 60);
  assert.deepEqual(expanded.errors, []);
  assert.equal(expanded.rows.filter((row) => row.input.dealType === "rent").length, 30);
  assert.equal(expanded.rows.filter((row) => row.input.dealType === "sale").length, 30);
  assert.equal(expanded.rows.filter((row) => row.input.placementSource === "website").length, 20);
  assert.equal(
    expanded.rows.find((row) => row.input.placementSource === "website").placementId,
    "website:primary",
  );
  const tooLarge = expandBatchDraft(
    Array.from({ length: 334 }, (_, i) => offer(i)),
    ["website", "28hse", "youtube"],
    {},
  );
  assert.equal(tooLarge.rowCount, 1002);
  assert.equal(tooLarge.rows.length, 0);
  assert.equal(tooLarge.errors[0].errorCode, "BATCH_LIMIT");
});
test("placement parser accepts documented source shapes and rejects mismatches", () => {
  assert.deepEqual(parsePlacementInput("28hse", "https://www.28hse.com/buy/example/property-123"), {
    placementId: "123",
  });
  assert.deepEqual(parsePlacementInput("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
    placementId: "dQw4w9WgXcQ",
  });
  assert.deepEqual(parsePlacementInput("youtube", "https://youtu.be/dQw4w9WgXcQ"), {
    placementId: "dQw4w9WgXcQ",
  });
  assert.deepEqual(parsePlacementInput("youtube", "https://www.youtube.com/shorts/dQw4w9WgXcQ"), {
    placementId: "dQw4w9WgXcQ",
  });
  assert.deepEqual(parsePlacementInput("youtube", "dQw4w9WgXcQ"), {
    placementId: "dQw4w9WgXcQ",
  });
  assert.equal(parsePlacementInput("youtube", "short-id").errorCode, "PLACEMENT_ID_INVALID");
  assert.equal(
    parsePlacementInput("28hse", "https://youtu.be/dQw4w9WgXcQ").errorCode,
    "SOURCE_URL_MISMATCH",
  );
  assert.equal(
    parsePlacementInput("youtube", "https://example.com/watch?v=dQw4w9WgXcQ").errorCode,
    "SOURCE_URL_MISMATCH",
  );
  assert.equal(
    parsePlacementInput("28hse", "https://www.28hse.com/buy/unknown").errorCode,
    "UNRECOGNIZED_URL",
  );
});
test("CSV handles BOM, full-width whitespace, quoted comma, duplicate rows, and deal URL mismatch", () => {
  const header = "public_listing_no,deal_type,source,placement_url_or_id,staff_reference";
  const one =
    '　A000001　,sale,28hse,"https://www.28hse.com/buy/example/property-123?campaign=a,b",28hse/account540|001-A';
  const result = parseBatchImport("\uFEFF" + header + "\n" + one + "\n" + one, "csv");
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].publicListingNo, "A000001");
  assert.equal(result.rows[0].staffReference, "28hse/account540|001-A");
  assert.ok(result.errors.some((error) => error.errorCode === "DUPLICATE_ROW" && error.row === 3));
  const wrong = parseBatchImport(
    header + "\nA000001,rent,28hse,https://www.28hse.com/buy/example/property-123,",
    "csv",
  );
  assert.equal(wrong.errors[0].errorCode, "DEAL_TYPE_MISMATCH");
  const tab = parseBatchImport(
    "public_listing_no\tdeal_type\tsource\tplacement_url_or_id\tstaff_reference\nA000001\trent\twebsite\t\t",
    "tsv",
  );
  assert.equal(tab.rows[0].source, "website");
  const overLimit = parseBatchImport(
    header +
      "\n" +
      Array.from(
        { length: 1001 },
        (_, index) => "A" + String(index).padStart(6, "0") + ",sale,website,,",
      ).join("\n"),
    "csv",
  );
  assert.equal(overLimit.rows.length, 1001);
  assert.ok(overLimit.errors.some((error) => error.errorCode === "BATCH_LIMIT"));
});
test("import resolves exact offers and source-scoped staff references without guessing names", () => {
  const selected = [offer(1, "sale")];
  const importRows = [
    {
      publicListingNo: selected[0].publicListingNo,
      dealType: "sale",
      source: "28hse",
      placementInput: "https://www.28hse.com/buy/example/property-123",
      staffReference: "28hse/account540|001-A",
    },
  ];
  const mapping = {
    id: randomUUID(),
    namespace: "28hse/account540",
    externalReference: "001-A",
    staffId: randomUUID(),
    valid: true,
  };
  const good = resolveImportedRows(importRows, selected, [mapping]);
  assert.equal(good.rows.length, 1);
  assert.equal(good.rows[0].input.referenceMappingId, mapping.id);
  assert.equal(good.rows[0].input.requestedStaffId, mapping.staffId);
  assert.deepEqual(good.errors, []);
  const wrong = resolveImportedRows(importRows, selected, [
    { ...mapping, namespace: "youtube/account540" },
  ]);
  assert.equal(wrong.rows.length, 0);
  assert.equal(wrong.errors[0].errorCode, "STAFF_REFERENCE_UNRESOLVED");
});
