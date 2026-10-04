import { useWorkspaceCurrent } from "@/hooks/use-workspace-current";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchStaffReferences,
  createStaffReference,
  disableStaffReference,
} from "@/lib/neon/staff-reference-admin";
export function StaffReferenceEditor({
  agents,
  selectedStaffId,
  isWorkspaceCurrent,
}: {
  agents: { id: string; name: string | null; active: boolean }[];
  selectedStaffId?: string;
  isWorkspaceCurrent?: () => boolean;
}) {
  const isCurrent = useWorkspaceCurrent(isWorkspaceCurrent);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchStaffReferences>>>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      namespace: "",
      externalReference: "",
      staffId: "",
      verificationRef: "",
    });
  useEffect(() => {
    if (selectedStaffId)
      setForm({
        namespace: "",
        externalReference: "",
        staffId: selectedStaffId,
        verificationRef: "",
      });
  }, [selectedStaffId]);
  useEffect(() => {
    let active = true;
    fetchStaffReferences(isCurrent)
      .then((r) => {
        if (active && isCurrent()) setRows(r);
      })
      .catch(() => {
        if (active && isCurrent()) setError("未能載入代碼映射，請核對遷移及管理權限。");
      });
    return () => {
      active = false;
    };
  }, [isCurrent]);
  return (
    <section aria-label="同事來源代碼映射" className="space-y-3 border-t pt-4">
      <h2 className="font-semibold">同事來源代碼映射</h2>
      <p className="text-sm">
        來源／帳戶及代碼必須完全一致，前置零和標點會保留。公開姓名、電話及物業預設同事不會取代指定同事。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <form
        className="grid max-w-xl gap-2"
        onSubmit={async (e) => {
          if (!isCurrent()) return;
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await createStaffReference(form, isCurrent);
            if (!isCurrent()) return;
            const workspaceResult = await fetchStaffReferences(isCurrent);
            if (!isCurrent()) return;
            setRows(workspaceResult);
          } catch {
            if (!isCurrent()) return;
            setError("未能儲存，請檢查映射是否重疊及核實證據。");
          } finally {
            if (isCurrent()) {
              setBusy(false);
            }
          }
        }}
      >
        <label>
          來源／帳戶
          <select
            required
            value={form.namespace.split("/")[0] ?? ""}
            onChange={(e) =>
              setForm({ ...form, namespace: e.target.value ? `${e.target.value}/` : "" })
            }
          >
            <option value="">選擇來源</option>
            <option value="28hse">28Hse</option>
            <option value="youtube">YouTube</option>
            <option value="website">網站</option>
            <option value="other">其他已核實來源</option>
          </select>
        </label>
        <label>
          來源帳戶識別碼
          <Input
            required
            maxLength={120}
            value={form.namespace.split("/").slice(1).join("/")}
            onChange={(e) =>
              setForm({ ...form, namespace: `${form.namespace.split("/")[0]}/${e.target.value}` })
            }
          />
        </label>
        <label>
          原始同事代碼
          <Input
            required
            maxLength={160}
            value={form.externalReference}
            onChange={(e) => setForm({ ...form, externalReference: e.target.value })}
          />
        </label>
        <label>
          核實紀錄編號
          <Input
            required
            maxLength={160}
            value={form.verificationRef}
            onChange={(e) => setForm({ ...form, verificationRef: e.target.value })}
          />
        </label>
        <label className={selectedStaffId ? "hidden" : undefined}>
          同事
          <select
            required
            value={form.staffId}
            onChange={(e) => setForm({ ...form, staffId: e.target.value })}
          >
            <option value="">選擇同事</option>
            {agents
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
          </select>
        </label>
        <Button disabled={busy}>儲存核實映射</Button>
      </form>
      {rows
        .filter((r) => !selectedStaffId || String(r.staff_id) === selectedStaffId)
        .map((r) => (
          <article className="rounded border p-2 text-sm" key={String(r.id)}>
            {String(r.namespace)} / {String(r.external_reference)} →{" "}
            {String(r.staff_name ?? r.staff_id)} · v{String(r.mapping_version)} ·{" "}
            {r.valid_until ? "已停用" : "有效"} · 生效 {String(r.valid_from)} · 核實{" "}
            {String(r.verified_at ?? "未核實")}
            <p>映射編號：{String(r.id)}</p>
            {!r.valid_until ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (!isCurrent()) return;
                  setBusy(true);
                  try {
                    await disableStaffReference({ id: String(r.id) }, isCurrent);
                    if (!isCurrent()) return;
                    const workspaceResult = await fetchStaffReferences(isCurrent);
                    if (!isCurrent()) return;
                    setRows(workspaceResult);
                  } catch {
                    if (!isCurrent()) return;
                    setError("停用未完成，請重新核對。");
                  } finally {
                    if (isCurrent()) {
                      setBusy(false);
                    }
                  }
                }}
              >
                停用映射
              </Button>
            ) : null}
          </article>
        ))}
    </section>
  );
}
