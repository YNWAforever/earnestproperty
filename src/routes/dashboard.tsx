import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [{ title: "Admin｜Earnest Property" }, { name: "robots", content: "noindex" }],
  }),
  component: DashboardRedirect,
});

function DashboardRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin", replace: true });
  }, [navigate]);
  return null;
}
