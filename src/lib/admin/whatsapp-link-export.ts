import { z } from "zod";
import { linkPageInput } from "../neon/whatsapp-link-management.types.ts";
export const exportInput = z
  .object({
    scope: z.enum(["selected", "all"]),
    selectedIds: z.array(z.string().uuid()).max(1000).optional(),
    filter: linkPageInput.omit({ cursor: true, pageSize: true }),
  })
  .strict();
export const linkCsvColumns = [
  "公開樓編",
  "租售",
  "刊登來源",
  "入口",
  "投放識別碼",
  "指定同事",
  "連結",
  "版本",
  "狀態",
  "開啟次數",
  "歸因查詢次數",
  "建立時間",
  "投放核實時間",
] as const;

/** Text cells are kept literal in spreadsheet apps; numeric counters remain numeric. */
export function safeCsvCell(value: unknown, numeric = false): string {
  const raw = value == null ? "" : String(value);
  const first = raw.charCodeAt(0);
  const startsWithControl = Number.isFinite(first) && (first <= 31 || first === 127);
  const escaped = !numeric && (/^[\s]*[=+\-@]/u.test(raw) || startsWithControl) ? `'${raw}` : raw;
  return `"${escaped.replaceAll('"', '""')}"`;
}
export type LinkCsvRow = {
  publicListingNo: string | null;
  dealType: string | null;
  placementSource: string;
  entryPointType: string;
  placementId: string | null;
  requestedStaffName: string | null;
  code: string;
  version: number;
  enabled: boolean;
  opens: number | null;
  enquiries: number | null;
  createdAt: string;
  placementVerifiedAt: string | null;
};
export function linkCsvLine(row: LinkCsvRow) {
  const cells: unknown[] = [
    row.publicListingNo,
    row.dealType,
    row.placementSource,
    row.entryPointType,
    row.placementId,
    row.requestedStaffName,
    `/w/${row.code}`,
    row.version,
    row.enabled ? "可用" : "停用",
    row.opens ?? "unknown",
    row.enquiries ?? "unknown",
    row.createdAt,
    row.placementVerifiedAt,
  ];
  return cells
    .map((value, index) =>
      safeCsvCell(value, index === 7 || ((index === 9 || index === 10) && value !== "unknown")),
    )
    .join(",");
}
export function csvPage(rows: LinkCsvRow[], first: boolean) {
  return `${first ? `\ufeff${linkCsvColumns.map((column) => safeCsvCell(column)).join(",")}\r\n` : ""}${rows.map(linkCsvLine).join("\r\n")}${rows.length ? "\r\n" : ""}`;
}
