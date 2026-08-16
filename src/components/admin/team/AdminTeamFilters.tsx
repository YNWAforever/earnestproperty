import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminTeamFilterState } from "@/lib/neon/admin-team.types";
import type { StaffRole } from "@/lib/neon/auth.server";

export type TeamFilters = { q: string; role?: StaffRole; state?: AdminTeamFilterState };

export function AdminTeamFilters({
  filters,
  queryDraft,
  onQueryDraftChange,
  onChange,
  onClear,
}: {
  filters: TeamFilters;
  queryDraft: string;
  onQueryDraftChange: (value: string) => void;
  onChange: (filters: Partial<TeamFilters>) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(filters.q || filters.role || filters.state);
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]">
      <div className="space-y-1.5">
        <Label htmlFor="team-query">搜尋成員</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
          />
          <Input
            id="team-query"
            onChange={(event) => onQueryDraftChange(event.target.value)}
            placeholder="姓名或電郵"
            value={queryDraft}
            className="pl-9"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-role">角色</Label>
        <Select
          onValueChange={(value) =>
            onChange({ role: value === "all" ? undefined : (value as StaffRole) })
          }
          value={filters.role ?? "all"}
        >
          <SelectTrigger id="team-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="admin">管理員</SelectItem>
            <SelectItem value="manager">主管</SelectItem>
            <SelectItem value="agent">經紀</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="team-state">帳戶狀態</Label>
        <Select
          onValueChange={(value) =>
            onChange({ state: value === "all" ? undefined : (value as AdminTeamFilterState) })
          }
          value={filters.state ?? "all"}
        >
          <SelectTrigger id="team-state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            <SelectItem value="active">已啟用</SelectItem>
            <SelectItem value="invited">已邀請</SelectItem>
            <SelectItem value="suspended">已停用</SelectItem>
            <SelectItem value="attention">需要跟進</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-end">
        <Button
          className="w-full"
          disabled={!hasFilters}
          onClick={onClear}
          type="button"
          variant="outline"
        >
          <X aria-hidden="true" />
          清除篩選
        </Button>
      </div>
    </div>
  );
}
