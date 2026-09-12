import { StaffEndpointEditor } from "@/components/admin/StaffEndpointEditor";
import { StaffReferenceEditor } from "@/components/admin/StaffReferenceEditor";
import { WhatsappServicePolicyEditor } from "@/components/admin/WhatsappServicePolicyEditor";
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWhatsappStaffChannels, saveWhatsappStaffChannel } from "@/lib/neon/whatsapp-assignment";
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
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getWhatsappStaffChannels>>>([]);
  const [agents, setAgents] = useState<Awaited<ReturnType<typeof fetchAdminAgents>>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    staffId: "",
    inboxUserId: "",
    folderId: "",
    routingNodeId: "",
    branchId: "",
    verificationRef: "",
    eligible: false,
  });
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    Promise.all([getWhatsappStaffChannels(), fetchAdminAgents()])
      .then(([r, a]) => {
        if (!cancelled) {
          setRows(r);
          setAgents(a);
        }
      })
      .catch(() => {
        if (!cancelled) setError("未能載入；需要管理員／經理權限及已套用的資料庫遷移。");
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
  return (
    <AdminShell
      title="WhatsApp 同事映射"
      description="核對實際 Inbox 帳戶、資料夾及節點。公開電話或姓名不能證明帳戶映射。"
    >
      <div className="space-y-4">
        <p className="rounded border p-3 text-sm">
          自動分派仍未開放：需要核實 WOZTELL 執行／查證介面及人工改派政策。儲存映射不會執行分派。
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <form
          className="grid max-w-2xl gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await saveWhatsappStaffChannel({ ...form, branchId: form.branchId || null });
              setRows(await getWhatsappStaffChannels());
            } catch {
              setError("未能儲存，請核對同事及映射證據。");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            同事
            <select
              required
              className="ml-2 rounded border p-2"
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            >
              <option value="">選擇在職同事</option>
              {agents
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id}
                  </option>
                ))}
            </select>
          </label>
          {(
            [
              ["inboxUserId", "實際 Inbox User ID"],
              ["folderId", "已核對 Folder ID"],
              ["routingNodeId", "已核對 Routing Node ID"],
              ["branchId", "分行識別碼"],
              ["verificationRef", "核實紀錄編號"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <Input
                required={key !== "branchId"}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={form.eligible}
              onChange={(e) => setForm({ ...form, eligible: e.target.checked })}
            />{" "}
            已核實映射及當值安排，可列為候選人
          </label>
          <Button disabled={busy}>儲存核實紀錄</Button>
        </form>
        {rows.map((r) => (
          <article className="rounded border p-3 text-sm" key={String(r.id)}>
            {String(r.name ?? r.staff_id)} · Inbox {String(r.inbox_user_id)} ·{" "}
            {r.eligible ? "候選人" : "不參與分派"} · 核實時間 {String(r.verified_at ?? "未核實")}
            <Button
              variant="outline"
              className="ml-3"
              onClick={() =>
                setForm({
                  staffId: String(r.staff_id),
                  inboxUserId: String(r.inbox_user_id),
                  folderId: String(r.folder_id),
                  routingNodeId: String(r.routing_node_id),
                  branchId: String(r.branch_id ?? ""),
                  verificationRef: "",
                  eligible: false,
                })
              }
            >
              重新核實／停用
            </Button>
          </article>
        ))}
        <StaffReferenceEditor agents={agents} />
        <StaffEndpointEditor agents={agents} />
        <WhatsappServicePolicyEditor agents={agents} />
      </div>
    </AdminShell>
  );
}
