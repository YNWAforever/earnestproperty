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
}: {
  agents: { id: string; name: string | null; active: boolean }[];
}) {
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
    let active = true;
    fetchStaffReferences()
      .then((r) => {
        if (active) setRows(r);
      })
      .catch(() => {
        if (active) setError("未能載入代碼映射，請核對遷移及管理權限。");
      });
    return () => {
      active = false;
    };
  }, []);
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
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await createStaffReference(form);
            setRows(await fetchStaffReferences());
          } catch {
            setError("未能儲存，請檢查映射是否重疊及核實證據。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {(
          [
            ["namespace", "來源／帳戶命名空間"],
            ["externalReference", "原始同事代碼"],
            ["verificationRef", "核實紀錄編號"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <Input
              required
              maxLength={160}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
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
      {rows.map((r) => (
        <article className="rounded border p-2 text-sm" key={String(r.id)}>
          {String(r.namespace)} / {String(r.external_reference)} →{" "}
          {String(r.staff_name ?? r.staff_id)} · v{String(r.mapping_version)} ·{" "}
          {r.valid_until ? "已停用" : "有效"}
          <p>映射編號：{String(r.id)}</p>
          {!r.valid_until ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await disableStaffReference({ id: String(r.id) });
                  setRows(await fetchStaffReferences());
                } catch {
                  setError("停用未完成，請重新核對。");
                } finally {
                  setBusy(false);
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
