import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { withStaffAuthHeaders } from "@/auth";
import { requireStaffPermission } from "../control-plane/permissions";
import type {
  AdminTransactionImportResult,
  AdminTransactionInput,
  AdminTransactionListFilters,
  AdminTransactionListResult,
  AdminTransactionRow,
} from "./admin-transactions.types";
import { unwrapServerFnResponse } from "./server-fn-response.ts";

const transactionsServer = () => import("./admin-transactions.server");

async function requireTransactionStaff(request: Request) {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(request, ["admin", "manager", "agent"]);
}

const listAdminTransactionsServer = createServerFn({ method: "GET" })
  .inputValidator((data: AdminTransactionListFilters) => data)
  .handler(async ({ data }) => {
    await requireTransactionStaff(getRequest());
    return (await transactionsServer()).listAdminTransactions(data);
  });
export const listAdminTransactions = async (options: {
  data: AdminTransactionListFilters;
}): Promise<AdminTransactionListResult> =>
  unwrapServerFnResponse(listAdminTransactionsServer(await withStaffAuthHeaders(options)));

const getAdminTransactionServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireTransactionStaff(getRequest());
    return (await transactionsServer()).getAdminTransaction(data.id);
  });
export const getAdminTransaction = async (options: {
  data: { id: string };
}): Promise<AdminTransactionRow | null> =>
  unwrapServerFnResponse(getAdminTransactionServer(await withStaffAuthHeaders(options)));

const saveAdminTransactionServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminTransactionInput) => data)
  .handler(async ({ data }) => {
    const actor = await requireTransactionStaff(getRequest());
    return (await transactionsServer()).saveAdminTransaction(data, actor);
  });
export const saveAdminTransaction = async (options: { data: AdminTransactionInput }) =>
  unwrapServerFnResponse(saveAdminTransactionServer(await withStaffAuthHeaders(options)));

const verifyAdminTransactionServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const actor = await requireStaffPermission(getRequest(), "transaction.verify");
    return (await transactionsServer()).verifyAdminTransaction(data.id, actor);
  });
export const verifyAdminTransaction = async (options: { data: { id: string } }) =>
  unwrapServerFnResponse(verifyAdminTransactionServer(await withStaffAuthHeaders(options)));

const publishAdminTransactionServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const actor = await requireStaffPermission(getRequest(), "transaction.publish");
    return (await transactionsServer()).publishAdminTransaction(data.id, actor);
  });
export const publishAdminTransaction = async (options: { data: { id: string } }) =>
  unwrapServerFnResponse(publishAdminTransactionServer(await withStaffAuthHeaders(options)));

const unpublishAdminTransactionServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const actor = await requireStaffPermission(getRequest(), "transaction.publish");
    return (await transactionsServer()).unpublishAdminTransaction(data.id, actor);
  });
export const unpublishAdminTransaction = async (options: { data: { id: string } }) =>
  unwrapServerFnResponse(unpublishAdminTransactionServer(await withStaffAuthHeaders(options)));

const importAdminTransactionsDraftServer = createServerFn({ method: "POST" })
  .inputValidator((data: { rows: AdminTransactionInput[] }) => data)
  .handler(async ({ data }) => {
    const actor = await requireTransactionStaff(getRequest());
    return (await transactionsServer()).importAdminTransactionsDraft(data.rows, actor);
  });
export const importAdminTransactionsDraft = async (options: {
  data: { rows: AdminTransactionInput[] };
}): Promise<AdminTransactionImportResult> =>
  unwrapServerFnResponse(importAdminTransactionsDraftServer(await withStaffAuthHeaders(options)));
