import { useEffect, useRef, useState } from "react";
import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { loading, user, session } = useNeonAuth();
  const router = useRouter();
  const identity = user ? user.id + ":" + (session?.id ?? "none") : null;
  const lastSettledIdentity = useRef<string | null | undefined>(undefined);
  const [validatedIdentity, setValidatedIdentity] = useState<string | null>(identity);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    if (loading || lastSettledIdentity.current === identity) return;
    const previousIdentity = lastSettledIdentity.current;
    lastSettledIdentity.current = identity;
    if (previousIdentity === undefined || identity === null) {
      setValidatedIdentity(identity);
      setRefreshFailed(false);
      return;
    }

    let active = true;
    setValidatedIdentity(null);
    setRefreshFailed(false);
    void router.invalidate().then(
      () => {
        if (active) setValidatedIdentity(identity);
      },
      () => {
        if (active) setRefreshFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [identity, loading, router]);

  const identityChanging =
    identity !== null &&
    (validatedIdentity !== identity ||
      (lastSettledIdentity.current !== undefined && lastSettledIdentity.current !== identity));
  if (identityChanging) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8" role={refreshFailed ? "alert" : "status"}>
        {refreshFailed ? "無法更新後台資料，請重新載入頁面。" : "正在更新後台資料…"}
      </div>
    );
  }

  return <Outlet key={identity ?? "anonymous"} />;
}
