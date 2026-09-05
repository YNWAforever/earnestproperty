import { useState } from "react";
import { toast } from "sonner";
import { setWhatsappMarketingConsent } from "@/lib/neon/admin-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export function WhatsappConsentDialog({
  contactId,
  onSaved,
}: {
  contactId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [optedIn, setOptedIn] = useState(false);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [source, setSource] = useState<
    "written_confirmation" | "recorded_call" | "customer_opt_out"
  >("written_confirmation");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await setWhatsappMarketingConsent({
        data: { contactId, optedIn, evidenceSource: source, evidenceRef },
      });
      toast.success(optedIn ? "已記錄 WhatsApp 推廣同意及憑證" : "已記錄 WhatsApp 拒收及憑證");
      setOpen(false);
      onSaved();
    } catch {
      toast.error("未能儲存，請檢查權限及憑證編號後重試。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          管理 WhatsApp 推廣同意
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>WhatsApp 推廣同意</DialogTitle>
          <DialogDescription>
            客戶查詢並不等於同意推廣。請先核實客戶意願，並填寫內部憑證編號。
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2">
          客戶意願
          <select
            value={optedIn ? "yes" : "no"}
            disabled={busy}
            onChange={(event) => setOptedIn(event.target.value === "yes")}
          >
            <option value="no">拒收推廣</option>
            <option value="yes">明確同意推廣</option>
          </select>
        </label>
        <label className="grid gap-2">
          核實方式
          <select
            value={source}
            disabled={busy}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="written_confirmation">書面確認</option>
            <option value="recorded_call">已記錄的電話確認</option>
            <option value="customer_opt_out">客戶拒收要求</option>
          </select>
        </label>
        <label className="grid gap-2">
          內部憑證編號
          <Input
            value={evidenceRef}
            disabled={busy}
            onChange={(event) => setEvidenceRef(event.target.value)}
            maxLength={120}
            placeholder="case-123"
          />
        </label>
        <Button
          type="button"
          disabled={
            busy ||
            !/^[A-Za-z0-9:_./-]{1,120}$/.test(evidenceRef) ||
            (optedIn && source === "customer_opt_out")
          }
          onClick={() => void save()}
        >
          {busy ? "儲存中…" : "確認並儲存"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
