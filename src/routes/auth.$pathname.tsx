import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthView } from "@neondatabase/auth-ui";

import { safeAdminRedirect } from "@/lib/admin/safe-redirect";
import { staffAuthZhHK } from "@/lib/admin/auth-localization";

export const Route = createFileRoute("/auth/$pathname")({
  // `redirect` carries the admin page the user originally asked for. Without it
  // a deep link to /admin/whatsapp sent staff here and then to the public
  // homepage, leaving them to navigate back by hand.
  validateSearch: (search: Record<string, unknown>) =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  // This route had no head() at all, so it inherited the homepage title,
  // description and og/twitter card verbatim -- a shared sign-in link unfurled
  // as the homepage -- and it was the only /auth or /account route without a
  // robots noindex. robots.txt disallows /auth, but that stops crawling, not
  // indexing of a linked URL, and it does nothing for the share card.
  head: () => ({
    meta: [
      { title: "職員登入｜晉誠地產內部系統" },
      {
        name: "description",
        content:
          "晉誠地產職員內部登入頁，只供已授權帳戶使用。買樓、租樓或估價查詢請返回晉誠地產網站首頁，或 WhatsApp 聯絡持牌代理 C-018613。",
      },
      { property: "og:title", content: "職員登入｜晉誠地產內部系統" },
      {
        property: "og:description",
        content: "晉誠地產職員內部登入頁，只供已授權帳戶使用。",
      },
      { name: "twitter:title", content: "職員登入｜晉誠地產內部系統" },
      {
        name: "twitter:description",
        content: "晉誠地產職員內部登入頁，只供已授權帳戶使用。",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Auth,
});

function Auth() {
  const { pathname } = Route.useParams();
  const { redirect } = Route.useSearch();
  // Validated, not trusted: the parameter is attacker-controllable, so it is
  // run through an allowlist rather than passed straight to AuthView.
  const redirectTo = safeAdminRedirect(redirect);
  const [locale, setLocale] = useState<"zh-HK" | "en">("zh-HK");
  useEffect(() => {
    try {
      if (window.localStorage.getItem("earnest.staff-auth-locale") === "en") setLocale("en");
    } catch {
      // Storage may be unavailable; the visible toggle still works.
    }
  }, []);
  function toggleLocale() {
    const next = locale === "zh-HK" ? "en" : "zh-HK";
    setLocale(next);
    try {
      window.localStorage.setItem("earnest.staff-auth-locale", next);
    } catch {
      // Language selection never blocks authentication.
    }
  }

  return (
    <section
      lang={locale}
      className="flex min-h-[calc(100vh-12rem)] items-center justify-center bg-background px-4 py-12"
    >
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <a href="/" className="text-lg font-semibold text-primary">
            晉誠地產
          </a>
          <p className="mt-1 text-sm text-muted-foreground">
            {locale === "zh-HK"
              ? "職員登入 · 只供已授權團隊使用"
              : "Staff sign-in · Authorized team only"}
          </p>
          <button
            type="button"
            onClick={toggleLocale}
            className="mt-3 min-h-11 rounded px-3 text-sm font-medium text-primary underline underline-offset-4"
          >
            {locale === "zh-HK" ? "English" : "繁體中文"}
          </button>
        </header>
        <AuthView
          pathname={pathname}
          redirectTo={redirectTo}
          localization={locale === "zh-HK" ? staffAuthZhHK : undefined}
        />
      </div>
    </section>
  );
}
