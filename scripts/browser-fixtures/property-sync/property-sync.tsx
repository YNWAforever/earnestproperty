import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Route as Sync } from "../../../src/routes/admin.property-sync";
import { staffSessionStore } from "../../../src/components/admin/staff-session";
import { changeActor } from "./synthetic-api";
import "../../../src/styles.css";

const root = createRootRoute({ component: () => <Outlet /> });
const router = createRouter({
  routeTree: root.addChildren([
    Sync.update({
      id: "/admin/property-sync",
      path: "/admin/property-sync",
      getParentRoute: () => root,
    } as never),
  ]),
  defaultPreload: false,
});
window.syncFixture.changeActor = async (id, role) => {
  changeActor(id, role);
  await staffSessionStore.refresh(id);
};
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
