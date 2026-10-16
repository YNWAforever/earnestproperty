import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatHkDateTime } from "@/lib/format";
import { fetchYouTubeSyncStatus } from "@/lib/youtube-sync/youtube-status";
import type { YouTubeSyncStatus } from "@/lib/youtube-sync/youtube-status.types";

const statusLabels = {
  never: "未有記錄（此版本開始記錄）",
  running: "同步中",
  completed: "已完成",
  failed: "同步失敗",
  partial: "資料已寫入，但收尾失敗，請先核對再重試",
  interrupted: "未完成或結果未能記錄，請先核對再重試",
};

const errorLabels: Record<string, string> = {
  youtube_quota_exhausted: "YouTube 配額已用完，請檢查配額後再試。",
  youtube_auth_failed: "YouTube 存取未獲授權，請檢查現有伺服器設定。",
  youtube_rate_limited: "YouTube 暫時限制請求，稍後再試。",
  youtube_unavailable: "YouTube 暫時無法回應或請求逾時。",
  youtube_invalid_snapshot: "YouTube 回傳資料不完整或身份不一致，未套用資料。",
  youtube_lease_lost: "同步執行權已失效，請先核對結果。",
};

export function YouTubeSyncStatusView({ status }: { status: YouTubeSyncStatus }) {
  const count = (value: number | null) => value ?? "未能確定";
  return (
    <div role="status" className="space-y-1 text-sm">
      <p>同步狀態：{statusLabels[status.status]}</p>
      <p>最後嘗試：{status.lastAttempt ? formatHkDateTime(status.lastAttempt) : "未有記錄"}</p>
      <p>最後成功：{status.lastSuccess ? formatHkDateTime(status.lastSuccess) : "未有記錄"}</p>
      <p>
        新增 {count(status.inserted)} · 接管既有 {count(status.adopted)} · 更新{" "}
        {count(status.updated)} · 失敗影片 {count(status.failed)}
      </p>
      {status.code ? <p>{errorLabels[status.code] ?? "同步未完成，請核對支援記錄。"}</p> : null}
    </div>
  );
}

export function YouTubeSyncStatusPanel() {
  const [status, setStatus] = useState<YouTubeSyncStatus | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    fetchYouTubeSyncStatus()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <div className="mb-4 space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">每日約香港時間 03:00 作增量同步。</p>
      {error ? (
        <p role="alert">未能讀取同步記錄，請重新讀取或確認權限。</p>
      ) : status ? (
        <YouTubeSyncStatusView status={status} />
      ) : (
        <p role="status">正在讀取同步記錄…</p>
      )}
      <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
        重新讀取記錄
      </Button>
    </div>
  );
}
