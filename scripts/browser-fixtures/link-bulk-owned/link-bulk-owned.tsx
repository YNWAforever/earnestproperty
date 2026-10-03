import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route as Links } from "../../../src/routes/admin.whatsapp-links";
import "./synthetic-batches";
import "../../../src/styles.css";
const root = createRootRoute({ component: () => <Outlet /> });
const router = createRouter({
  routeTree: root.addChildren([
    Links.update({
      id: "/admin/whatsapp-links",
      path: "/admin/whatsapp-links",
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
