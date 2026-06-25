import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Server-side guard: verifies staff access during SSR so unauthenticated/unauthorized
// users are redirected before any admin markup is rendered. AdminShell keeps its own
// client-side check as defense-in-depth.
const ensureStaffAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { requireStaffAccess } = await import("@/lib/neon/auth.server");
  await requireStaffAccess(getRequest(), ["admin", "manager", "agent"]);
  return { ok: true };
});

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    try {
      await ensureStaffAccess();
    } catch {
      throw redirect({ to: "/auth/$pathname", params: { pathname: "sign-in" } });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return <Outlet />;
}
