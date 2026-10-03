import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { Route as Listings } from "../../../src/routes/admin.listings";
import { Route as Detail } from "../../../src/routes/admin.listings_.$id";
import { Route as Operations } from "../../../src/routes/admin.operations";
import "../../../src/styles.css";

const root = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
});
const router = createRouter({
  routeTree: root.addChildren([
    Operations.update({
      id: "/admin/operations",
      path: "/admin/operations",
      getParentRoute: () => root,
    } as never),
    Listings.update({
      id: "/admin/listings",
      path: "/admin/listings",
      getParentRoute: () => root,
    } as never),
    Detail.update({
      id: "/admin/listings/$id",
      path: "/admin/listings/$id",
      getParentRoute: () => root,
    } as never),
  ]),
  defaultPreload: false,
});
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
