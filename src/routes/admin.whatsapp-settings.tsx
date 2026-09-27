import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { StaffMappingWizard } from "@/components/admin/whatsapp/StaffMappingWizard";
import { WhatsappServicePolicyEditor } from "@/components/admin/WhatsappServicePolicyEditor";
import { fetchAdminAgents } from "@/lib/neon/admin-data";
import { useNeonAuth } from "@/hooks/use-neon-auth";

export const Route = createFileRoute("/admin/whatsapp-settings")({
  component: WhatsappSettings,
  head: () => ({
    meta: [
      { title: "WhatsApp 映射設定 | Earnest Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function WhatsappSettings() {
  const { user, loading } = useNeonAuth();
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof fetchAdminAgents>>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (loading || !user) return;
    let live = true;
    fetchAdminAgents()
      .then((rows) => {
        if (live) setAgents(rows);
      })
      .catch(() => {
        if (live) setError("未能載入同事；需要管理員／經理權限及已套用的資料庫遷移。");
      });
    return () => {
      live = false;
    };
  }, [user, loading]);
  return (
    <AdminShell
      title="WhatsApp 同事映射"
      description="核對實際 Inbox 帳戶、獨立通知目的地與核實證據。"
    >
      <div className="space-y-4">
        <p className="rounded border p-3 text-sm">
          自動分派仍需核實 WOZTELL
          執行／查證介面及人工改派政策。儲存映射不會執行分派；試送只有明確提交才會進入專用工作佇列。
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {agents.length ? <StaffMappingWizard agents={agents} /> : null}
        <WhatsappServicePolicyEditor agents={agents} />
      </div>
    </AdminShell>
  );
}
