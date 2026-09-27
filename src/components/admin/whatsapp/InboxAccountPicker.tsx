import type { InboxCandidate } from "@/lib/neon/inbox-directory.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InboxAccountPicker({
  items,
  selectedUserId,
  onSelect,
  query,
  onQueryChange,
  onSearch,
  onNextPage,
  nextCursor,
  busy,
}: {
  items: InboxCandidate[];
  selectedUserId: string;
  onSelect: (userId: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onNextPage: () => void;
  nextCursor: string | null;
  busy: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block max-w-xl">
        搜尋 Inbox 姓名或工作電郵
        <Input
          value={query}
          disabled={busy}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch();
            }
          }}
          maxLength={80}
          autoComplete="off"
        />
      </label>
      <Button type="button" variant="outline" disabled={busy} onClick={onSearch}>
        搜尋公司 Inbox 帳戶
      </Button>
      <fieldset className="space-y-2">
        <legend className="font-medium">選擇 Inbox 帳戶</legend>
        {items.map((item, index) => (
          <label key={item.userId} className="flex gap-2 rounded border p-2">
            <input
              type="radio"
              name="inbox-account"
              value={item.userId}
              checked={selectedUserId === item.userId}
              disabled={busy}
              onChange={() => onSelect(item.userId)}
            />
            <span className="min-w-0">
              <strong>{item.displayName}</strong>
              <span className="ml-2 break-all text-sm">{item.email ?? "未提供電郵"}</span>
              <span className="ml-2 text-xs text-muted-foreground">候選 {index + 1}</span>
              <details className="text-xs text-muted-foreground">
                <summary>進階識別資料</summary>
                Inbox User ID：{item.userId} · Channel：{item.channelId} · 角色：
                {item.role ?? "未提供"}
              </details>
            </span>
          </label>
        ))}
        {!items.length ? (
          <p className="text-sm text-muted-foreground">
            此頁未找到相符帳戶；若仍有下一頁，請繼續載入。不要只憑姓名建立映射。
          </p>
        ) : null}
      </fieldset>
      {nextCursor ? (
        <Button type="button" variant="outline" disabled={busy} onClick={onNextPage}>
          載入下一頁帳戶
        </Button>
      ) : null}
    </div>
  );
}
