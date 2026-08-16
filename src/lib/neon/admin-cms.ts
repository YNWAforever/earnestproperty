/**
 * UNREACHABLE — this module ships in no bundle and is called by nothing.
 *
 * The CMS revision workflow (draft / publish / restore / archive, backed by the
 * cms_content_revisions table) is fully implemented here and in
 * admin-cms.server.ts, but no route or component imports it: `grep -rn
 * "admin-cms" src/routes src/components` returns nothing, and the built server
 * output contains no reference to cms_content_revisions. admin.cms.tsx writes
 * through admin-data instead, with no draft step.
 *
 * It is left in place deliberately rather than deleted, because the two ways to
 * resolve it are opposite product decisions:
 *
 *  - DELETE it (this file, admin-cms.server.ts, admin-cms.types.ts,
 *    cms-revisions.ts, both admin-cms*.contract.test.mjs, and the table). That
 *    drops cms_content_revisions, which may hold production rows.
 *  - WIRE IT UP from admin.cms.tsx. That replaces the current direct-write
 *    behaviour with drafts-before-publish, which staff will notice.
 *
 * What must NOT happen is keeping two write paths once it is connected. The
 * passing contract tests over this file assert its shape, not that anything
 * uses it -- they are why it reads as live code.
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

const cmsServer = () => import("./admin-cms.server");

const fetchAdminCmsHubServer = createServerFn({ method: "GET" })
  .inputValidator((data: { view: CmsHubView; query?: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsHub(data));
export const fetchAdminCmsHub = async (options: { data: { view: CmsHubView; query?: string } }) =>
  fetchAdminCmsHubServer(await withStaffAuthHeaders(options));

const fetchAdminCmsCategoryServer = createServerFn({ method: "GET" })
  .inputValidator((data: { resourceType: CmsResourceType; query?: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsCategory(data));
export const fetchAdminCmsCategory = async (options: {
  data: { resourceType: CmsResourceType; query?: string };
}) => fetchAdminCmsCategoryServer(await withStaffAuthHeaders(options));

const fetchAdminCmsEditorServer = createServerFn({ method: "GET" })
  .inputValidator((data: { resourceType: CmsResourceType; resourceId: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsEditor(data));
export const fetchAdminCmsEditor = async (options: {
  data: { resourceType: CmsResourceType; resourceId: string };
}) => fetchAdminCmsEditorServer(await withStaffAuthHeaders(options));

const saveAdminCmsDraftServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsDraftSaveInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).saveAdminCmsDraft(data, request);
  });
export const saveAdminCmsDraft = async (options: { data: CmsDraftSaveInput }) =>
  saveAdminCmsDraftServer(await withStaffAuthHeaders(options));

const publishAdminCmsRevisionServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsPublishInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).publishAdminCmsRevision(data, request);
  });
export const publishAdminCmsRevision = async (options: { data: CmsPublishInput }) =>
  publishAdminCmsRevisionServer(await withStaffAuthHeaders(options));

const restoreAdminCmsRevisionServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsRestoreInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).restoreAdminCmsRevision(data, request);
  });
export const restoreAdminCmsRevision = async (options: { data: CmsRestoreInput }) =>
  restoreAdminCmsRevisionServer(await withStaffAuthHeaders(options));

const archiveAdminCmsResourceServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsArchiveInput) => data)
  .handler(async ({ data }) => {
    const request = getRequest();
    return (await cmsServer()).archiveAdminCmsResource(data, request);
  });
export const archiveAdminCmsResource = async (options: { data: CmsArchiveInput }) =>
  archiveAdminCmsResourceServer(await withStaffAuthHeaders(options));
