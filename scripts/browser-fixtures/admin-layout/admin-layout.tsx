import { Route as Page0 } from "../../../src/routes/admin.index";
import { Route as Page1 } from "../../../src/routes/admin.leads";
import { Route as Page2 } from "../../../src/routes/admin.leads_.command-center";
import { Route as Page3 } from "../../../src/routes/admin.whatsapp";
import { Route as Page4 } from "../../../src/routes/admin.listings";
import { Route as Page5 } from "../../../src/routes/admin.listings_.new";
import { Route as Page6 } from "../../../src/routes/admin.listings_.$id";
import { Route as Page7 } from "../../../src/routes/admin.transactions";
import { Route as Page8 } from "../../../src/routes/admin.transactions_.new";
import { Route as Page9 } from "../../../src/routes/admin.transactions_.$id";
import { Route as Page10 } from "../../../src/routes/admin.analytics";
import { Route as Page11 } from "../../../src/routes/admin.blasts";
import { Route as Page12 } from "../../../src/routes/admin.cms";
import { Route as Page13 } from "../../../src/routes/admin.estates";
import { Route as Page14 } from "../../../src/routes/admin.estates_.new";
import { Route as Page15 } from "../../../src/routes/admin.estates_.$id";
import { Route as Page16 } from "../../../src/routes/admin.segments";
import { Route as Page17 } from "../../../src/routes/admin.whatsapp-links";
import { Route as Page18 } from "../../../src/routes/admin.whatsapp-settings";
import { Route as Page19 } from "../../../src/routes/admin.team";
import { Route as Page20 } from "../../../src/routes/admin.agents";
import { Route as Page21 } from "../../../src/routes/admin.agents_.new";
import { Route as Page22 } from "../../../src/routes/admin.agents_.$id";
import { Route as Page23 } from "../../../src/routes/admin.property-sync";
import { Route as Page24 } from "../../../src/routes/admin.operations";
import React from "react";
import { Toaster } from "sonner";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminShell } from "../../../src/components/admin/AdminShell";
import { AdminToolbar } from "../../../src/components/admin/AdminToolbar";
import { Button } from "../../../src/components/ui/button";
import { staffSessionStore } from "../../../src/components/admin/staff-session";
import { changeActor } from "../daily-work/auth";
import "../daily-work/synthetic-api";
import "../../../src/styles.css";

// A nonzero source count makes losing the collapsed badge observable.
const attentionFixture = window as unknown as {
  noLinkFixture: { attentionCounts: { leadsNeedingAttention: number } };
};
attentionFixture.noLinkFixture.attentionCounts.leadsNeedingAttention = 3;

// Same landmark ownership as __root.tsx. These are actual route components;
// only auth/API ports are synthetic. No normal-auth or database claim is made.
const root = createRootRoute({
  component: () => (
    <main>
      <Outlet />
    </main>
  ),
});
const router = createRouter({
  routeTree: root.addChildren([
    Page0.update({ id: "/admin", path: "/admin", getParentRoute: () => root } as never),
    Page1.update({ id: "/admin/leads", path: "/admin/leads", getParentRoute: () => root } as never),
    Page2.update({
      id: "/admin/leads/command-center",
      path: "/admin/leads/command-center",
      getParentRoute: () => root,
    } as never),
    Page3.update({
      id: "/admin/whatsapp",
      path: "/admin/whatsapp",
      getParentRoute: () => root,
    } as never),
    Page4.update({
      id: "/admin/listings",
      path: "/admin/listings",
      getParentRoute: () => root,
    } as never),
    Page5.update({
      id: "/admin/listings/new",
      path: "/admin/listings/new",
      getParentRoute: () => root,
    } as never),
    Page6.update({
      id: "/admin/listings/$id",
      path: "/admin/listings/$id",
      getParentRoute: () => root,
    } as never),
    Page7.update({
      id: "/admin/transactions",
      path: "/admin/transactions",
      getParentRoute: () => root,
    } as never),
    Page8.update({
      id: "/admin/transactions/new",
      path: "/admin/transactions/new",
      getParentRoute: () => root,
    } as never),
    Page9.update({
      id: "/admin/transactions/$id",
      path: "/admin/transactions/$id",
      getParentRoute: () => root,
    } as never),
    Page10.update({
      id: "/admin/analytics",
      path: "/admin/analytics",
      getParentRoute: () => root,
    } as never),
    Page11.update({
      id: "/admin/blasts",
      path: "/admin/blasts",
      getParentRoute: () => root,
    } as never),
    Page12.update({ id: "/admin/cms", path: "/admin/cms", getParentRoute: () => root } as never),
    Page13.update({
      id: "/admin/estates",
      path: "/admin/estates",
      getParentRoute: () => root,
    } as never),
    Page14.update({
      id: "/admin/estates/new",
      path: "/admin/estates/new",
      getParentRoute: () => root,
    } as never),
    Page15.update({
      id: "/admin/estates/$id",
      path: "/admin/estates/$id",
      getParentRoute: () => root,
    } as never),
    Page16.update({
      id: "/admin/segments",
      path: "/admin/segments",
      getParentRoute: () => root,
    } as never),
    Page17.update({
      id: "/admin/whatsapp-links",
      path: "/admin/whatsapp-links",
      getParentRoute: () => root,
    } as never),
    Page18.update({
      id: "/admin/whatsapp-settings",
      path: "/admin/whatsapp-settings",
      getParentRoute: () => root,
    } as never),
    Page19.update({ id: "/admin/team", path: "/admin/team", getParentRoute: () => root } as never),
    Page20.update({
      id: "/admin/agents",
      path: "/admin/agents",
      getParentRoute: () => root,
    } as never),
    Page21.update({
      id: "/admin/agents/new",
      path: "/admin/agents/new",
      getParentRoute: () => root,
    } as never),
    Page22.update({
      id: "/admin/agents/$id",
      path: "/admin/agents/$id",
      getParentRoute: () => root,
    } as never),
    Page23.update({
      id: "/admin/property-sync",
      path: "/admin/property-sync",
      getParentRoute: () => root,
    } as never),
    Page24.update({
      id: "/admin/operations",
      path: "/admin/operations",
      getParentRoute: () => root,
    } as never),
    createRoute({
      getParentRoute: () => root,
      path: "/__layout-probe",
      component: () => (
        <AdminShell
          title={"長標題測試".repeat(16)}
          description={"說明內容需要完整換行。".repeat(12)}
          actions={
            <>
              {[1, 2, 3].map((i) => (
                <Button
                  key={i}
                  onClick={() => {
                    document.documentElement.dataset.clicked = String(i);
                  }}
                >{`第${i}個主要工作操作`}</Button>
              ))}
            </>
          }
        >
          <AdminToolbar
            filters={
              <label>
                搜尋
                <input aria-label="搜尋" />
              </label>
            }
          />
          <p>實際共用元件的邊界情況</p>
        </AdminShell>
      ),
    }),
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
// All browser network access is also restricted by the owned test helper.
window.fetch = async () => {
  throw new Error("Unexpected fixture network request");
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
    <Toaster />
  </QueryClientProvider>,
);
