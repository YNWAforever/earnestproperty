import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { withStaffAuthHeaders } from "@/auth";
import { requireStaffPermission } from "../control-plane/permissions";
import { unwrapServerFnResponse } from "../neon/server-fn-response";

const statusServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffPermission(getRequest(), "cms.publish");
  const { createYouTubeSyncHistory } = await import("./youtube-history.server");
  return createYouTubeSyncHistory().readStatus();
});

export async function fetchYouTubeSyncStatus() {
  return unwrapServerFnResponse(statusServer(await withStaffAuthHeaders()));
}
