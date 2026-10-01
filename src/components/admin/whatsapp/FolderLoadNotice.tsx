import { Button } from "@/components/ui/button";

export type FolderLoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "forbidden"; correlation?: string }
  | { kind: "error"; correlation?: string };

export function classifyFolderLoad(failure: unknown): FolderLoadState {
  const source = failure && typeof failure === "object" ? (failure as Record<string, unknown>) : {};
  const status = failure instanceof Response ? failure.status : Number(source.status);
  const raw = source.requestId;
  const correlation = typeof raw === "string" && /^[A-Za-z0-9-]{1,80}$/.test(raw) ? raw : undefined;
  return { kind: status === 403 ? "forbidden" : "error", correlation };
}

export function FolderLoadNotice({
  state,
  onRetry,
}: {
  state: FolderLoadState;
  onRetry: () => void;
}) {
  if (state.kind === "ready") return null;
  if (state.kind === "loading")
    return (
      <p role="status" className="text-sm">
        正在載入已核實 Folder…
      </p>
    );
  if (state.kind === "empty")
    return <p className="text-sm">尚未設定已核實 Folder；請由管理員依供應商資料完成一次性設定。</p>;
  return (
    <div role="alert" className="space-y-2 rounded border border-destructive/30 p-3 text-sm">
      <p>
        {state.kind === "forbidden"
          ? "沒有權限讀取公司 Folder，請聯絡管理員核對 Inbox 權限。"
          : "暫時無法載入 Folder，請保留目前選擇並稍後重試。"}
      </p>
      {state.correlation ? <p>參考編號：{state.correlation}</p> : null}
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重新載入 Folder
      </Button>
    </div>
  );
}
