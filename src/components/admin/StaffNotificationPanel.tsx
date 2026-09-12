import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StaffNotificationCard } from "./StaffNotificationCard";
import {
  fetchMyStaffNotifications,
  confirmStaffNotification,
  askStaffNotificationHelp,
} from "@/lib/neon/staff-notifications";
import type {
  StaffNotificationItem,
  StaffNotificationPage,
} from "@/lib/neon/staff-notifications.types";
export function StaffNotificationPanel({
  refreshKey,
  onOpen,
}: {
  refreshKey: number | null;
  onOpen: (item: StaffNotificationItem) => void;
}) {
  const [page, setPage] = useState<StaffNotificationPage | null>(null),
    [status, setStatus] = useState<"pending" | "all">("pending"),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    fetchMyStaffNotifications({ cursor, status, limit: 10 })
      .then((p) => {
        if (active) {
          setPage(p);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("未能載入接手工作，請重新整理或核對權限。");
      });
    return () => {
      active = false;
    };
  }, [cursor, status, refreshKey, revision]);
  async function perform(item: StaffNotificationItem, reason?: string) {
    setBusy(true);
    setError("");
    try {
      const input = { notificationId: item.id, expectedAssignmentVersion: item.assignmentVersion };
      if (reason) await askStaffNotificationHelp({ ...input, reason });
      else await confirmStaffNotification(input);
      setRevision((n) => n + 1);
    } catch {
      setError("未能更新：工作可能已轉交或權限已改變，請重新整理。");
      setRevision((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="我的接手工作" className="my-4 space-y-3 rounded border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">我的接手工作</h2>
        <select
          aria-label="接手工作狀態"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "pending" | "all");
            setCursor(null);
          }}
        >
          <option value="pending">待接手</option>
          <option value="all">所有狀態</option>
        </select>
        <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
          更新接手工作
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!page ? (
        <p>載入中…</p>
      ) : !page.available ? (
        <p>接手功能尚未具備資料庫設定。</p>
      ) : page.items.length === 0 ? (
        <p>此頁沒有你的接手工作。</p>
      ) : (
        page.items.map((item) => (
          <StaffNotificationCard
            key={item.id}
            item={item}
            busy={busy}
            onOpen={() => onOpen(item)}
            onConfirm={() => void perform(item)}
            onHelp={(r) => void perform(item, r)}
          />
        ))
      )}
      <div className="flex gap-2">
        <Button variant="outline" disabled={!cursor} onClick={() => setCursor(null)}>
          接手工作第一頁
        </Button>
        <Button
          variant="outline"
          disabled={!page?.nextCursor}
          onClick={() => setCursor(page?.nextCursor ?? null)}
        >
          接手工作下一頁
        </Button>
      </div>
    </section>
  );
}
