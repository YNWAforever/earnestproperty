import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StaffNotificationCard } from "./StaffNotificationCard";
import {
  fetchMyStaffNotifications,
  confirmStaffNotification,
  askStaffNotificationHelp,
} from "@/lib/neon/staff-notifications";
import type { StaffNotificationViewPage } from "@/lib/neon/staff-notifications.types";
import type { StaffNotificationView } from "@/lib/neon/staff-notification-view.js";
export function StaffNotificationPanel({
  refreshKey,
  onOpen,
}: {
  refreshKey: number | null;
  onOpen: (item: StaffNotificationView) => void;
}) {
  const [page, setPage] = useState<StaffNotificationViewPage | null>(null),
    [status, setStatus] = useState<"pending" | "all">("pending"),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [fresh, setFresh] = useState(false),
    [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const freshRef = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function refresh() {
    freshRef.current = false;
    setFresh(false);
    setRevision((n) => n + 1);
  }
  useEffect(() => {
    let active = true;
    freshRef.current = false;
    setFresh(false);
    fetchMyStaffNotifications({ cursor, status, limit: 10 })
      .then((p) => {
        if (active) {
          setPage(p);
          setError("");
          freshRef.current = p.available;
          setFresh(p.available);
        }
      })
      .catch(() => {
        if (active) setError("未能載入接手工作，請重新整理或核對權限。");
      });
    return () => {
      active = false;
    };
  }, [cursor, status, refreshKey, revision]);
  async function perform(item: StaffNotificationView, reason?: string) {
    if (pending.current || !freshRef.current || !item.canAct) return;
    if (reason !== undefined && !reason.trim()) return;
    pending.current = true;
    freshRef.current = false;
    setFresh(false);
    setBusy(true);
    setError("");
    try {
      const input = { notificationId: item.id, expectedAssignmentVersion: item.assignmentVersion };
      if (reason) await askStaffNotificationHelp({ ...input, reason });
      else await confirmStaffNotification(input);
    } catch {
      if (mounted.current) setError("更新結果未能確認，正在讀回接手工作。沒有重送要求。");
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        refresh();
      }
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
            freshRef.current = false;
            setFresh(false);
            setStatus(e.target.value as "pending" | "all");
            setCursor(null);
          }}
        >
          <option value="pending">待接手</option>
          <option value="all">所有狀態</option>
        </select>
        <Button variant="outline" disabled={busy} onClick={refresh}>
          更新接手工作
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!fresh && page ? <p>正在核對接手工作，完成讀回前不能更新。</p> : null}
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
            busy={busy || !fresh}
            onOpen={() => onOpen(item)}
            onConfirm={() => void perform(item)}
            onHelp={(r) => void perform(item, r)}
          />
        ))
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={busy || !cursor}
          onClick={() => {
            freshRef.current = false;
            setFresh(false);
            setCursor(null);
          }}
        >
          接手工作第一頁
        </Button>
        <Button
          variant="outline"
          disabled={busy || !page?.nextCursor}
          onClick={() => {
            freshRef.current = false;
            setFresh(false);
            setCursor(page?.nextCursor ?? null);
          }}
        >
          接手工作下一頁
        </Button>
      </div>
    </section>
  );
}
