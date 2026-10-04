import type {
  BulkPropertyManagementInput,
  BulkPropertyResult,
} from "@/lib/neon/admin-property-bulk.types";
export type BulkClientResult = BulkPropertyResult & { uncertain?: boolean };
export async function runPropertyBulkChunks(
  input: BulkPropertyManagementInput,
  apply: (input: BulkPropertyManagementInput) => Promise<BulkPropertyResult[]>,
  progress?: (results: BulkClientResult[]) => void,
  canContinue?: () => boolean,
): Promise<BulkClientResult[]> {
  const results: BulkClientResult[] = [];
  for (let i = 0; i < input.items.length; i += 5) {
    if (canContinue && !canContinue()) {
      results.push(
        ...input.items.slice(i).map((item) => ({
          propertyNo: item.propertyNo,
          ok: false,
          error: "尚未提交：職員身份或權限已變更，請重新核對。",
        })),
      );
      progress?.([...results]);
      return results;
    }
    const items = input.items.slice(i, i + 5);
    try {
      const response = await apply({ ...input, items });
      if (
        !Array.isArray(response) ||
        response.length !== items.length ||
        new Set(response.map((r) => r.propertyNo)).size !== items.length ||
        response.some(
          (r) =>
            typeof r.ok !== "boolean" || !items.some((item) => item.propertyNo === r.propertyNo),
        )
      )
        throw Error("Invalid batch response");
      results.push(...response);
      if (response.some((r) => r.uncertain)) {
        results.push(
          ...input.items.slice(i + 5).map((item) => ({
            propertyNo: item.propertyNo,
            ok: false,
            error: "尚未提交：前一批結果未能確認。",
          })),
        );
        progress?.([...results]);
        return results;
      }
    } catch {
      results.push(
        ...items.map((item) => ({
          propertyNo: item.propertyNo,
          ok: false,
          uncertain: true,
          error: "未能確認儲存結果。請重新載入並核對，勿直接重試。",
        })),
      );
      results.push(
        ...input.items.slice(i + 5).map((item) => ({
          propertyNo: item.propertyNo,
          ok: false,
          error: "尚未提交：前一批結果未能確認。",
        })),
      );
      progress?.([...results]);
      return results;
    }
    progress?.([...results]);
  }
  return results;
}
