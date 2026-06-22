import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/inquiries")({
  head: () => ({
    meta: [{ title: "CRM｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: InquiriesRedirect,
});

function InquiriesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/leads", replace: true });
  }, [navigate]);
  return null;
}
