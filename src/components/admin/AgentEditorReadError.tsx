import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { AdminShell } from "./AdminShell";
import { Button } from "@/components/ui/button";

export function AgentEditorReadError({ title, reset }: { title: string; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  return (
    <AdminShell
      title={title}
      description="讀取失敗，可重新載入代理編輯資料。"
      contentWidth="form"
      breadcrumb={
        <nav aria-label="麵包屑">
          <Link to="/admin">後台</Link>
          {" › "}
          <Link to="/admin/agents">經紀檔案</Link>
          {" › "}
          {title}
        </nav>
      }
    >
      <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4">
        <p>未能載入代理編輯權限。請重試或返回經紀檔案。</p>
        <Button
          type="button"
          variant="outline"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await router.invalidate();
              reset();
            } finally {
              setRetrying(false);
            }
          }}
        >
          重新載入編輯權限
        </Button>
      </div>
    </AdminShell>
  );
}
