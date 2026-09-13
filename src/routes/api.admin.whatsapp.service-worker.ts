import { runServiceJobs } from "../lib/control-plane/service-worker.server.ts";
import { createFileRoute } from "@tanstack/react-router";
export async function drainServiceJobs({ request }: { request: Request }) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`)
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    return Response.json(await runServiceJobs());
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_SCHEMA_REQUIRED")
      return Response.json({ error: "SERVICE_SCHEMA_REQUIRED" }, { status: 503 });
    throw error;
  }
}

export const Route = createFileRoute("/api/admin/whatsapp/service-worker")({
  server: { handlers: { POST: drainServiceJobs } },
});
