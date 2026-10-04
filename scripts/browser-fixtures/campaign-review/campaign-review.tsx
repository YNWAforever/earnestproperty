import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Route as Blasts } from "../../../src/routes/admin.blasts";
import { staffSessionStore } from "../../../src/components/admin/staff-session";
import { changeActor } from "./auth";
import { membership } from "./synthetic-api";
import "../../../src/styles.css";
declare global {
  interface Window {
    campaignReviewFixture: {
      changeActor: (id: string) => Promise<void>;
      changeMembership: (role?: string, binding?: string) => Promise<void>;
    };
  }
}
window.campaignReviewFixture = {
  changeMembership: async (role = "manager", binding = membership.binding) => {
    Object.assign(membership, { role, binding });
    await staffSessionStore.refresh(staffSessionStore.getSnapshot().userId!);
  },
  changeActor: async (id) => {
    changeActor(id);
    await staffSessionStore.refresh(id);
  },
};
const root = createRootRoute({ component: () => <Outlet /> });
const router = createRouter({
  routeTree: root.addChildren([
    Blasts.update({
      id: "/admin/blasts",
      path: "/admin/blasts",
      getParentRoute: () => root,
    } as never),
  ]),
  defaultPreload: false,
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
    <Toaster />
  </QueryClientProvider>,
);
