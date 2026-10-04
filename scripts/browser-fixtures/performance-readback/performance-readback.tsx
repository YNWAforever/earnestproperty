import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route as Analytics } from "../../../src/routes/admin.analytics";
import { staffSessionStore } from "../../../src/components/admin/staff-session";
import { changeActor } from "./auth";
import { state } from "./synthetic-analytics";
import "../../../src/styles.css";
state.changeContext = async (actor, binding = "staff-a", role = "manager", denied = false) => {
  Object.assign(state, { actor, binding, role, denied });
  changeActor(actor);
  await staffSessionStore.refresh(actor);
};
const root = createRootRoute({ component: () => <Outlet /> });
const router = createRouter({
  routeTree: root.addChildren([
    Analytics.update({
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
