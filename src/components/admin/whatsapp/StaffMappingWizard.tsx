import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffEndpointEditor } from "@/components/admin/StaffEndpointEditor";
import { StaffReferenceEditor } from "@/components/admin/StaffReferenceEditor";
import { StaffReadinessBadge } from "./StaffReadinessBadge";
import { StaffTestNotificationDialog } from "./StaffTestNotificationDialog";
import { getWhatsappStaffChannels, saveWhatsappStaffChannel } from "@/lib/neon/whatsapp-assignment";
import { getWhatsappStaffReadiness } from "@/lib/neon/whatsapp-readiness";
import { fetchStaffEndpoints } from "@/lib/neon/staff-endpoints";

type Agent = { id: string; name: string | null; active: boolean };
export function StaffMappingWizard({ agents }: { agents: Agent[] }) {
  const [step, setStep] = useState(0);
  const [staffId, setStaffId] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getWhatsappStaffChannels>>>([]);
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof getWhatsappStaffReadiness>>>(
    [],
  );
  const [endpoints, setEndpoints] = useState<Awaited<ReturnType<typeof fetchStaffEndpoints>>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    inboxUserId: "",
    folderId: "",
    routingNodeId: "",
    branchId: "",
    verificationRef: "",
    eligible: false,
  });
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("staff");
    if (id && agents.some((a) => a.id === id && a.active)) setStaffId(id);
  }, [agents]);
  useEffect(() => {
    let live = true;
    Promise.all([getWhatsappStaffChannels(), getWhatsappStaffReadiness(), fetchStaffEndpoints()])
      .then(([channels, capabilities, destinations]) => {
        if (!live) return;
        setRows(channels);
        setReadiness(capabilities);
        setEndpoints(destinations);
      })
      .catch(() => {
        if (live) setError("未能載入映射與通知設定；請檢查管理權限及資料庫遷移。");
      });
    return () => {
      live = false;
    };
  }, []);
  const selected = agents.find((a) => a.id === staffId);
  const capability = readiness.find((r) => r.staffId === staffId);
  const endpointVersion = (transport: "inbox_private_note" | "staff_whatsapp") =>
    endpoints.find((e) => e.staffId === staffId && e.transport === transport && !e.retired)
      ?.version ?? null;
  const titles = ["選同事", "連接 Inbox", "通知方式", "核實與試送"];
  return (
    <section aria-label="同事接收設定步驟" className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">同事接收設定</h2>
      <ol className="flex flex-wrap gap-2 text-sm">
        {titles.map((title, index) => (
          <li
            key={title}
            aria-current={index === step ? "step" : undefined}
            className={index === step ? "font-semibold" : "text-muted-foreground"}
          >
            {index + 1}. {title}
          </li>
        ))}
      </ol>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {step === 0 ? (
        <label className="block max-w-md">
          同事姓名
          <select
            className="mt-1 block w-full rounded border p-2"
            value={staffId}
            onChange={(e) => {
              setStaffId(e.target.value);
              setForm({
                inboxUserId: "",
                folderId: "",
                routingNodeId: "",
                branchId: "",
                verificationRef: "",
                eligible: false,
              });
              setError("");
            }}
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
      ) : null}
      {step === 1 && selected ? (
        <div className="space-y-3">
          <p className="text-sm">
            為 {selected.name ?? selected.id} 核對實際 Inbox User ID 與 Folder。Routing Node
            用於供應商路由；分行 ID 用於限定團隊範圍。姓名相同不代表同一供應商帳戶。
          </p>
          <form
            className="grid max-w-xl gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await saveWhatsappStaffChannel({
                  staffId,
                  ...form,
                  branchId: form.branchId || null,
                });
                setRows(await getWhatsappStaffChannels());
                setReadiness(await getWhatsappStaffReadiness());
                setStep(2);
              } catch {
                setError("映射未能儲存；請核對同事、Inbox 帳戶、Folder 及核實紀錄。");
              } finally {
                setBusy(false);
              }
            }}
          >
            {(
              [
                ["inboxUserId", "實際 Inbox User ID"],
                ["folderId", "已核對 Folder ID"],
                ["routingNodeId", "Routing Node ID（如使用節點路由）"],
                ["branchId", "分行 ID（如限定分行）"],
                ["verificationRef", "核實紀錄編號"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  required={
                    key === "inboxUserId" || key === "folderId" || key === "verificationRef"
                  }
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
              已核實且可列為分派候選人
            </label>
            <Button disabled={busy}>儲存 Inbox 映射</Button>
          </form>
          <h3 className="font-medium">現有映射</h3>
          {rows
            .filter((r) => String(r.staff_id) === staffId)
            .map((r) => (
              <article className="rounded border p-2 text-sm" key={String(r.id)}>
                Inbox {String(r.inbox_user_id)} · Folder {String(r.folder_id)} ·{" "}
                {r.eligible ? "可候選" : "不參與分派"} · 核實 {String(r.verified_at ?? "未核實")}
                <Button
                  type="button"
                  variant="outline"
                  className="ml-2"
                  onClick={() =>
                    setForm({
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
        </div>
      ) : null}
      {step === 2 && selected ? (
        <div className="space-y-4">
          <p className="text-sm">
            為 {selected.name ?? selected.id} 設定來源代碼與接收端。Inbox 私有備註及同事 WhatsApp
            需要各自核實的目的地。
          </p>
          <StaffReferenceEditor agents={agents} selectedStaffId={staffId} />
          <StaffEndpointEditor agents={agents} selectedStaffId={staffId} />
        </div>
      ) : null}
      {step === 3 && selected ? (
        <div className="space-y-3">
          <p>核實 {selected.name ?? selected.id} 的能力與試送預覽。開啟或儲存此頁不會發送訊息。</p>
          {capability ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StaffReadinessBadge label="Inbox 分派" capability={capability.assignment} />
              <StaffReadinessBadge
                label="Inbox 私有備註"
                capability={capability.inboxPrivateNote}
              />
              <StaffReadinessBadge label="同事 WhatsApp" capability={capability.staffWhatsapp} />
            </div>
          ) : (
            <p role="alert">未能讀取此同事能力。</p>
          )}
          <p className="text-sm">
            同事手機：{capability?.maskedDestination ?? "未設定"}。供應商接納後仍須核對實際送達。
          </p>
          <StaffTestNotificationDialog
            key={`${staffId}:inbox`}
            staffId={staffId}
            transport="inbox_private_note"
            endpointVersion={endpointVersion("inbox_private_note")}
          />
          <StaffTestNotificationDialog
            key={`${staffId}:wa`}
            staffId={staffId}
            transport="staff_whatsapp"
            endpointVersion={endpointVersion("staff_whatsapp")}
          />
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                setReadiness(await getWhatsappStaffReadiness());
                setEndpoints(await fetchStaffEndpoints());
                setError("");
              } catch {
                setError("重新核對失敗，請稍後再試。");
              }
            }}
          >
            重新核對能力與端點版本
          </Button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || busy}
          onClick={() => setStep(step - 1)}
        >
          上一步
        </Button>
        <Button
          type="button"
          disabled={!staffId || step === 3 || busy}
          onClick={async () => {
            if (step === 2) {
              try {
                setEndpoints(await fetchStaffEndpoints());
                setReadiness(await getWhatsappStaffReadiness());
              } catch {
                setError("未能核對端點。");
                return;
              }
            }
            setStep(step + 1);
          }}
        >
          下一步
        </Button>
      </div>
    </section>
  );
}
