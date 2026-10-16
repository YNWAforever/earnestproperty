import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireStaffPermission } from "../control-plane/permissions";
import { callStaffServerFn } from "../neon/staff-server-fn";

const statusServer = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffPermission(getRequest(), "cms.publish");
  const { createYouTubeSyncHistory } = await import("./youtube-history.server");
  return createYouTubeSyncHistory().readStatus();
});

export async function fetchYouTubeSyncStatus() {
  return callStaffServerFn(statusServer, {});
}
