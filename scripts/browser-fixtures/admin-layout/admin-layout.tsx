import { Route as Page10 } from "../../../src/routes/admin.whatsapp";
import { Route as Page0 } from "../../../src/routes/admin.index";
import { Route as Page1 } from "../../../src/routes/admin.leads";
import { Route as Page2 } from "../../../src/routes/admin.listings_.new";
import { Route as Page3 } from "../../../src/routes/admin.listings_.$id";
import { Route as Page4 } from "../../../src/routes/admin.transactions_.new";
import { Route as Page5 } from "../../../src/routes/admin.transactions_.$id";
import { Route as Page6 } from "../../../src/routes/admin.estates_.new";
import { Route as Page7 } from "../../../src/routes/admin.estates_.$id";
import { Route as Page8 } from "../../../src/routes/admin.agents_.new";
import { Route as Page9 } from "../../../src/routes/admin.agents_.$id";
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
    Page10.update({
      id: "/admin/whatsapp",
      path: "/admin/whatsapp",
      getParentRoute: () => root,
    } as never),
    Page0.update({ id: "/admin", path: "/admin", getParentRoute: () => root } as never),
    Page1.update({ id: "/admin/leads", path: "/admin/leads", getParentRoute: () => root } as never),
    Page2.update({
      id: "/admin/listings/new",
      path: "/admin/listings/new",
      getParentRoute: () => root,
    } as never),
    Page3.update({
      id: "/admin/listings/$id",
      path: "/admin/listings/$id",
      getParentRoute: () => root,
    } as never),
    Page4.update({
      id: "/admin/transactions/new",
      path: "/admin/transactions/new",
      getParentRoute: () => root,
    } as never),
    Page5.update({
      id: "/admin/transactions/$id",
      path: "/admin/transactions/$id",
      getParentRoute: () => root,
    } as never),
    Page6.update({
      id: "/admin/estates/new",
      path: "/admin/estates/new",
      getParentRoute: () => root,
    } as never),
    Page7.update({
      id: "/admin/estates/$id",
      path: "/admin/estates/$id",
      getParentRoute: () => root,
    } as never),
    Page8.update({
      id: "/admin/agents/new",
      path: "/admin/agents/new",
      getParentRoute: () => root,
    } as never),
    Page9.update({
      id: "/admin/agents/$id",
      path: "/admin/agents/$id",
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
