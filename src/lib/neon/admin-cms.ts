import { createServerFn } from "@tanstack/react-start";

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
export const fetchAdminCmsHub = (options: { data: { view: CmsHubView; query?: string } }) =>
  fetchAdminCmsHubServer(withStaffAuthHeaders(options));

const fetchAdminCmsCategoryServer = createServerFn({ method: "GET" })
  .inputValidator((data: { resourceType: CmsResourceType; query?: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsCategory(data));
export const fetchAdminCmsCategory = (options: { data: { resourceType: CmsResourceType; query?: string } }) =>
  fetchAdminCmsCategoryServer(withStaffAuthHeaders(options));

const fetchAdminCmsEditorServer = createServerFn({ method: "GET" })
  .inputValidator((data: { resourceType: CmsResourceType; resourceId: string }) => data)
  .handler(async ({ data }) => (await cmsServer()).fetchAdminCmsEditor(data));
export const fetchAdminCmsEditor = (options: { data: { resourceType: CmsResourceType; resourceId: string } }) =>
  fetchAdminCmsEditorServer(withStaffAuthHeaders(options));

const saveAdminCmsDraftServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsDraftSaveInput) => data)
  .handler(async ({ data, request }) => (await cmsServer()).saveAdminCmsDraft(data, request));
export const saveAdminCmsDraft = (options: { data: CmsDraftSaveInput }) =>
  saveAdminCmsDraftServer(withStaffAuthHeaders(options));

const publishAdminCmsRevisionServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsPublishInput) => data)
  .handler(async ({ data, request }) => (await cmsServer()).publishAdminCmsRevision(data, request));
export const publishAdminCmsRevision = (options: { data: CmsPublishInput }) =>
  publishAdminCmsRevisionServer(withStaffAuthHeaders(options));

const restoreAdminCmsRevisionServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsRestoreInput) => data)
  .handler(async ({ data, request }) => (await cmsServer()).restoreAdminCmsRevision(data, request));
export const restoreAdminCmsRevision = (options: { data: CmsRestoreInput }) =>
  restoreAdminCmsRevisionServer(withStaffAuthHeaders(options));

const archiveAdminCmsResourceServer = createServerFn({ method: "POST" })
  .inputValidator((data: CmsArchiveInput) => data)
  .handler(async ({ data, request }) => (await cmsServer()).archiveAdminCmsResource(data, request));
export const archiveAdminCmsResource = (options: { data: CmsArchiveInput }) =>
  archiveAdminCmsResourceServer(withStaffAuthHeaders(options));
