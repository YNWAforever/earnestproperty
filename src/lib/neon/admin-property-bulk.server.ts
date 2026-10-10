import "@tanstack/react-start/server-only";
import type { StaffAccess } from "./auth.server";
import type { ManagedPropertyDetail, PropertyManagementInput } from "./admin-properties.types";
import { getAdminManagedProperty } from "./admin-properties.server";
import { saveAdminPropertyManagement } from "./admin-property-management.server";
import {
  bulkPropertyManagementSchema,
  type BulkPropertyManagementInput,
  type BulkPropertyResult,
} from "./admin-property-bulk.types";

type BulkPropertyDependencies = {
  read: (propertyNo: string, actor: StaffAccess) => Promise<ManagedPropertyDetail | null>;
  save: (input: PropertyManagementInput, actor: StaffAccess) => Promise<{ ok: true }>;
};
const defaultDependencies: BulkPropertyDependencies = {
  read: getAdminManagedProperty,
  save: saveAdminPropertyManagement,
};

function safeBulkError(error: unknown): string {
  if (error instanceof Response) {
    if (error.status === 409) return "物業資料已被更新。請重新載入並核對後再提交。";
    if (error.status === 401 || error.status === 403) return "你沒有權限修改此物業或放盤。";
    if (error.status === 404) return "找不到所選物業或放盤。請重新載入。";
    if (error.status === 400) return "物業資料不符合要求。請重新載入並核對。";
    if (error.status === 503) return "樓盤管理功能暫時未能使用。";
  }
  return "未能更新此物業。請重新載入核對結果後再操作。";
}

/** Preflight each existing offer; the existing atomic writer also checks version and permissions under lock. */
export async function runAdminPropertyBulk(
  rawInput: BulkPropertyManagementInput,
  actor: StaffAccess,
  dependencies: BulkPropertyDependencies = defaultDependencies,
): Promise<BulkPropertyResult[]> {
  const input = bulkPropertyManagementSchema.parse(rawInput);
  const results: BulkPropertyResult[] = [];
  for (const [index, item] of input.items.entries()) {
    let writeStarted = false;
    try {
      const property = await dependencies.read(item.propertyNo, actor);
      if (!property || property.propertyNo !== item.propertyNo)
        throw new Response(null, { status: 404 });
      if (property.version !== item.expectedVersion) throw new Response(null, { status: 409 });
      if (!property.managementAvailable) throw new Response(null, { status: 503 });
      const offers =
        input.scope === "all"
          ? [property.offerings.sale, property.offerings.rent].filter((offer) => offer !== null)
          : [property.offerings[input.scope]];
      if (!offers.length || offers.some((offer) => !offer))
        throw new Response(null, { status: 404 });
      if (
        (input.scope === "all" && !property.editableShared) ||
        offers.some((offer) => !offer?.editable)
      )
        throw new Response(null, { status: 403 });
      if (input.action.type === "status" && input.action.status === "active") {
        const offer = offers[0]!;
        const amount = input.scope === "sale" ? offer.price : offer.rent;
        if (!offer.title.trim() || amount === null || !Number.isFinite(amount) || amount <= 0) {
          results.push({
            propertyNo: item.propertyNo,
            ok: false,
            error: "公開放盤前必須填寫標題及有效售價或租金。",
          });
          continue;
        }
      }
      writeStarted = true;
      await dependencies.save(
        {
          ...item,
          scope: input.scope,
          payload:
            input.action.type === "status"
              ? { status: input.action.status }
              : { agentId: input.action.agentId },
        },
        actor,
      );
      results.push({ propertyNo: item.propertyNo, ok: true });
    } catch (error) {
      const definiteWriteRejection =
        error instanceof Response && [400, 401, 403, 404, 409, 503].includes(error.status);
      if (writeStarted && !definiteWriteRejection) {
        results.push({
          propertyNo: item.propertyNo,
          ok: false,
          uncertain: true,
          error: "未能確認此物業是否已更新。請重新載入並核對結果後再操作。",
        });
        for (const pending of input.items.slice(index + 1)) {
          results.push({
            propertyNo: pending.propertyNo,
            ok: false,
            error: "尚未提交：上一項結果未能確認，請重新載入並核對後再操作。",
          });
        }
        break;
      }
      results.push({ propertyNo: item.propertyNo, ok: false, error: safeBulkError(error) });
    }
  }
  return results;
}
