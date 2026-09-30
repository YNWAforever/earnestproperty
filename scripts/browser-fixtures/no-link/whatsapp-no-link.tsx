import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Route } from "../../../src/routes/admin.whatsapp";
import "../../../src/styles.css";

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
const router = createRouter({ routeTree: root.addChildren([route]), defaultPreload: false });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
