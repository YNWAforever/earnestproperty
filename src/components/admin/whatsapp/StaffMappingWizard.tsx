import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffEndpointEditor } from "@/components/admin/StaffEndpointEditor";
import { StaffReferenceEditor } from "@/components/admin/StaffReferenceEditor";
import { useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import { StaffReadinessBadge } from "./StaffReadinessBadge";
import { StaffTestNotificationDialog } from "./StaffTestNotificationDialog";
import { InboxAccountPicker } from "./InboxAccountPicker";
import { StaffConnectionSummary } from "./StaffConnectionSummary";
import {
  getWhatsappStaffChannels,
  retireWhatsappStaffChannel,
  saveReviewedWhatsappStaffChannel,
} from "@/lib/neon/whatsapp-assignment";
import {
  getInboxCandidates,
  getInboxFolders,
  saveNamedInboxFolder,
  verifyInboxCandidate,
} from "@/lib/neon/inbox-directory";
import { getWhatsappStaffReadiness } from "@/lib/neon/whatsapp-readiness";
import { fetchStaffEndpoints } from "@/lib/neon/staff-endpoints";
import type { InboxCandidate, InboxFolder } from "@/lib/neon/inbox-directory.types";
import {
  applyMappingConflict,
  canSaveReviewedMapping,
  switchWizardStaff,
  type ConnectionDraft,
} from "./staff-mapping-wizard-state";

type Agent = {
  id: string;
  name: string | null;
  email?: string | null;
  branch?: string | null;
  active: boolean;
};
const emptyDraft: ConnectionDraft = {
  staffId: "",
  userId: "",
  folderKey: "",
  review: null,
  dirty: false,
};
export function StaffMappingWizard({
  agents,
  initialStaffId,
  initialStep = 0,
  allowReviewedSave = true,
}: {
  agents: Agent[];
  initialStaffId?: string;
  initialStep?: number;
  allowReviewedSave?: boolean;
}) {
  const [step, setStep] = useState(initialStep);
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getWhatsappStaffChannels>>>([]);
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof getWhatsappStaffReadiness>>>(
    [],
  );
  const [endpoints, setEndpoints] = useState<Awaited<ReturnType<typeof fetchStaffEndpoints>>>([]);
  const [folders, setFolders] = useState<InboxFolder[]>([]);
  const [candidates, setCandidates] = useState<InboxCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [retireReason, setRetireReason] = useState("");
  const [folderForm, setFolderForm] = useState({
    folderKey: "",
    displayName: "",
    providerFolderId: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [folderSetupOpen, setFolderSetupOpen] = useState(false);
  const requestGeneration = useRef(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const hasUnsavedInput =
    draft.dirty || !!retireReason.trim() || Object.values(folderForm).some(Boolean);
  const { dialog: leaveGuard } = useRouteLeaveGuard(hasUnsavedInput);
  useEffect(() => {
    if (initialStaffId && agents.some((agent) => agent.id === initialStaffId && agent.active))
      setDraft((current) =>
        current.staffId ? current : switchWizardStaff(current, initialStaffId),
      );
  }, [agents, initialStaffId]);
  useEffect(() => {
    let live = true;
    Promise.all([
      getWhatsappStaffChannels(),
      getWhatsappStaffReadiness(),
      fetchStaffEndpoints(),
      getInboxFolders().catch(() => []),
    ])
      .then(([channels, capabilities, destinations, names]) => {
        if (!live) return;
        setRows(channels);
        setReadiness(capabilities);
        setEndpoints(destinations);
        setFolders(names);
      })
      .catch(() => {
        if (live) setError("未能載入連接設定；請檢查管理權限、公司連接及資料庫遷移。");
      });
    return () => {
      live = false;
    };
  }, []);
  const selected = agents.find((agent) => agent.id === draft.staffId);
  const mapping = rows.find((row) => row.staff_id === draft.staffId) ?? null;
  const version = mapping?.version ?? null;
  const selectedCandidate = candidates.find((item) => item.userId === draft.userId) ?? null;
  const selectedFolder = folders.find((item) => item.folderKey === draft.folderKey) ?? null;
  const capability = readiness.find((item) => item.staffId === draft.staffId);
  const endpointVersion = (transport: "inbox_private_note" | "staff_whatsapp") =>
    endpoints.find(
      (item) => item.staffId === draft.staffId && item.transport === transport && !item.retired,
    )?.version ?? null;
  const titles = ["選同事", "連接 Inbox", "通知方式", "核實與試送"];
  async function refresh() {
    const [channels, capabilities, destinations, names] = await Promise.all([
      getWhatsappStaffChannels(),
      getWhatsappStaffReadiness(),
      fetchStaffEndpoints(),
      getInboxFolders().catch(() => []),
    ]);
    setRows(channels);
    setReadiness(capabilities);
    setEndpoints(destinations);
    setFolders(names);
  }
  async function explain(errorValue: unknown, fallback: string) {
    const status =
      errorValue instanceof Response
        ? errorValue.status
        : errorValue && typeof errorValue === "object" && "status" in errorValue
          ? Number(errorValue.status)
          : null;
    if (status === 409) {
      let latest: { version?: number } | undefined;
      try {
        const body =
          errorValue instanceof Response
            ? ((await errorValue.json()) as { latest?: { version?: number } })
            : (errorValue as { latest?: { version?: number } });
        latest = body.latest ?? undefined;
      } catch {
        /* Server functions may wrap response bodies. */
      }
      setDraft((current) => applyMappingConflict(current, latest?.version ?? -1));
      setReviewedVersion(null);
      setError(
        "設定已由其他管理員更改或停用。你選的帳戶及 Folder 已保留；請重新檢查連接。頁面版本：" +
          String(version ?? "無") +
          "；最新版本：" +
          String(latest?.version ?? "請重新載入") +
          "。",
      );
      try {
        await refresh();
      } catch {
        /* Keep the current selection for retry. */
      }
      return;
    }
    setError(fallback);
  }
  function changeStaff(nextStaffId: string) {
    if (
      hasUnsavedInput &&
      typeof window !== "undefined" &&
      !window.confirm("目前的 Inbox 選擇尚未儲存。切換同事會放棄本次連接檢查，確定繼續？")
    )
      return;
    requestGeneration.current += 1;
    setBusy(false);
    setDraft((current) => switchWizardStaff(current, nextStaffId));
    setReviewedVersion(null);
    setCandidates([]);
    setCursor(null);
    setQuery("");
    setRetireReason("");
    setFolderForm({ folderKey: "", displayName: "", providerFolderId: "" });
    setError("");
    setNotice("");
  }
  async function browse(next: string | null = null) {
    if (!draft.folderKey) {
      setError("先選擇已設定的 Folder。");
      return;
    }
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError("");
    try {
      const result = await getInboxCandidates({
        query,
        folderKey: draft.folderKey,
        ...(next ? { cursor: next } : {}),
      });
      if (generation !== requestGeneration.current) return;
      setCandidates((current) => {
        if (!next) return result.items;
        const found = new Set(current.map((item) => item.userId));
        return [...current, ...result.items.filter((item) => !found.has(item.userId))];
      });
      setCursor(result.nextCursor);
    } catch {
      if (generation === requestGeneration.current)
        setError("未能讀取公司 Inbox 目錄；請由管理員核對公司連接、Folder 權限或稍後重試。");
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }
  async function verify() {
    if (!draft.staffId || !draft.userId || !draft.folderKey) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await verifyInboxCandidate({
        staffId: draft.staffId,
        userId: draft.userId,
        folderKey: draft.folderKey,
        expectedVersion: version,
      });
      if (generation !== requestGeneration.current) return;
      setDraft((current) => ({ ...current, review: result }));
      setReviewedVersion(version);
      if (result.result !== "verified")
        setError("此 Inbox 帳戶在所選公司 Channel／Folder 的權限未核實；請檢查 WOZTELL 設定。");
      else setNotice("連接已核實。儲存後才會更新此同事的候選資格。");
    } catch (failure) {
      if (generation === requestGeneration.current)
        await explain(failure, "連接檢查失敗；請由管理員核對公司連接及 Folder 存取權。");
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }
  async function save() {
    if (!allowReviewedSave) return;
    if (
      !canSaveReviewedMapping(draft, reviewedVersion, version, new Date().toISOString()) ||
      !draft.review
    )
      return;
    setBusy(true);
    setError("");
    try {
      await saveReviewedWhatsappStaffChannel({
        staffId: draft.staffId,
        expectedVersion: version,
        evidenceId: draft.review.evidenceId,
        eligible: true,
      });
      await refresh();
      setDraft((current) => ({ ...current, review: null, dirty: false }));
      setReviewedVersion(null);
      setNotice("Inbox 映射已儲存；儲存本身不會發送訊息。");
      setStep(2);
    } catch (failure) {
      await explain(failure, "未能儲存映射；請重新檢查連接、同事及 Folder。");
    } finally {
      setBusy(false);
    }
  }
  async function retire() {
    if (!mapping || retireReason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await retireWhatsappStaffChannel({
        mappingId: mapping.id,
        expectedVersion: mapping.version,
        reason: retireReason.trim(),
      });
      await refresh();
      setDraft((current) => ({ ...current, review: null, dirty: false }));
      setReviewedVersion(null);
      setRetireReason("");
      setNotice("此同事已停止作為新分派候選；既有工作需另行檢查。");
    } catch (failure) {
      await explain(failure, "未能停用；請核對映射版本及管理權限。");
    } finally {
      setBusy(false);
    }
  }
  const done = [
    !!selected,
    !!(mapping?.eligible && mapping.review_enforced && !mapping.retired_at),
    !!(
      capability?.inboxPrivateNote.state === "ready" || capability?.staffWhatsapp.state === "ready"
    ),
    false,
  ];
  return (
    <section aria-label="同事接收設定步驟" className="space-y-4 rounded border p-4">
      {leaveGuard}
      <h2 className="font-semibold">同事接收設定</h2>
      <ol className="flex flex-wrap gap-2 text-sm">
        {titles.map((title, index) => (
          <li
            key={title}
            aria-current={index === step ? "step" : undefined}
            className={index === step ? "font-semibold" : "text-muted-foreground"}
          >
            {index + 1}. {title} {done[index] ? "（完成）" : "（待核對）"}
          </li>
        ))}
      </ol>
      {error ? (
        <p role="alert" tabIndex={-1} ref={errorRef} className="text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {step === 0 ? (
        <label className="block max-w-md">
          同事姓名／工作電郵／分行
          <select
            className="mt-1 block w-full rounded border p-2"
            value={draft.staffId}
            onChange={(event) => changeStaff(event.target.value)}
          >
            <option value="">選擇在職同事</option>
            {agents
              .filter((agent) => agent.active)
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name ?? "未命名同事"} · {agent.email ?? "未提供工作電郵"} ·{" "}
                  {agent.branch ?? "未設定分行"}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {step === 1 && selected ? (
        <div className="space-y-4">
          <p className="text-sm">
            為 {selected.name ?? "未命名同事"} 選擇公司 Inbox 帳戶及 Folder。
            分行是本地同事資料，不代表供應商 Folder。搜尋及儲存均不會發送訊息。
          </p>
          {!folders.length ? (
            <div role="alert" className="space-y-2">
              <p>需系統管理員完成公司 Inbox API 連接，並設定已確認的 Folder 名稱，才能核實同事。</p>
              <Button type="button" variant="outline" onClick={() => setFolderSetupOpen(true)}>
                前往 Folder 設定
              </Button>
            </div>
          ) : null}
          <label className="block max-w-xl">
            Folder 名稱
            <select
              className="mt-1 block w-full rounded border p-2"
              value={draft.folderKey}
              disabled={busy}
              onChange={(event) => {
                requestGeneration.current += 1;
                setBusy(false);
                setDraft((current) => ({
                  ...current,
                  folderKey: event.target.value,
                  userId: "",
                  review: null,
                  dirty: true,
                }));
                setReviewedVersion(null);
                setCandidates([]);
                setCursor(null);
              }}
            >
              <option value="">選擇已設定 Folder</option>
              {folders.map((folder) => (
                <option key={folder.folderKey} value={folder.folderKey}>
                  {folder.displayName}
                </option>
              ))}
            </select>
          </label>
          {draft.folderKey ? (
            <InboxAccountPicker
              items={candidates}
              selectedUserId={draft.userId}
              onSelect={(userId) => {
                requestGeneration.current += 1;
                setBusy(false);
                setDraft((current) => ({ ...current, userId, review: null, dirty: true }));
                setReviewedVersion(null);
              }}
              query={query}
              onQueryChange={(value) => {
                requestGeneration.current += 1;
                setBusy(false);
                setQuery(value);
              }}
              onSearch={() => void browse()}
              onNextPage={() => void browse(cursor)}
              nextCursor={cursor}
              busy={busy}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !draft.userId || !draft.folderKey}
              onClick={() => void verify()}
            >
              檢查連接
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                !allowReviewedSave ||
                !canSaveReviewedMapping(draft, reviewedVersion, version, new Date().toISOString())
              }
              onClick={() => void save()}
              title={!allowReviewedSave ? "核實映射的儲存功能尚未啟用" : undefined}
            >
              儲存已核實映射
            </Button>
            {!allowReviewedSave ? (
              <p role="status" className="text-sm">
                核實映射的儲存功能尚未啟用。
              </p>
            ) : null}
          </div>
          <StaffConnectionSummary
            mapping={mapping}
            review={draft.review}
            candidate={selectedCandidate}
            folder={selectedFolder}
          />
          {mapping?.eligible ? (
            <div className="space-y-2 rounded border p-3">
              <label className="block max-w-xl">
                停用原因
                <Input
                  value={retireReason}
                  maxLength={300}
                  onChange={(event) => setRetireReason(event.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={busy || retireReason.trim().length < 3}
                onClick={() => void retire()}
              >
                停用接單
              </Button>
            </div>
          ) : null}
          <details
            className="rounded border p-3"
            open={folderSetupOpen}
            onToggle={(event) => setFolderSetupOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer">進階：設定公司 Folder 名稱與供應商 ID</summary>
            <p className="mt-2 text-sm">
              只輸入已從 WOZTELL 管理介面確認的 Folder；儲存後仍需逐同事檢查存取權。
            </p>
            <div className="grid max-w-xl gap-2">
              <label>
                本地 Folder 代碼
                <Input
                  value={folderForm.folderKey}
                  onChange={(event) =>
                    setFolderForm({ ...folderForm, folderKey: event.target.value })
                  }
                />
              </label>
              <label>
                Folder 顯示名稱
                <Input
                  value={folderForm.displayName}
                  onChange={(event) =>
                    setFolderForm({ ...folderForm, displayName: event.target.value })
                  }
                />
              </label>
              <label>
                供應商 Folder ID
                <Input
                  value={folderForm.providerFolderId}
                  onChange={(event) =>
                    setFolderForm({ ...folderForm, providerFolderId: event.target.value })
                  }
                />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  !folderForm.folderKey ||
                  !folderForm.displayName ||
                  !folderForm.providerFolderId
                }
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await saveNamedInboxFolder({
                      ...folderForm,
                      expectedVersion:
                        folders.find((item) => item.folderKey === folderForm.folderKey)?.version ??
                        null,
                    });
                    setFolders(await getInboxFolders());
                    setFolderForm({ folderKey: "", displayName: "", providerFolderId: "" });
                    setNotice("Folder 名稱已儲存；現在請選同事帳戶並檢查連接。");
                  } catch {
                    setError("Folder 未能儲存；請核對公司連接、識別碼及是否已存在。");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                儲存 Folder 名稱
              </Button>
            </div>
          </details>
        </div>
      ) : null}
      {step === 2 && selected ? (
        <div className="space-y-4">
          <p className="text-sm">
            為 {selected.name ?? "未命名同事"} 設定獨立通知目的地；儲存不代表已送達。
          </p>
          <StaffEndpointEditor agents={agents} selectedStaffId={draft.staffId} />
          <details className="rounded border p-3">
            <summary className="cursor-pointer">進階：28hse／YouTube 等外部同事代碼</summary>
            <StaffReferenceEditor agents={agents} selectedStaffId={draft.staffId} />
          </details>
        </div>
      ) : null}
      {step === 3 && selected ? (
        <div className="space-y-3">
          <p>核實 {selected.name ?? "未命名同事"} 的能力與試送預覽。開啟或儲存此頁不會發送訊息。</p>
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
            key={draft.staffId + ":inbox"}
            staffId={draft.staffId}
            transport="inbox_private_note"
            endpointVersion={endpointVersion("inbox_private_note")}
          />
          <StaffTestNotificationDialog
            key={draft.staffId + ":wa"}
            staffId={draft.staffId}
            transport="staff_whatsapp"
            endpointVersion={endpointVersion("staff_whatsapp")}
          />
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await refresh();
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
          onClick={() => setStep((current) => current - 1)}
        >
          上一步
        </Button>
        <Button
          type="button"
          disabled={!draft.staffId || step === 3 || busy}
          onClick={async () => {
            if (step === 2) {
              try {
                await refresh();
              } catch {
                setError("未能核對端點。");
                return;
              }
            }
            setStep((current) => current + 1);
          }}
        >
          下一步
        </Button>
      </div>
    </section>
  );
}
