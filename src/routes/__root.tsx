import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { NeonAuthUIProvider } from "@neondatabase/auth-ui";

import appCss from "../styles.css?url";
import { authClient } from "@/auth";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

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
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
      { title: "晉誠地產 Earnest Property｜深井．青山公路物業專家" },
      {
        name: "description",
        content:
          "深井買樓租樓專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園真盤源，即時 WhatsApp 查詢。Licence C-018613。",
      },
      { name: "author", content: "Earnest Property 晉誠地產" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "zh_HK" },
      { name: "twitter:card", content: "summary_large_image" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" } as never,
      { property: "og:title", content: "晉誠地產 Earnest Property｜深井．青山公路物業專家" },
      { name: "twitter:title", content: "晉誠地產 Earnest Property｜深井．青山公路物業專家" },
      {
        property: "og:description",
        content:
          "深井買樓租樓專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園真盤源，即時 WhatsApp 查詢。Licence C-018613。",
      },
      {
        name: "twitter:description",
        content:
          "深井買樓租樓專家。碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園真盤源，即時 WhatsApp 查詢。Licence C-018613。",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2761dc31-661d-4a46-bb12-3c2f0797ef48/id-preview-8d7c8c57--2094438b-b830-479d-91e0-66e31f716366.lovable.app-1776455449297.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2761dc31-661d-4a46-bb12-3c2f0797ef48/id-preview-8d7c8c57--2094438b-b830-479d-91e0-66e31f716366.lovable.app-1776455449297.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
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
    <html lang="en">
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
  return (
    <NeonAuthUIProvider authClient={authClient}>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </NeonAuthUIProvider>
  );
}
