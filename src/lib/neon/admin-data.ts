import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { withStaffAuthHeaders } from "@/auth";
import { ServerFnResponseError, unwrapServerFnResponse } from "./server-fn-response.ts";
import { deriveAgentProfileEditorContext } from "./staff-security-policy";
import { WEBSITE_LISTING_NO_PATTERN } from "./website-inquiry.js";
import type {
  AdminAgentEditorContext,
  AdminAgentProfileInput,
  AdminAgentProfileMutationInput,
  AdminArticleInput,
  AdminAudienceInput,
  AdminCampaignInput,
  AdminConversationAiAssist,
  AdminConversationUpdateInput,
  AdminCrmSegmentPreview,
  AdminCmsVideoInput,
  AdminEstateInput,
  AdminFaqInput,
  AdminLeadActivityInput,
  AdminLeadUpdateInput,
  AdminListingFiltersInput,
  AdminPropertyInput,
  StaffRole,
} from "./admin-data.types";

async function requireStaff(roles: StaffRole[] = ["admin"]) {
  const { requireStaffAccess } = await import("./auth.server");
  return requireStaffAccess(getRequest(), roles);
}

const fetchAdminAgentEditorContextServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  return deriveAgentProfileEditorContext(staff.roles);
});

export async function fetchAdminAgentEditorContext(): Promise<AdminAgentEditorContext | null> {
  try {
    return await callStaffServerFn(async () =>
      fetchAdminAgentEditorContextServer(await withStaffAuthHeaders({})),
    );
  } catch (error) {
    if (isStaffAuthorizationError(error)) return null;
    throw error;
  }
}

const fetchAdminAgentProfilesServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAgentProfiles();
});

export async function fetchAdminAgentProfiles() {
  return callStaffServerFn(async () =>
    fetchAdminAgentProfilesServer(await withStaffAuthHeaders({})),
  );
}

const fetchAdminBranchesServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminBranches();
});

export async function fetchAdminBranches() {
  return callStaffServerFn(async () => fetchAdminBranchesServer(await withStaffAuthHeaders({})));
}

const fetchAdminAgentProfileServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminAgentProfile(data.id);
  });

export async function fetchAdminAgentProfile(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminAgentProfileServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminAgentProfileServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminAgentProfileMutationInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminAgentProfile(data, staff);
  });

export async function saveAdminAgentProfile(options: { data: AdminAgentProfileMutationInput }) {
  return callStaffServerFn(async () =>
    saveAdminAgentProfileServer(await withStaffAuthHeaders(options)),
  );
}

/**
 * zh-HK messages for the terse `Response` bodies the staff-access server
 * functions throw -- the `reason` union from decideStaffRoleChange /
 * decideStaffDeactivation (staff-security-policy.ts), plus the handful of
 * fixed strings fetchStaffAccessSummary / updateStaffRoles / setStaffActive
 * and requireStaffAccess throw directly. Voice matches the banners already
 * in AgentProfileForm.tsx (isProtected / isSelf / isLastAdmin) rather than
 * inventing a second tone for the same situations.
 *
 * Anything NOT in this map is a body text this file's author did not
 * anticipate -- unwrapStaffAccessResponse surfaces it verbatim rather than
 * replacing it with a generic message, so an unrecognised code is visible
 * and reportable instead of silently disappearing.
 */
const STAFF_ACCESS_ERROR_MESSAGES: Record<string, string> = {
  "not-admin": "只有管理員可以進行此操作。",
  "self-admin-removal": "你不能移除自己的管理員權限，請由另一位管理員代為處理。",
  self: "你不能停用自己的帳戶，請由另一位管理員代為處理。",
  "last-admin":
    "此帳戶是目前系統內唯一的管理員，操作後將無人可管理系統，請先將管理員權限授予其他同事。",
  "protected-account":
    "此帳戶已在 ADMIN_BOOTSTRAP_EMAILS 名單內，不可移除管理員權限或停用，以免無人可登入系統。",
  "successor-required": "此同事仍有已指派的工作，請先選擇接手人。",
  "successor-is-target": "接手人不能是同一位同事，請選擇其他人。",
  Unauthorized: "登入已失效，請重新登入後再試。",
  Forbidden: "你沒有權限進行此操作。",
};

/**
 * TanStack Start does NOT surface a thrown `Response` from a server function
 * handler as a rejected promise on the client. Traced in
 * @tanstack/start-server-core's server-functions-handler.js: a thrown Response
 * lands in `res.error`, and `const unwrapped = res.result || res.error` cannot
 * tell that apart from one the handler simply returned -- either way it sets
 * the `x-tss-raw-response` header and returns it. @tanstack/start-client-core's
 * serverFnFetcher.js's getResponse() then returns that response the moment it
 * sees that header, before it ever reaches the `.ok` / status check a few
 * lines later. So `await updateStaffRolesServer(...)` RESOLVES with the
 * Response object whenever the handler rejected the mutation -- a last-admin
 * guard, the 409 Serializable conflict, a protected-account block -- and a
 * caller's `try { await x(); toast.success(...) } catch {...}` reports success
 * on a change the database never applied. For setStaffActive specifically,
 * that means the admin believes a departing colleague is locked out and their
 * work reassigned, while both are still live.
 *
 * This is why fetchStaffAccessSummary / updateStaffRoles / setStaffActive each
 * pipe their result through this before returning: it is the one place a
 * resolved raw Response gets converted into a genuinely thrown Error, so the
 * try/catch every caller already writes does the right thing with no caller
 * changes needed. Exported so it can be unit-tested directly with a stubbed
 * Response, rather than requiring a live server round-trip: createServerFn's
 * client/server split (and therefore this exact resolve-not-reject behaviour)
 * only exists once Vite's build-time macro transform has run, so calling the
 * *Server stubs directly in a plain test process does not reproduce it.
 *
 * fetchStaffAccessSummary / updateStaffRoles / setStaffActive each call this
 * WRAPPED AROUND callStaffServerFn, which -- since it now also unwraps a
 * resolved Response via unwrapServerFnResponse -- may hand this a promise
 * that REJECTS with a ServerFnResponseError rather than one that resolves
 * with a raw Response. Both shapes carry the same body text and status, so
 * both are translated through the same table below.
 */
function translateStaffAccessMessage(text: string, status: number): string {
  const trimmed = text.trim();
  if (STAFF_ACCESS_ERROR_MESSAGES[trimmed]) return STAFF_ACCESS_ERROR_MESSAGES[trimmed];
  if (trimmed && trimmed !== `HTTP ${status}`) return trimmed;
  return `操作失敗（HTTP ${status}）`;
}

export async function unwrapStaffAccessResponse<T>(promise: Promise<T>): Promise<T> {
  try {
    const result = await promise;
    if (result instanceof Response) {
      const text = (await result.text().catch(() => "")).trim();
      throw new Error(translateStaffAccessMessage(text, result.status));
    }
    return result;
  } catch (error) {
    if (error instanceof ServerFnResponseError) {
      throw new Error(translateStaffAccessMessage(error.message, error.status));
    }
    throw error;
  }
}

const fetchStaffAccessSummaryServer = createServerFn({ method: "GET" })
  .inputValidator((data: { staffId: string }) =>
    z.object({ staffId: z.string().trim().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchStaffAccessSummary(data, staff);
  });

export async function fetchStaffAccessSummary(options: { data: { staffId: string } }) {
  return unwrapStaffAccessResponse(
    callStaffServerFn(async () =>
      fetchStaffAccessSummaryServer(await withStaffAuthHeaders(options)),
    ),
  );
}

const updateStaffRolesServer = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; roles: string[] }) =>
    z
      .object({
        staffId: z.string().trim().uuid(),
        roles: z.array(z.enum(["admin", "manager", "agent"])).max(3),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateStaffRoles(data, staff);
  });

export async function updateStaffRoles(options: {
  data: { staffId: string; roles: ("admin" | "manager" | "agent")[] };
}) {
  return unwrapStaffAccessResponse(
    callStaffServerFn(async () => updateStaffRolesServer(await withStaffAuthHeaders(options))),
  );
}

const setStaffActiveServer = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; active: boolean; reassignToStaffId?: string | null }) =>
    z
      .object({
        staffId: z.string().trim().uuid(),
        active: z.boolean(),
        reassignToStaffId: z.string().trim().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin"]);
    const adminData = await import("./admin-data.server");
    return adminData.setStaffActive(data, staff);
  });

export async function setStaffActive(options: {
  data: { staffId: string; active: boolean; reassignToStaffId?: string | null };
}) {
  return unwrapStaffAccessResponse(
    callStaffServerFn(async () => setStaffActiveServer(await withStaffAuthHeaders(options))),
  );
}

const STALE_SERVER_FN_RELOAD_KEY = "earnest-admin-stale-server-fn-reloaded";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isStaffAuthorizationError(error: unknown) {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

function isStaleServerFunctionError(error: unknown) {
  // A ServerFnResponseError means the request reached a real handler, which
  // explicitly threw a Response -- by construction that can never be the "this
  // function ID no longer exists on the server" condition this heuristic exists
  // to detect. Excluding it up front keeps a legitimate in-app 404 (e.g. "Staff
  // member not found.") from forcing a page reload once callStaffServerFn starts
  // surfacing those Responses as thrown errors instead of silently resolving.
  if (error instanceof ServerFnResponseError) return false;
  const message = errorMessage(error);
  const status = errorStatus(error);
  if (status === 404 || status === 410) return true;
  if (status === 401 || status === 403) return false;
  return message === "HTTPError" && (status === null || status >= 500);
}

function storageFlagIsSet() {
  try {
    return window.sessionStorage.getItem(STALE_SERVER_FN_RELOAD_KEY) === "1";
  } catch {
    return true;
  }
}

function setStorageFlag() {
  try {
    window.sessionStorage.setItem(STALE_SERVER_FN_RELOAD_KEY, "1");
  } catch {
    return;
  }
}

function clearStorageFlag() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STALE_SERVER_FN_RELOAD_KEY);
  } catch {
    return;
  }
}

function reloadOnStaleServerFunction(error: unknown) {
  if (typeof window === "undefined" || !isStaleServerFunctionError(error)) return;
  if (storageFlagIsSet()) return;
  setStorageFlag();
  window.location.reload();
}

async function callStaffServerFn<T>(call: () => Promise<T>) {
  try {
    // TanStack Start RESOLVES rather than rejects when a server function
    // handler throws a Response (see server-fn-response.ts for the traced
    // mechanism). Without this unwrap, every 401/403/404/409 thrown by
    // requireStaff or the admin-data.server.ts handlers arrives here as a
    // successfully "resolved" Response object -- not caught below, not
    // detected by isStaffAuthorizationError/isStaleServerFunctionError, and
    // handed to callers as if it were the real result.
    const result = await unwrapServerFnResponse(call());
    clearStorageFlag();
    return result;
  } catch (error) {
    reloadOnStaleServerFunction(error);
    throw error;
  }
}

const fetchAdminOverviewServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.getAdminOverview();
});

export async function fetchAdminOverview() {
  return callStaffServerFn(async () => fetchAdminOverviewServer(await withStaffAuthHeaders()));
}

const fetchAdminListingsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminListings({}, staff);
});

export async function fetchAdminListings() {
  return callStaffServerFn(async () => fetchAdminListingsServer(await withStaffAuthHeaders()));
}

const fetchAdminEstateOptionsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminEstateOptions();
});

export async function fetchAdminEstateOptions() {
  return callStaffServerFn(async () => fetchAdminEstateOptionsServer(await withStaffAuthHeaders()));
}

const fetchAdminPropertyServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.getAdminProperty(data.id, staff);
  });

export async function fetchAdminProperty(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminPropertyServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminPropertyServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminPropertyInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminProperty(data, staff);
  });

export async function saveAdminProperty(options: { data: AdminPropertyInput }) {
  return callStaffServerFn(async () =>
    saveAdminPropertyServer(await withStaffAuthHeaders(options)),
  );
}

const deleteAdminPropertyServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminProperty(data.id, staff);
  });

export async function deleteAdminProperty(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    deleteAdminPropertyServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminCmsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCms();
});

export async function fetchAdminCms() {
  return callStaffServerFn(async () => fetchAdminCmsServer(await withStaffAuthHeaders()));
}

const fetchAdminCmsVideosServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminCmsVideos();
});

export async function fetchAdminCmsVideos() {
  return callStaffServerFn(async () => fetchAdminCmsVideosServer(await withStaffAuthHeaders()));
}

const saveAdminCmsVideoServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminCmsVideoInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminCmsVideo(data, staff);
  });

export async function saveAdminCmsVideo(options: { data: AdminCmsVideoInput }) {
  return callStaffServerFn(async () =>
    saveAdminCmsVideoServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminAiKnowledgeStatusServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAiKnowledgeStatus(staff);
});

export const fetchAdminAiKnowledgeStatus = async function fetchAdminAiKnowledgeStatus() {
  return callStaffServerFn(async () =>
    fetchAdminAiKnowledgeStatusServer(await withStaffAuthHeaders()),
  );
};

const rebuildAdminAiKnowledgeServer = createServerFn({ method: "POST" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.rebuildAdminAiKnowledge(staff);
});

export const rebuildAdminAiKnowledge = async function rebuildAdminAiKnowledge() {
  return callStaffServerFn(async () => rebuildAdminAiKnowledgeServer(await withStaffAuthHeaders()));
};

const fetchAdminCrmSegmentsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminCrmSegments(staff);
});

export const fetchAdminCrmSegments = async function fetchAdminCrmSegments() {
  return callStaffServerFn(async () => fetchAdminCrmSegmentsServer(await withStaffAuthHeaders()));
};

const previewAdminCrmSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: { prompt: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.previewAdminCrmSegment(data, staff);
  });

export const previewAdminCrmSegment = async function previewAdminCrmSegment(options: {
  data: { prompt: string };
}) {
  return callStaffServerFn(async () =>
    previewAdminCrmSegmentServer(await withStaffAuthHeaders(options)),
  );
};

type AdminCrmSegmentSaveInput = {
  id?: string;
  name: string;
  description: string | null;
  natural_language_prompt: string;
  structured_filters: AdminCrmSegmentPreview["filters"];
  status: "draft" | "active" | "archived";
};

const saveAdminCrmSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminCrmSegmentSaveInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminCrmSegment(data, staff);
  });

export const saveAdminCrmSegment = async function saveAdminCrmSegment(options: {
  data: AdminCrmSegmentSaveInput;
}) {
  return callStaffServerFn(async () =>
    saveAdminCrmSegmentServer(await withStaffAuthHeaders(options)),
  );
};

const materializeAdminCrmSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: { segmentId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.materializeAdminCrmSegment(data, staff);
  });

export const materializeAdminCrmSegment = async function materializeAdminCrmSegment(options: {
  data: { segmentId: string };
}) {
  return callStaffServerFn(async () =>
    materializeAdminCrmSegmentServer(await withStaffAuthHeaders(options)),
  );
};

const createAdminAudienceFromSegmentServer = createServerFn({ method: "POST" })
  .inputValidator((data: { segmentId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.createAdminAudienceFromSegment(data, staff);
  });

export const createAdminAudienceFromSegment =
  async function createAdminAudienceFromSegment(options: { data: { segmentId: string } }) {
    return callStaffServerFn(async () =>
      createAdminAudienceFromSegmentServer(await withStaffAuthHeaders(options)),
    );
  };

const fetchAdminLeadsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminLeads(staff);
});

export async function fetchAdminLeads() {
  return callStaffServerFn(async () => fetchAdminLeadsServer(await withStaffAuthHeaders()));
}

const fetchAdminConversationsServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.listAdminConversations(staff);
});

export async function fetchAdminConversations() {
  return callStaffServerFn(async () => fetchAdminConversationsServer(await withStaffAuthHeaders()));
}

const fetchCommandCenterServer = createServerFn({ method: "GET" }).handler(async () => {
  const staff = await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listCommandCenter(staff);
});

export async function fetchCommandCenter() {
  return callStaffServerFn(async () => fetchCommandCenterServer(await withStaffAuthHeaders()));
}

const completeAdminLeadActivityServer = createServerFn({ method: "POST" })
  .inputValidator((data: { activity_id: string; lead_id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.completeAdminLeadActivity(data, staff);
  });

export async function completeAdminLeadActivity(options: {
  data: { activity_id: string; lead_id: string };
}) {
  return callStaffServerFn(async () =>
    completeAdminLeadActivityServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminCampaignsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.listAdminCampaigns();
});

export async function fetchAdminCampaigns() {
  return callStaffServerFn(async () => fetchAdminCampaignsServer(await withStaffAuthHeaders()));
}

const websiteInquirySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Mirrors the identical client-side constraint in contact.tsx and
    // property.$listingNo.tsx. The server previously accepted any string up to
    // 30 chars, including one with no digits at all -- weaker than the form it
    // backs, and enough to write junk crm_contacts rows straight past both
    // forms via a direct server-fn call.
    phone: z
      .string()
      .trim()
      .min(8)
      .max(30)
      .regex(/^[\d+\-\s()]+$/),
    email: z.string().trim().max(254).email().optional().or(z.literal("")),
    message: z.string().trim().max(2000).optional().or(z.literal("")),
    listingNo: z.string().regex(WEBSITE_LISTING_NO_PATTERN).optional(),
    property_id: z.string().trim().uuid().optional(),
    consentWhatsapp: z.boolean().default(false),
  })
  // Public, untrusted path: never accept a caller-supplied agent assignment.
  .strip();

export type WebsiteInquiryInput = z.infer<typeof websiteInquirySchema>;

// Public, unauthenticated write path -- the only server fn in this file with no
// requireStaff() gate. Every submission inserts a crm_contacts row, a crm_leads
// row and an inquiries row, so without a limit a single client can flood the
// CRM (and the agents' lead queue) as fast as it can POST.
const WEBSITE_INQUIRY_RATE_LIMIT_PER_IP = 5;
const WEBSITE_INQUIRY_RATE_LIMIT_PER_IP_PHONE = 3;
const WEBSITE_INQUIRY_RATE_WINDOW_SECONDS = 60;

export const createWebsiteInquiry = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => websiteInquirySchema.parse(data))
  .handler(async ({ data }) => {
    const { clientIpFromRequest, enforceRateLimit } = await import("@/lib/ratelimit.server");
    const request = getRequest();
    const clientIp = clientIpFromRequest(request);

    await enforceRateLimit({
      key: `website-inquiry:ip:${clientIp}`,
      limit: WEBSITE_INQUIRY_RATE_LIMIT_PER_IP,
      windowSeconds: WEBSITE_INQUIRY_RATE_WINDOW_SECONDS,
    });

    // Scoped to (ip, phone), NOT to phone alone. A global per-phone bucket is a
    // weapon: anyone could burn a stranger's quota and lock that specific
    // person out of the contact form, from any IP, indefinitely. Pairing it
    // with the IP still stops one client hammering a single number while
    // leaving a real customer on a different connection unaffected. Skipped
    // entirely when the phone has no digits, so those submissions do not all
    // collapse into one shared bucket and block each other.
    const phoneDigits = data.phone.replace(/\D/g, "");
    if (phoneDigits) {
      await enforceRateLimit({
        key: `website-inquiry:ip-phone:${clientIp}:${phoneDigits}`,
        limit: WEBSITE_INQUIRY_RATE_LIMIT_PER_IP_PHONE,
        windowSeconds: WEBSITE_INQUIRY_RATE_WINDOW_SECONDS,
      });
    }

    const adminData = await import("./admin-data.server");
    return adminData.createWebsiteInquiry(data);
  });

// /listings' zero-results notify-me form. The filter payload is the
// validated /listings search-params object, spread as-is by the caller --
// bounded below so an unauthenticated caller can't attach an arbitrarily
// large JSON blob to a row.
const listingAlertFiltersSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 2000, {
    message: "Filter payload too large",
  });

const listingAlertUtmSchema = z
  .record(z.string(), z.string().max(200))
  .refine((value) => Object.keys(value).length <= 10, {
    message: "Too many UTM parameters",
  });

const listingAlertSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Mirrors websiteInquirySchema's phone constraint above -- same regex,
    // same bounds, so both public forms reject the same malformed input.
    phone: z
      .string()
      .trim()
      .min(8)
      .max(30)
      .regex(/^[\d+\-\s()]+$/),
    email: z.string().trim().max(254).email().optional().or(z.literal("")),
    filters: listingAlertFiltersSchema.default({}),
    // Never preselected client-side (see listings.tsx) and never optional
    // here: a submission with consent !== true fails validation rather than
    // silently persisting with no evidence consent was ever given.
    consent: z.literal(true),
    utm: listingAlertUtmSchema.default({}),
  })
  // Public, untrusted path: strip anything else, including a caller-supplied
  // consent_text/consent_version -- those are always the server's own
  // constants (see admin-data.server.ts's createListingAlert).
  .strip();

export type ListingAlertInput = z.infer<typeof listingAlertSchema>;

// Same profile as WEBSITE_INQUIRY_RATE_LIMIT_PER_IP above: an unauthenticated
// public path that inserts exactly one row per submission. Reuses those
// exact numbers rather than inventing new ones with no traffic data to tune
// against.
const LISTING_ALERT_RATE_LIMIT_PER_IP = 5;
const LISTING_ALERT_RATE_LIMIT_PER_IP_PHONE = 3;
const LISTING_ALERT_RATE_WINDOW_SECONDS = 60;

export const createListingAlert = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => listingAlertSchema.parse(data))
  .handler(async ({ data }) => {
    const { clientIpFromRequest, enforceRateLimit } = await import("@/lib/ratelimit.server");
    const request = getRequest();
    const clientIp = clientIpFromRequest(request);

    await enforceRateLimit({
      key: `listing-alert:ip:${clientIp}`,
      limit: LISTING_ALERT_RATE_LIMIT_PER_IP,
      windowSeconds: LISTING_ALERT_RATE_WINDOW_SECONDS,
    });

    const phoneDigits = data.phone.replace(/\D/g, "");
    if (phoneDigits) {
      await enforceRateLimit({
        key: `listing-alert:ip-phone:${clientIp}:${phoneDigits}`,
        limit: LISTING_ALERT_RATE_LIMIT_PER_IP_PHONE,
        windowSeconds: LISTING_ALERT_RATE_WINDOW_SECONDS,
      });
    }

    const adminData = await import("./admin-data.server");
    return adminData.createListingAlert(data);
  });

// OwnerValuationPanel's structured form, offered ALONGSIDE its existing
// WhatsApp deep-link (not replacing it). Filters through to a dedicated
// `valuation_leads` table (see valuation-leads.js), not crm_contacts/
// inquiries -- same reasoning as listingAlertSchema above.
const valuationLeadUtmSchema = z
  .record(z.string(), z.string().max(200))
  .refine((value) => Object.keys(value).length <= 10, {
    message: "Too many UTM parameters",
  });

const valuationLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Mirrors websiteInquirySchema/listingAlertSchema's phone constraint --
    // same regex, same bounds, so every public form on this site rejects the
    // same malformed input.
    phone: z
      .string()
      .trim()
      .min(8)
      .max(30)
      .regex(/^[\d+\-\s()]+$/),
    email: z.string().trim().max(254).email().optional().or(z.literal("")),
    propertyAddress: z.string().trim().min(1).max(300),
    // Only ever set when OwnerValuationPanel is rendered on a known estate
    // page (estate.$slug.tsx passes its own already-loaded estate.id) --
    // never guessed from propertyAddress's free text.
    estateId: z.string().trim().uuid().optional(),
    notes: z.string().trim().max(1000).optional().or(z.literal("")),
    // Never preselected client-side (see OwnerValuationPanel.tsx) and never
    // optional here: a submission with consent !== true fails validation
    // rather than silently persisting with no evidence consent was ever
    // given.
    consent: z.literal(true),
    utm: valuationLeadUtmSchema.default({}),
  })
  // Public, untrusted path: strip anything else, including a caller-supplied
  // consentText/consentVersion/consentedAt -- those are always the server's
  // own values (see admin-data.server.ts's createValuationLead).
  .strip();

export type ValuationLeadInput = z.infer<typeof valuationLeadSchema>;

// Same profile as LISTING_ALERT_RATE_LIMIT_PER_IP above: an unauthenticated
// public path that inserts exactly one row per submission.
const VALUATION_LEAD_RATE_LIMIT_PER_IP = 5;
const VALUATION_LEAD_RATE_LIMIT_PER_IP_PHONE = 3;
const VALUATION_LEAD_RATE_WINDOW_SECONDS = 60;

export const createValuationLead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => valuationLeadSchema.parse(data))
  .handler(async ({ data }) => {
    const { clientIpFromRequest, enforceRateLimit } = await import("@/lib/ratelimit.server");
    const request = getRequest();
    const clientIp = clientIpFromRequest(request);

    await enforceRateLimit({
      key: `valuation-lead:ip:${clientIp}`,
      limit: VALUATION_LEAD_RATE_LIMIT_PER_IP,
      windowSeconds: VALUATION_LEAD_RATE_WINDOW_SECONDS,
    });

    const phoneDigits = data.phone.replace(/\D/g, "");
    if (phoneDigits) {
      await enforceRateLimit({
        key: `valuation-lead:ip-phone:${clientIp}:${phoneDigits}`,
        limit: VALUATION_LEAD_RATE_LIMIT_PER_IP_PHONE,
        windowSeconds: VALUATION_LEAD_RATE_WINDOW_SECONDS,
      });
    }

    const adminData = await import("./admin-data.server");
    return adminData.createValuationLead(data);
  });

const updateAdminInquiryStatusServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateInquiryStatus(data.id, data.status, staff);
  });

export async function updateAdminInquiryStatus(options: { data: { id: string; status: string } }) {
  return callStaffServerFn(async () =>
    updateAdminInquiryStatusServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminAgentsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminAgents();
});

export async function fetchAdminAgents() {
  return callStaffServerFn(async () => fetchAdminAgentsServer(await withStaffAuthHeaders()));
}

const fetchAdminWoztellStatusServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const woztell = await import("../woztell/woztell.server");
  return { woztellEnabled: woztell.woztellEnabled() };
});

export async function fetchAdminWoztellStatus() {
  return callStaffServerFn(async () =>
    fetchAdminWoztellStatusServer(await withStaffAuthHeaders({})),
  );
}

const saveAdminEstateServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminEstateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminEstate(data, staff);
  });

export async function saveAdminEstate(options: { data: AdminEstateInput }) {
  return callStaffServerFn(async () => saveAdminEstateServer(await withStaffAuthHeaders(options)));
}

const saveAdminArticleServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminArticleInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminArticle(data, staff);
  });

export async function saveAdminArticle(options: { data: AdminArticleInput }) {
  return callStaffServerFn(async () => saveAdminArticleServer(await withStaffAuthHeaders(options)));
}

const saveAdminFaqServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminFaqInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminFaq(data, staff);
  });

export async function saveAdminFaq(options: { data: AdminFaqInput }) {
  return callStaffServerFn(async () => saveAdminFaqServer(await withStaffAuthHeaders(options)));
}

const deleteAdminFaqServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminFaq(data.id, staff);
  });

export async function deleteAdminFaq(options: { data: { id: string } }) {
  return callStaffServerFn(async () => deleteAdminFaqServer(await withStaffAuthHeaders(options)));
}

const checkAdminFaqConflictsServer = createServerFn({ method: "POST" })
  .inputValidator((data: { keys: Array<{ scope: string; question: string }> }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.checkAdminFaqConflicts(data.keys, staff);
  });

export async function checkAdminFaqConflicts(options: {
  data: { keys: Array<{ scope: string; question: string }> };
}) {
  return callStaffServerFn(async () =>
    checkAdminFaqConflictsServer(await withStaffAuthHeaders(options)),
  );
}

const bulkUpdateAdminLeadsServer = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      ids: string[];
      stage?: string;
      assigned_agent_id?: string | null;
      assignAgent?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.bulkUpdateAdminLeads(data, staff);
  });

export async function bulkUpdateAdminLeads(options: {
  data: {
    ids: string[];
    stage?: string;
    assigned_agent_id?: string | null;
    assignAgent?: boolean;
  };
}) {
  return callStaffServerFn(async () =>
    bulkUpdateAdminLeadsServer(await withStaffAuthHeaders(options)),
  );
}

const reorderAdminFaqsServer = createServerFn({ method: "POST" })
  .inputValidator((data: { orderedIds: string[] }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.reorderAdminFaqs(data.orderedIds, staff);
  });

export async function reorderAdminFaqs(options: { data: { orderedIds: string[] } }) {
  return callStaffServerFn(async () => reorderAdminFaqsServer(await withStaffAuthHeaders(options)));
}

const fetchAdminMediaAssetsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminMediaAssets();
});

export async function fetchAdminMediaAssets() {
  return callStaffServerFn(async () => fetchAdminMediaAssetsServer(await withStaffAuthHeaders()));
}

const updateAdminMediaAssetServer = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null }) =>
      data,
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminMediaAsset(data, staff);
  });

export async function updateAdminMediaAsset(options: {
  data: { id: string; alt_text: string | null; owner_type: string; owner_id: string | null };
}) {
  return callStaffServerFn(async () =>
    updateAdminMediaAssetServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminListingsFilteredServer = createServerFn({ method: "GET" })
  .inputValidator((data: AdminListingFiltersInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.listAdminListings(data, staff);
  });

export async function fetchAdminListingsFiltered(options: { data: AdminListingFiltersInput }) {
  return callStaffServerFn(async () =>
    fetchAdminListingsFilteredServer(await withStaffAuthHeaders(options)),
  );
}

const updateAdminPropertyStatusServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: AdminPropertyInput["status"] }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminPropertyStatus(data.id, data.status, staff);
  });

export async function updateAdminPropertyStatus(options: {
  data: { id: string; status: AdminPropertyInput["status"] };
}) {
  return callStaffServerFn(async () =>
    updateAdminPropertyStatusServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminLeadServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminLead(data.id, staff);
  });

export async function fetchAdminLead(options: { data: { id: string } }) {
  return callStaffServerFn(async () => fetchAdminLeadServer(await withStaffAuthHeaders(options)));
}

const fetchAdminLeadAiProfileServer = createServerFn({ method: "GET" })
  .inputValidator((data: { leadId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminLeadAiProfile(data, staff);
  });

export const fetchAdminLeadAiProfile = async function fetchAdminLeadAiProfile(options: {
  data: { leadId: string };
}) {
  return callStaffServerFn(async () =>
    fetchAdminLeadAiProfileServer(await withStaffAuthHeaders(options)),
  );
};

const analyzeAdminLeadAiProfileServer = createServerFn({ method: "POST" })
  .inputValidator((data: { leadId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.analyzeAdminLeadAiProfile(data, staff);
  });

export const analyzeAdminLeadAiProfile = async function analyzeAdminLeadAiProfile(options: {
  data: { leadId: string };
}) {
  return callStaffServerFn(async () =>
    analyzeAdminLeadAiProfileServer(await withStaffAuthHeaders(options)),
  );
};

const approveAdminAiTagServer = createServerFn({ method: "POST" })
  .inputValidator((data: { tagId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.approveAdminAiTag(data, staff);
  });

export const approveAdminAiTag = async function approveAdminAiTag(options: {
  data: { tagId: string };
}) {
  return callStaffServerFn(async () =>
    approveAdminAiTagServer(await withStaffAuthHeaders(options)),
  );
};

const rejectAdminAiTagServer = createServerFn({ method: "POST" })
  .inputValidator((data: { tagId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.rejectAdminAiTag(data, staff);
  });

export const rejectAdminAiTag = async function rejectAdminAiTag(options: {
  data: { tagId: string };
}) {
  return callStaffServerFn(async () => rejectAdminAiTagServer(await withStaffAuthHeaders(options)));
};

const updateAdminLeadServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminLeadUpdateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminLead(data, staff);
  });

export async function updateAdminLead(options: { data: AdminLeadUpdateInput }) {
  return callStaffServerFn(async () => updateAdminLeadServer(await withStaffAuthHeaders(options)));
}

const createAdminLeadActivityServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminLeadActivityInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.createAdminLeadActivity(data, staff);
  });

export async function createAdminLeadActivity(options: { data: AdminLeadActivityInput }) {
  return callStaffServerFn(async () =>
    createAdminLeadActivityServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminConversationServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminConversation(data.id, staff);
  });

export async function fetchAdminConversation(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    fetchAdminConversationServer(await withStaffAuthHeaders(options)),
  );
}

const fetchAdminConversationAiAssistServer = createServerFn({ method: "GET" })
  .inputValidator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.fetchAdminConversationAiAssist(data, staff);
  });

export const fetchAdminConversationAiAssist =
  async function fetchAdminConversationAiAssist(options: {
    data: { conversationId: string };
  }): Promise<AdminConversationAiAssist> {
    return callStaffServerFn(async () =>
      fetchAdminConversationAiAssistServer(await withStaffAuthHeaders(options)),
    );
  };

const updateAdminConversationServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminConversationUpdateInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager", "agent"]);
    const adminData = await import("./admin-data.server");
    return adminData.updateAdminConversation(data, staff);
  });

export async function updateAdminConversation(options: { data: AdminConversationUpdateInput }) {
  return callStaffServerFn(async () =>
    updateAdminConversationServer(await withStaffAuthHeaders(options)),
  );
}

// admin/manager only: clearing an opt-out re-enables marketing messages to a
// real person, so it is a deliberately narrower grant than the rest of the
// conversation surface (which agents can use).
const clearContactWhatsappOptOutServer = createServerFn({ method: "POST" })
  .inputValidator((data: { contactId: string; reason: string }) =>
    z
      .object({ contactId: z.string().trim().uuid(), reason: z.string().trim().min(1).max(500) })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.clearContactWhatsappOptOut(data, staff);
  });

export async function clearContactWhatsappOptOut(options: {
  data: { contactId: string; reason: string };
}) {
  return callStaffServerFn(async () =>
    clearContactWhatsappOptOutServer(await withStaffAuthHeaders(options)),
  );
}

export async function sendAdminConversationReply(options: {
  data: { conversationId: string; text: string };
}) {
  const request = await withStaffAuthHeaders({
    headers: { "Content-Type": "application/json" },
  });
  const response = await fetch("/api/admin/woztell/send", {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(options.data),
  });
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload === "object") {
    return payload as { ok: boolean; error?: string };
  }
  return {
    ok: false,
    error: response.statusText || "WhatsApp reply failed",
  };
}

export async function sendAdminConversationTemplate(options: {
  data: { conversationId: string; templateId: string };
}) {
  const request = await withStaffAuthHeaders({
    headers: { "Content-Type": "application/json" },
  });
  const response = await fetch("/api/admin/woztell/send-template", {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(options.data),
  });
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload === "object") {
    return payload as { ok: boolean; error?: string };
  }
  return {
    ok: false,
    error: response.statusText || "WhatsApp template send failed",
  };
}

export type WoztellBackfillResult = {
  ok: boolean;
  error?: string;
  hint?: string;
  mode?: "forward" | "backward";
  pages?: number;
  rows?: number;
  ingested?: number;
  duplicates?: number;
  skipped?: number;
  reachedEnd?: boolean;
  nextCursor?: string | null;
};

/**
 * Import WhatsApp history that predates the webhook.
 *
 * A plain fetch rather than a server function for the same reason
 * sendAdminConversationReply is: the route needs the raw Response so a 503
 * (missing WOZTELL_OPEN_API_TOKEN) and a 502 (Woztell rejected us) can be told
 * apart and reported with their own text, instead of collapsing into one
 * generic failure.
 */
export async function runAdminWoztellBackfill(options?: {
  data?: { maxPages?: number; after?: string | null; mode?: "forward" | "backward" };
}): Promise<WoztellBackfillResult> {
  const request = await withStaffAuthHeaders({
    headers: { "Content-Type": "application/json" },
  });
  const response = await fetch("/api/admin/woztell/backfill", {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(options?.data ?? {}),
  });
  const payload = (await response.json().catch(() => null)) as WoztellBackfillResult | null;

  if (payload && typeof payload === "object") return payload;
  return { ok: false, error: response.statusText || "匯入失敗" };
}

const fetchAdminBlastOptionsServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminBlastOptions();
});

export async function fetchAdminBlastOptions() {
  return callStaffServerFn(async () => fetchAdminBlastOptionsServer(await withStaffAuthHeaders()));
}

// Agent role too: matches the WhatsApp inbox's own access level
// (requireStaffAccess(..., ["admin", "manager", "agent"]) on
// /api/admin/woztell/send), unlike fetchAdminBlastOptions which is
// admin/manager-only for campaign authoring.
const fetchAdminWhatsappTemplatesServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaff(["admin", "manager", "agent"]);
  const data = await import("./admin-data.server");
  return data.fetchAdminWhatsappTemplates();
});

export async function fetchAdminWhatsappTemplates() {
  return callStaffServerFn(async () =>
    fetchAdminWhatsappTemplatesServer(await withStaffAuthHeaders()),
  );
}

const saveAdminAudienceServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminAudienceInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminAudience(data, staff);
  });

const deleteAdminAudienceServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.deleteAdminAudience(data.id, staff);
  });

export async function deleteAdminAudience(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    deleteAdminAudienceServer(await withStaffAuthHeaders(options)),
  );
}

export async function saveAdminAudience(options: { data: AdminAudienceInput }) {
  return callStaffServerFn(async () =>
    saveAdminAudienceServer(await withStaffAuthHeaders(options)),
  );
}

const previewAdminAudienceServer = createServerFn({ method: "GET" })
  .inputValidator((data: { audience_id?: string; filters?: AdminAudienceInput["filters"] }) => data)
  .handler(async ({ data }) => {
    await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.previewAdminAudience(data);
  });

export async function previewAdminAudience(options: {
  data: { audience_id?: string; filters?: AdminAudienceInput["filters"] };
}) {
  return callStaffServerFn(async () =>
    previewAdminAudienceServer(await withStaffAuthHeaders(options)),
  );
}

const saveAdminCampaignServer = createServerFn({ method: "POST" })
  .inputValidator((data: AdminCampaignInput) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.saveAdminCampaign(data, staff);
  });

export async function saveAdminCampaign(options: { data: AdminCampaignInput }) {
  return callStaffServerFn(async () =>
    saveAdminCampaignServer(await withStaffAuthHeaders(options)),
  );
}

const materializeCampaignRecipientsServer = createServerFn({ method: "POST" })
  .inputValidator((data: { campaign_id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.materializeCampaignRecipients(data.campaign_id, staff);
  });

export async function materializeCampaignRecipients(options: { data: { campaign_id: string } }) {
  return callStaffServerFn(async () =>
    materializeCampaignRecipientsServer(await withStaffAuthHeaders(options)),
  );
}

export async function sendAdminCampaignQueue(options: { data: { id: string } }) {
  const request = await withStaffAuthHeaders({
    headers: { "Content-Type": "application/json" },
  });
  const response = await fetch(`/api/admin/campaigns/${options.data.id}/queue`, {
    method: "POST",
    headers: request.headers,
  });
  const payload = await response.json().catch(() => null);

  if (payload && typeof payload === "object") {
    return payload as {
      ok: boolean;
      error?: string;
      materialization?: { eligible?: number };
    };
  }
  return {
    ok: false,
    error: response.statusText || "Campaign queue failed",
  };
}

const queueAdminCampaignServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.queueAdminCampaign(data.id, staff);
  });

export async function queueAdminCampaign(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    queueAdminCampaignServer(await withStaffAuthHeaders(options)),
  );
}

const cancelAdminCampaignServer = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const staff = await requireStaff(["admin", "manager"]);
    const adminData = await import("./admin-data.server");
    return adminData.cancelAdminCampaign(data.id, staff);
  });

export async function cancelAdminCampaign(options: { data: { id: string } }) {
  return callStaffServerFn(async () =>
    cancelAdminCampaignServer(await withStaffAuthHeaders(options)),
  );
}
