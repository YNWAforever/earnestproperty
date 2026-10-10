import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell, AdminError } from "@/components/admin/AdminShell";
import { AdminPropertyWorkspace } from "@/components/admin/AdminPropertyWorkspace";
import { Button } from "@/components/ui/button";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { staffSessionStore, useStaffSession } from "@/components/admin/staff-session";
import { fetchAdminManagedProperty } from "@/lib/neon/admin-properties";
import type { ManagedPropertyDetail } from "@/lib/neon/admin-properties.types";
export const Route = createFileRoute("/admin/listings_/$id")({
  head: () => ({
    meta: [{ title: "管理物業｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: EditAdminListingPage,
});
function EditAdminListingPage() {
  const { id } = Route.useParams();
  const { user } = useNeonAuth();
  const { session } = useStaffSession(user?.id ?? null);
  if (!user || session?.status !== "ok")
    return (
      <AdminShell title="管理物業" description="共用物業資料，獨立管理出售與出租。">
        {null}
      </AdminShell>
    );
  const identity = JSON.stringify([user.id, session.staffId, [...session.roles].sort()]);
  return <EditAdminListingWorkspace key={`${id}:${identity}`} identity={identity} />;
}
function EditAdminListingWorkspace({ identity }: { identity: string }) {
  const { id } = Route.useParams();
  const { user, loading } = useNeonAuth();
  const userId = user?.id ?? null;
  const active = useRef(false);
  const unavailable = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const isWorkspaceCurrent = useCallback(() => {
    const current = staffSessionStore.getSnapshot();
    return (
      active.current &&
      !unavailable.current &&
      current.session?.status === "ok" &&
      JSON.stringify([
        current.userId,
        current.session.staffId,
        [...current.session.roles].sort(),
      ]) === identity
    );
  }, [identity]);
  const [property, setProperty] = useState<ManagedPropertyDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    unavailable.current = false;
    setProperty(null);
    setError(null);
    if (loading || !userId || !isWorkspaceCurrent()) {
      setFetching(loading);
      return () => {
        cancelled = true;
      };
    }
    setFetching(true);
    fetchAdminManagedProperty({ data: { id } })
      .then((data) => {
        if (!cancelled && isWorkspaceCurrent()) setProperty(data);
      })
      .catch((e) => {
        if (!cancelled && isWorkspaceCurrent())
          setError(e instanceof Error ? e.message : "未能載入物業");
      })
      .finally(() => {
        if (!cancelled && isWorkspaceCurrent()) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId, loading, retry, isWorkspaceCurrent]);
  return (
    <AdminShell
      title="管理物業"
      description="共用物業資料，獨立管理出售與出租。"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin/listings">樓盤管理</Link>
          {" › 管理物業"}
        </nav>
      }
    >
      <Button asChild variant="ghost" className="mb-4">
        <Link to="/admin/listings">返回物業列表</Link>
      </Button>
      {loading || fetching ? <p role="status">正在載入物業…</p> : null}
      {error ? (
        <>
          <AdminError message={error} />
          <Button onClick={() => setRetry((v) => v + 1)}>重新載入</Button>
        </>
      ) : null}
      {!loading && !fetching && !error && !property ? <p>找不到物業或沒有存取權限。</p> : null}
      {property ? (
        <AdminPropertyWorkspace
          key={`${id}:${retry}`}
          initial={property}
          sourceId={id}
          isWorkspaceCurrent={isWorkspaceCurrent}
          onUnavailable={() => {
            if (!isWorkspaceCurrent()) return;
            unavailable.current = true;
            setProperty(null);
            setFetching(false);
            setError(null);
          }}
        />
      ) : null}
    </AdminShell>
  );
}
