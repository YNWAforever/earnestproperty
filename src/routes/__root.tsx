import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
  redirect,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { isAnalyticsPrivatePath } from "@/lib/analytics/attribution";
import { requiresDocumentIsolation } from "@/lib/route-isolation";
const PrivateAuthProvider = lazy(() => import("@/components/auth/PrivateAuthProvider"));
const documentEntryPath = typeof window === "undefined" ? null : window.location.pathname;

import appCss from "../styles.css?url";
// Self-hosted fonts: one Noto Sans TC variable slice supports weights 100–900.
// Keep Inter static weights and the existing local Latin preload.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource-variable/noto-sans-tc/wght.css";
// The one file worth a real preload hint: Inter's Latin subset at the
// default body weight, used by nearly every ASCII character on the page.
// Noto Sans TC's CJK glyphs are split across many unicode-range chunks
// (fontsource's own subsetting) with no single "primary" file to preload
// correctly, so this doesn't guess one.
import interLatin400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";

import { LiveAgentLauncher } from "@/components/live-agent/LiveAgentLauncher";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { StickyWhatsAppBar } from "@/components/site/StickyWhatsAppBar";
import { Toaster } from "@/components/ui/sonner";
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
  beforeLoad: ({ location, preload }) => {
    if (
      documentEntryPath !== null &&
      requiresDocumentIsolation(documentEntryPath, location.pathname, preload)
    ) {
      throw redirect({ href: location.href, reloadDocument: true });
    }
  },
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
      // The site emitted neither of these anywhere, so every shared card was
      // missing the two properties that say which brand it belongs to and
      // which URL it resolves to. og:site_name is a constant; og:url is the
      // production origin, and each route's own rel=canonical remains the
      // per-page signal -- a root-level og:url must not claim to be the
      // page's own address, so it names the site root only.
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:url", content: SITE_URL },
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

  const content = (
    <>
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
      {showLiveAgentWidget ? <LiveAgentLauncher /> : null}
      {!isAnalyticsPrivatePath(location.pathname) ? (
        <AnalyticsProvider pathname={location.pathname} documentIsolationApproved />
      ) : null}
      {/* Public pages only: the private (admin/auth/account) branch already gets
          a toaster from NeonAuthUIProvider inside PrivateAuthProvider, and a
          second one would show every toast twice. */}
      {!isAnalyticsPrivatePath(location.pathname) ? (
        <Toaster position="top-center" richColors />
      ) : null}
    </>
  );
  return isAnalyticsPrivatePath(location.pathname) ? (
    <Suspense fallback={<main aria-busy="true">載入中…</main>}>
      <PrivateAuthProvider>{content}</PrivateAuthProvider>
    </Suspense>
  ) : (
    content
  );
}

// Private staff and account routes use their own compact identity shell.
function isPublicSitePath(pathname: string) {
  return !["/admin", "/auth", "/account"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
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
