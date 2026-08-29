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
import { authClient } from "@/auth";
import { LiveAgentWidget } from "@/components/live-agent/LiveAgentWidget";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { StickyWhatsAppBar } from "@/components/site/StickyWhatsAppBar";
import { pageSeo, SITE_NAME, SITE_OG_IMAGE, SITE_THEME_COLOR } from "@/content/seo";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Go home
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
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "preload",
        as: "style",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap",
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
    <NeonAuthUIProvider authClient={authClient} defaultTheme="light">
      <div className={`flex min-h-screen flex-col ${showStickyWhatsAppBar ? "pb-16 lg:pb-0" : ""}`}>
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
