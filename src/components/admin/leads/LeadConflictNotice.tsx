import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LEAD_CHANGED_MESSAGE } from "@/lib/admin/lead-save-errors";

export function LeadConflictNotice({
  reloading,
  onReload,
}: {
  reloading: boolean;
  onReload: () => void;
}) {
  return (
    <Alert variant="destructive" role="alert" className="mb-4">
      <AlertTitle>{LEAD_CHANGED_MESSAGE}</AlertTitle>
      <AlertDescription>
        <p>重新載入會以最新資料取代你未儲存的修改；已新增的跟進備註不會受影響。</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={reloading}
          onClick={onReload}
        >
          {reloading ? "載入中…" : "重新載入最新資料"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
