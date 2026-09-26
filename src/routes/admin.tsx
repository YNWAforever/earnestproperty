import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { user, session } = useNeonAuth();
  return <Outlet key={`${user?.id ?? "anonymous"}:${session?.id ?? "none"}`} />;
}
