import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Route } from "../../../src/routes/admin.whatsapp";
import { Route as LeadsRoute } from "../../../src/routes/admin.leads";
import { Route as BlastsRoute } from "../../../src/routes/admin.blasts";
import { Route as OverviewRoute } from "../../../src/routes/admin.index";
import { Route as AnalyticsRoute } from "../../../src/routes/admin.analytics";
import "../../../src/styles.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

// Real route, shell, dialogs and CSS. Only the Auth/API imports are test adapters.
const root = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
});
const route = Route.update({
  id: "/admin/whatsapp",
  path: "/admin/whatsapp",
  getParentRoute: () => root,
} as never);
const leads = LeadsRoute.update({
  id: "/admin/leads",
  path: "/admin/leads",
  getParentRoute: () => root,
} as never);
const blasts = BlastsRoute.update({
  id: "/admin/blasts",
  path: "/admin/blasts",
  getParentRoute: () => root,
} as never);
const router = createRouter({
  routeTree: root.addChildren([
    route,
    leads,
    blasts,
    OverviewRoute.update({ id: "/admin", path: "/admin", getParentRoute: () => root } as never),
    AnalyticsRoute.update({
      id: "/admin/analytics",
      path: "/admin/analytics",
      getParentRoute: () => root,
    } as never),
  ]),
  defaultPreload: false,
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
