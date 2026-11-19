import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Route as EstateEdit } from "../../../src/routes/admin.estates_.$id";
import { Route as EstateNew } from "../../../src/routes/admin.estates_.new";
import { PropertyForm } from "../../../src/components/dashboard/PropertyForm";
import { changeActor } from "./auth";
import { Route as Cms } from "../../../src/routes/admin.cms";
import { Route as TransactionNew } from "../../../src/routes/admin.transactions_.new";
import { Route as TransactionEdit } from "../../../src/routes/admin.transactions_.$id";
import { createRoute, Link } from "@tanstack/react-router";
import "../../../src/styles.css";

const root = createRootRoute({ component: () => <Outlet /> });
// The leave target: a plain page, so "navigation happened" is a visible fact.
const destination = createRoute({
  getParentRoute: () => root,
  path: "/admin/leads",
  component: () => (
    <>
      <h1>離開後的頁面</h1>
      <Link to="/admin/transactions/new">新增成交（測試連結）</Link>
    </>
  ),
});
const mount = (route: { update: (o: never) => unknown }, path: string) =>
  route.update({ id: path, path, getParentRoute: () => root } as never) as never;
Object.assign(window, { mediaFixture: { changeActor } });
const listing = createRoute({
  getParentRoute: () => root,
  path: "/__listing-image-test",
  component: () => (
    <PropertyForm
      property={{ images: ["/media-editor/fixture.png", "/media-editor/fixture.png?second"] }}
      onSaved={() => {}}
    />
  ),
});
const router = createRouter({
  routeTree: root.addChildren([
    mount(Cms, "/admin/cms"),
    mount(EstateEdit, "/admin/estates/$id"),
    mount(EstateNew, "/admin/estates/new"),
    listing,
    mount(TransactionNew, "/admin/transactions/new"),
    mount(TransactionEdit, "/admin/transactions/$id"),
    destination,
  ]),
  defaultPreload: false,
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
    <Toaster />
  </QueryClientProvider>,
);
