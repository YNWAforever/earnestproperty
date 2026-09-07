import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/login")({
  head: () => ({
    meta: [
      { title: "職員登入｜晉誠地產內部系統" },
      {
        name: "description",
        content:
          "舊版職員登入網址，會自動轉往新的登入頁。此頁只供晉誠地產已授權職員使用，不對外公開。",
      },
      { property: "og:title", content: "職員登入｜晉誠地產內部系統" },
      { property: "og:description", content: "舊版職員登入網址，會自動轉往新的登入頁。" },
      { name: "twitter:title", content: "職員登入｜晉誠地產內部系統" },
      { name: "twitter:description", content: "舊版職員登入網址，會自動轉往新的登入頁。" },
      { name: "robots", content: "noindex,nofollow" },
    ],
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
