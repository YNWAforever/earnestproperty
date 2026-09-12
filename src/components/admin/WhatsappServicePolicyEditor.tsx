import { useEffect, useState } from "react";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  draftServicePolicy,
  calculateServiceSchedule,
  type ServicePolicy,
  type ServiceRules,
} from "@/lib/whatsapp-enquiries/service-policy";
import { SERVICE_COPY } from "@/lib/whatsapp-enquiries/service-copy";
import {
  getWhatsappServicePolicies,
  saveWhatsappServicePolicy,
  approveWhatsappServicePolicy,
} from "@/lib/neon/whatsapp-service-policy";
const choices = [
  ["durationMode", "三小時計算", ["elapsed", "opening"]],
  ["beforeOpen", "08:00 前", ["overnight", "daytime"]],
  ["atOpen", "正好開門時間", ["daytime", "overnight"]],
  ["atClose", "正好關門時間", ["overnight", "daytime"]],
  ["crossClosing", "日間期限跨越關門", ["opening", "elapsed"]],
  ["reception", "總台查詢", ["excluded", "sales"]],
] as const;
const labels: Record<string, string> = {
  elapsed: "實際經過時間",
  opening: "只計營業時間",
  overnight: "套用隔夜規則",
  daytime: "套用日間規則",
  excluded: "不參與服務計時",
  sales: "採用銷售規則",
};
export function WhatsappServicePolicyEditor({
  agents,
}: {
  agents: { id: string; name: string | null; active: boolean; roles: string[] }[];
}) {
  const { user, loading } = useNeonAuth();
  const [policies, setPolicies] = useState<ServicePolicy[]>([]),
    [policy, setPolicy] = useState(draftServicePolicy),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sample, setSample] = useState("2026-09-14T23:00:00+08:00"),
    [entry, setEntry] = useState<"sales" | "reception">("sales"),
    [evidence, setEvidence] = useState(""),
    [effective, setEffective] = useState("");
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    getWhatsappServicePolicies()
      .then((p) => {
        if (!cancelled) setPolicies(p);
      })
      .catch(() => {
        if (!cancelled) setError("尚未載入政策，請確認權限及遷移狀態。");
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
  const update = <K extends keyof ServiceRules>(key: K, value: ServiceRules[K]) =>
    setPolicy((p) => ({
      ...p,
      id: "",
      status: "draft",
      approvedBy: null,
      effectiveAt: null,
      rules: { ...p.rules, [key]: value },
    }));
  const simulate = calculateServiceSchedule(
    {
      ...policy,
      status: "approved",
      approvedBy: "SIMULATION_ONLY",
      effectiveAt: "2000-01-01T00:00:00Z",
      copyVersion: policy.copyVersion ?? "SIMULATION_ONLY",
    },
    { occurredAt: sample, receivedAt: sample, entryPointType: entry },
    new Date(sample),
  );
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setPolicies(await getWhatsappServicePolicies());
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成；請核對政策資料。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-8 space-y-4 border-t pt-6" aria-label="服務政策及模擬器">
      <h2 className="text-xl font-semibold">服務政策及模擬器</h2>
      <p className="text-sm text-muted-foreground">
        所有預設均為草稿。模擬不代表批准；批准政策也不會啟動發送。隔夜服務問題固定為下一營業日
        10:00，與首次回覆期限分開。
      </p>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <label className="block">
        載入版本
        <select
          className="ml-2 rounded border p-2"
          value={policy.id}
          onChange={(e) => {
            setPolicy(policies.find((p) => p.id === e.target.value) ?? draftServicePolicy());
            setEvidence("");
          }}
        >
          <option value="">新草稿</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              v{p.version} · {p.status} · {p.copyVersion ?? "文案未核實"}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          時區
          <Input
            value={policy.rules.timezone ?? ""}
            onChange={(e) => update("timezone", e.target.value || null)}
          />
        </label>
        {choices.map(([key, label, values]) => (
          <label key={key}>
            {label}
            <select
              className="ml-2 rounded border p-2"
              value={policy.rules[key] ?? ""}
              onChange={(e) => update(key, (e.target.value || null) as never)}
            >
              <option value="">尚未決定</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
        ))}
        <fieldset>
          <legend>已核對的營業日</legend>
          {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
            <label key={d} className="mr-3">
              <input
                type="checkbox"
                checked={policy.rules.weekdays?.includes(i) ?? false}
                onChange={(e) =>
                  update(
                    "weekdays",
                    e.target.checked
                      ? [...(policy.rules.weekdays ?? []), i]
                      : (policy.rules.weekdays ?? []).filter((x) => x !== i),
                  )
                }
              />
              {d}
            </label>
          ))}
        </fieldset>
        <label>
          假期（YYYY-MM-DD，以逗號分隔）
          <Input
            value={(policy.rules.holidays ?? []).join(",")}
            onChange={(e) =>
              update(
                "holidays",
                e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
          <input
            type="checkbox"
            checked={policy.rules.holidays !== null}
            onChange={(e) => update("holidays", e.target.checked ? [] : null)}
          />{" "}
          已核對假期表（可為空）
        </label>
        {(
          [
            ["freshnessSeconds", "可接受來訊延遲（秒）"],
            ["surveyExpirySeconds", "問卷有效時間（秒）"],
            ["workerLagSeconds", "工作佇列容許延遲（秒）"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <Input
              type="number"
              min={1}
              value={policy.rules[key] ?? ""}
              onChange={(e) => update(key, e.target.value ? Number(e.target.value) : null)}
            />
          </label>
        ))}
        <label>
          人手已回覆後的問卷
          <select
            className="ml-2 rounded border p-2"
            value={
              policy.rules.suppressSurveyAfterHuman === null
                ? ""
                : String(policy.rules.suppressSurveyAfterHuman)
            }
            onChange={(e) =>
              update(
                "suppressSurveyAfterHuman",
                e.target.value === "" ? null : e.target.value === "true",
              )
            }
          >
            <option value="">尚未決定</option>
            <option value="false">仍發送原定服務問題</option>
            <option value="true">抑制並保留原因</option>
          </select>
        </label>
        <label>
          負責經理
          <select
            className="ml-2 rounded border p-2"
            value={policy.rules.managerStaffId ?? ""}
            onChange={(e) => update("managerStaffId", e.target.value || null)}
          >
            <option value="">尚未核實</option>
            {agents
              .filter((a) => a.active && a.roles.includes("manager"))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
          </select>
        </label>
        <label>
          文案版本
          <Input
            value={policy.copyVersion ?? ""}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                id: "",
                status: "draft",
                copyVersion: e.target.value || null,
              }))
            }
          />
        </label>
        <label className="md:col-span-2">
          待批准的非辦公時間文案
          <Textarea
            value={policy.copy.afterHours ?? ""}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
                id: "",
                status: "draft",
                copy: { afterHours: e.target.value || null },
              }))
            }
          />
        </label>
      </div>
      <details>
        <summary>原始服務文案</summary>
        {Object.entries(SERVICE_COPY).map(([k, text]) => (
          <p key={k} className="my-3 whitespace-pre-wrap rounded border p-3 text-sm">
            {text}
          </p>
        ))}
      </details>
      <Button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            setPolicy(
              await saveWhatsappServicePolicy({
                rules: policy.rules,
                afterHoursCopy: policy.copy.afterHours,
                copyVersion: policy.copyVersion,
              }),
            );
          })
        }
      >
        儲存為新草稿
      </Button>
      <fieldset className="space-y-2 rounded border p-4">
        <legend>假設政策已批准的模擬（不儲存、不發送）</legend>
        <Input
          aria-label="帶時區的測試來訊時間"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        <select
          aria-label="模擬入口"
          value={entry}
          onChange={(e) => setEntry(e.target.value as typeof entry)}
        >
          <option value="sales">銷售</option>
          <option value="reception">總台</option>
        </select>
        <pre className="overflow-auto text-xs">{JSON.stringify(simulate, null, 2)}</pre>
      </fieldset>
      {policy.id && policy.status === "draft" ? (
        <fieldset className="space-y-2 rounded border p-4">
          <legend>批准此版本</legend>
          <p className="text-sm">
            確認 D-01 至 D-09 決定及文案已獲業務負責人核准。批准不會更改運行中的功能開關。
          </p>
          <Input
            aria-label="批准紀錄編號"
            placeholder="批准紀錄編號"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
          <Input
            aria-label="生效時間含時區"
            placeholder="2026-09-20T08:00:00+08:00"
            value={effective}
            onChange={(e) => setEffective(e.target.value)}
          />
          <Button
            disabled={busy || !evidence || !effective}
            onClick={() =>
              void action(async () => {
                await approveWhatsappServicePolicy({
                  id: policy.id,
                  version: policy.version,
                  effectiveAt: effective,
                  decisionEvidenceRef: evidence,
                });
                setPolicy(draftServicePolicy());
              })
            }
          >
            記錄已核准政策
          </Button>
        </fieldset>
      ) : null}
    </section>
  );
}
