import { expect, test } from "bun:test";
import { csvPage, safeCsvCell } from "./whatsapp-link-export";

test("CSV quotes text, preserves UTF-8 headings and neutralizes spreadsheet formulas", () => {
  for (const attack of [
    '=HYPERLINK("https://evil")',
    "+SUM(1,1)",
    "-cmd",
    "@mention",
    "\t=1",
    "\n=1",
  ])
    expect(safeCsvCell(attack)).toStartWith("\"'");
  expect(safeCsvCell('a,b"c\nd')).toBe('"a,b""c\nd"');
  const csv = csvPage(
    [
      {
        publicListingNo: "A074714",
        dealType: "sale",
        placementSource: "website",
        entryPointType: "sales",
        placementId: "website:primary",
        requestedStaffName: "=unsafe",
        code: "abc",
        version: 2,
        enabled: true,
        opens: 0,
        enquiries: 1,
        createdAt: "2026-09-27T00:00:00Z",
        placementVerifiedAt: null,
      },
    ],
    true,
  );
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"\'=unsafe"');
  expect(csv).toContain('"0","1"');
  expect(csv).not.toContain("85291234567");
});
