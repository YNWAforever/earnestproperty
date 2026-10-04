import React from "react";
import { Toaster } from "sonner";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route as Overview } from "../../../src/routes/admin.index";
import { Route as Leads } from "../../../src/routes/admin.leads";
import { staffSessionStore } from "../../../src/components/admin/staff-session";
import { changeActor } from "./auth";
import "./synthetic-api";
import "../../../src/styles.css";
const root = createRootRoute({ component: () => <Outlet /> });
const router = createRouter({
  routeTree: root.addChildren([
    Overview.update({ id: "/admin", path: "/admin", getParentRoute: () => root } as never),
    Leads.update({ id: "/admin/leads", path: "/admin/leads", getParentRoute: () => root } as never),
  ]),
  defaultPreload: false,
});
window.dailyWorkFixture.changeContext = async (
  actor,
  role,
  binding = "staff-a",
  denied = false,
) => {
  Object.assign(window.dailyWorkFixture, { actor, role, binding, denied });
  changeActor(actor);
  await staffSessionStore.refresh(actor);
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
    <Toaster />
  </QueryClientProvider>,
);
