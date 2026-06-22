import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/login")({
  head: () => ({
    meta: [{ title: "登入｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: LegacyLoginRedirect,
});

function LegacyLoginRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/auth/$pathname", params: { pathname: "sign-in" }, replace: true });
  }, [navigate]);
  return null;
}
