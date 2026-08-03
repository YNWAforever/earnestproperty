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
