import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";

import appCss from "../styles.css?url";
// Self-hosted fonts (P7c) -- replaces the Google Fonts CDN <link> tags that
// used to sit in head() below. Only the weights styles.css's --font-sans/
// --font-display actually reference (Inter 400/500/600/700, Noto Sans TC
// 400/500/700/900), matching the old Google Fonts URL's own weight list
// exactly, not fontsource's full 100-900 range.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "@fontsource/noto-sans-tc/900.css";
// The one file worth a real preload hint: Inter's Latin subset at the
// default body weight, used by nearly every ASCII character on the page.
// Noto Sans TC's CJK glyphs are split across many unicode-range chunks
// (fontsource's own subsetting) with no single "primary" file to preload
// correctly, so this doesn't guess one.
import interLatin400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import { authClient } from "@/auth";
import { LiveAgentWidget } from "@/components/live-agent/LiveAgentWidget";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { StickyWhatsAppBar } from "@/components/site/StickyWhatsAppBar";
import { pageSeo, SITE_NAME, SITE_OG_IMAGE, SITE_THEME_COLOR, SITE_URL } from "@/content/seo";
import { jsonLdScript, organizationSchema } from "@/lib/schema";

function NotFoundComponent() {
  return (
    // zh-HK copy on a zh-HK site (this used to be the scaffold's English
    // "Page not found"), and page-sized rather than `min-h-screen` -- that
    // added a full viewport of empty space under the sticky header.
    <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md text-center">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-4xl">
          找不到這個頁面
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          你要找的頁面可能已移除或連結已更新。可以返回首頁，或直接搜尋放盤。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            返回首頁
          </Link>
          <Link
            to="/listings"
            className="inline-flex min-h-11 items-center justify-center rounded-md border bg-background px-5 text-sm font-semibold text-primary transition-colors hover:border-primary"
          >
            搜尋放盤
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: SITE_THEME_COLOR },
      { title: pageSeo.home.title },
      {
        name: "description",
        content: pageSeo.home.description,
      },
      { name: "author", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "zh_HK" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: pageSeo.home.title },
      { name: "twitter:title", content: pageSeo.home.title },
      { property: "og:description", content: pageSeo.home.description },
      { name: "twitter:description", content: pageSeo.home.description },
      { property: "og:image", content: SITE_OG_IMAGE },
      { name: "twitter:image", content: SITE_OG_IMAGE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: interLatin400,
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-HK" className="light" style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const location = useLocation();
  const showLiveAgentWidget = isPublicWidgetPath(location.pathname);
  const showStickyWhatsAppBar = shouldShowStickyWhatsAppBar(location.pathname);
  const showSiteChrome = isPublicSitePath(location.pathname);

  return (
    // baseURL: the absolute origin Neon Auth sends people back to from emailed
    // links (password reset first of all). Left empty, the built-in 忘記密碼
    // form sent a relative "/auth/reset-password", which an auth server on
    // Neon's domain resolves against ITS origin, not ours. SITE_URL rather than
    // window.location.origin so server and client render the same value.
    <NeonAuthUIProvider authClient={authClient} baseURL={SITE_URL} defaultTheme="light">
      {/* The sticky WhatsApp bar is `fixed` at bottom-16 (above the 問樓助手
          bubble) and ~52px tall, so the page needs ~116px reserved -- pb-16
          only cleared the offset, leaving the footer's last lines under the
          bar with no way to scroll past it. */}
      <div className={`flex min-h-screen flex-col ${showStickyWhatsAppBar ? "pb-32 lg:pb-0" : ""}`}>
        {showSiteChrome && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLdScript({ "@context": "https://schema.org", ...organizationSchema() }),
            }}
          />
        )}
        {showSiteChrome ? <SiteHeader /> : null}
        <main className="flex-1">
          <Outlet />
        </main>
        {showSiteChrome ? <SiteFooter /> : null}
      </div>
      {showStickyWhatsAppBar ? <StickyWhatsAppBar /> : null}
      {showLiveAgentWidget ? <LiveAgentWidget /> : null}
    </NeonAuthUIProvider>
  );
}

// AdminShell renders its own header, nav, and identity block, so the public
// marketing SiteHeader/SiteFooter were pure duplication on every /admin
// page -- a second, redundant "banner" landmark above AdminShell's own, and a
// full district/estate/legal marketing footer at the bottom of an internal
// CRM tool, past which agents had to scroll on every long WhatsApp thread.
// Deliberately narrower than isPublicWidgetPath/shouldShowStickyWhatsAppBar
// below: /auth and /account render a bare AuthView/AccountView with no header
// of their own (see auth.$pathname.tsx, account.$pathname.tsx), so excluding
// them here the same way would leave staff on an unbranded, logo-less sign-in
// page instead of removing a duplicate.
function isPublicSitePath(pathname: string) {
  return pathname !== "/admin" && !pathname.startsWith("/admin/");
}

function isPublicWidgetPath(pathname: string) {
  return !["/admin", "/auth", "/account"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// /property/$listingNo has its own listing-aware mobile action bar
// (PropertyDecisionActions) with the same wa.me + bottom-16 convention, so the
// generic bar would duplicate it. /admin, /auth, /account, /dashboard are
// staff/system surfaces, not conversion pages.
function shouldShowStickyWhatsAppBar(pathname: string) {
  if (pathname.startsWith("/property/")) return false;
  return !["/admin", "/auth", "/account", "/dashboard"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
