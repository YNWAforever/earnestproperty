/**
 * CMS revision engine — draft / publish / restore / archive, backed by the
 * cms_content_revisions table.
 *
 * As of P6b (docs/superpowers/plans/2026-08-31-frontend-revamp-p6b-cms-revision-wiring.md),
 * src/routes/admin.cms.tsx calls this module for estates and articles.
 * Video, FAQ, and media still write through admin-data.ts directly -- see
 * that plan's "scope boundary" note for why (a background YouTube-sync job
 * races with this engine for video; new media uploads create no revision
 * row; FAQ bulk-import has no batch-shaped equivalent here). Do not remove
 * admin-data.ts's saveAdminCmsVideo/saveAdminFaq/updateAdminMediaAsset/
 * checkAdminFaqConflicts/deleteAdminFaq -- they are still the only write
 * path for those three resource types.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { withStaffAuthHeaders } from "@/auth";
import type {
  CmsArchiveInput,
  CmsDraftSaveInput,
  CmsHubView,
  CmsPublishInput,
  CmsRestoreInput,
} from "./admin-cms.types";
import type { CmsResourceType } from "./cms-revisions";
import { unwrapServerFnResponse } from "./server-fn-response.ts";

const cmsServer = () => import("./admin-cms.server");

const fetchAdminCmsHubServer = createServerFn({ method: "GET" })
  .inputValidator((data: { view: CmsHubView; query?: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsHub(data));
export const fetchAdminCmsHub = async (options: { data: { view: CmsHubView; query?: string } }) =>
  unwrapServerFnResponse(fetchAdminCmsHubServer(await withStaffAuthHeaders(options)));

const fetchAdminCmsCategoryServer = createServerFn({ method: "GET" })
  .inputValidator((data: { resourceType: CmsResourceType; query?: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsCategory(data));
export const fetchAdminCmsCategory = async (options: {
  data: { resourceType: CmsResourceType; query?: string };
}) => unwrapServerFnResponse(fetchAdminCmsCategoryServer(await withStaffAuthHeaders(options)));

const fetchAdminCmsEditorServer = createServerFn({ method: "GET" })
  .inputValidator((data: { resourceType: CmsResourceType; resourceId: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsEditor(data));
export const fetchAdminCmsEditor = async (options: {
  data: { resourceType: CmsResourceType; resourceId: string };
}) => unwrapServerFnResponse(fetchAdminCmsEditorServer(await withStaffAuthHeaders(options)));

const saveAdminCmsDraftServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsDraftSaveInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).saveAdminCmsDraft(data, request);
  });
export const saveAdminCmsDraft = async (options: { data: CmsDraftSaveInput }) =>
  unwrapServerFnResponse(saveAdminCmsDraftServer(await withStaffAuthHeaders(options)));

const publishAdminCmsRevisionServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsPublishInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).publishAdminCmsRevision(data, request);
  });
export const publishAdminCmsRevision = async (options: { data: CmsPublishInput }) =>
  unwrapServerFnResponse(publishAdminCmsRevisionServer(await withStaffAuthHeaders(options)));

const restoreAdminCmsRevisionServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsRestoreInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).restoreAdminCmsRevision(data, request);
  });
export const restoreAdminCmsRevision = async (options: { data: CmsRestoreInput }) =>
  unwrapServerFnResponse(restoreAdminCmsRevisionServer(await withStaffAuthHeaders(options)));

const archiveAdminCmsResourceServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsArchiveInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).archiveAdminCmsResource(data, request);
  });
export const archiveAdminCmsResource = async (options: { data: CmsArchiveInput }) =>
  unwrapServerFnResponse(archiveAdminCmsResourceServer(await withStaffAuthHeaders(options)));
