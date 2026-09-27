import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { withStaffAuthHeaders } from "@/auth";

const listServer = createServerFn({ method: "GET" })
  .inputValidator(
    z
      .object({
        query: z.string().max(80),
        folderKey: z.string().optional(),
        cursor: z.string().optional(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./inbox-directory.server")).listInboxCandidates(data, actor);
  });
export async function getInboxCandidates(data: Parameters<typeof listServer>[0]["data"]) {
  return listServer(await withStaffAuthHeaders({ data }));
}
const foldersServer = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("./auth.server");
  const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("./inbox-directory.server")).listInboxFolders(actor);
});
export async function getInboxFolders() {
  return foldersServer(await withStaffAuthHeaders({}));
}
const verifyServer = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        staffId: z.string().uuid(),
        userId: z.string().min(1).max(120),
        folderKey: z.string().min(1).max(64),
        expectedVersion: z.number().int().positive().nullable(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./inbox-directory.server")).verifyInboxSelection(data, actor);
  });
export async function verifyInboxCandidate(data: Parameters<typeof verifyServer>[0]["data"]) {
  return verifyServer(await withStaffAuthHeaders({ data }));
}
const saveFolderServer = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        folderKey: z.string().min(1).max(64),
        displayName: z.string().min(1).max(120),
        providerFolderId: z.string().min(1).max(120),
        expectedVersion: z.number().int().positive().nullable(),
      })
      .strict(),
  )
  .handler(async ({ data }) => {
    const { requireStaffAccess } = await import("./auth.server");
    const actor = await requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./inbox-directory.server")).saveInboxFolder(data, actor);
  });
export async function saveNamedInboxFolder(data: Parameters<typeof saveFolderServer>[0]["data"]) {
  return saveFolderServer(await withStaffAuthHeaders({ data }));
}
