import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { resolveWhatsappLinkImport } from "@/lib/neon/whatsapp-link-import";
import {
  parseBatchImport,
  resolveImportedRows,
  type ImportError,
} from "@/lib/whatsapp-enquiries/link-batch-import";
import type { BatchRowDraft } from "@/lib/whatsapp-enquiries/link-batch-policy";
import type { LinkOfferSelection } from "@/lib/admin/whatsapp-link-selection";

const template = "public_listing_no,deal_type,source,placement_url_or_id,staff_reference";
const messages: Record<string, string> = {
  HEADER_INVALID: "欄位名稱或順序不符",
  COLUMN_COUNT_INVALID: "欄位數量不符",
  CSV_QUOTE_INVALID: "引號格式不正確",
  CSV_QUOTE_UNCLOSED: "引號未關閉",
  LISTING_NO_INVALID: "公開樓編無效",
  DEAL_TYPE_INVALID: "租售類型只接受 sale 或 rent",
  SOURCE_INVALID: "來源只接受 website、28hse、youtube 或 other",
  SOURCE_URL_MISMATCH: "網址與所選來源不符",
  UNRECOGNIZED_URL: "未辨識網址，請核對並保留原輸入",
  PLACEMENT_REQUIRED: "缺少投放識別",
  WEBSITE_PLACEMENT_INVALID: "網站使用既定 website:primary 投放",
  PLACEMENT_ID_INVALID: "投放 ID 格式無效",
  DEAL_TYPE_MISMATCH: "28hse 網址的租售類型與此行不符",
  DUPLICATE_ROW: "重複行，請明確移除或核對重用",
  BATCH_LIMIT: "最多 1000 行，請分批匯入",
  OFFER_NOT_FOUND: "找不到現時公開的相應租售盤",
  OFFER_AMBIGUOUS: "公開樓編與租售對應多於一筆，需人工核對",
  STAFF_REFERENCE_UNRESOLVED: "同事來源代碼未能在此來源及帳戶範圍核實",
  STAFF_REFERENCE_CONFLICT: "同事來源代碼有多個有效映射，需人工核對",
};

export function WhatsappBatchImport({
  disabled,
  onImported,
}: {
  disabled?: boolean;
  onImported: (result: {
    rows: BatchRowDraft[];
    offers: LinkOfferSelection[];
    offerCount: number;
    saleCount: number;
    rentCount: number;
    sourceCount: number;
  }) => void;
}) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"csv" | "tsv">("csv");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [lookupError, setLookupError] = useState("");
  const parsed = useMemo(() => parseBatchImport(text, format), [text, format]);
  const offerKeys = new Set(parsed.rows.map((row) => row.publicListingNo + ":" + row.dealType));
  const saleCount = new Set(
    parsed.rows.filter((row) => row.dealType === "sale").map((row) => row.publicListingNo),
  ).size;
  const rentCount = new Set(
    parsed.rows.filter((row) => row.dealType === "rent").map((row) => row.publicListingNo),
  ).size;
  const sourceCount = new Set(parsed.rows.map((row) => row.source)).size;

  async function importRows() {
    setErrors(parsed.errors);
    setLookupError("");
    if (parsed.errors.length || !parsed.rows.length) return;
    setBusy(true);
    try {
      const references = parsed.rows.flatMap((row) => {
        if (!row.staffReference) return [];
        const split = row.staffReference.indexOf("|");
        return split > 0
          ? [
              {
                source: row.source,
                namespace: row.staffReference.slice(0, split),
                externalReference: row.staffReference.slice(split + 1),
              },
            ]
          : [];
      });
      const context = await resolveWhatsappLinkImport({
        offers: parsed.rows.map((row) => ({
          publicListingNo: row.publicListingNo,
          dealType: row.dealType,
        })),
        references,
      });
      const expanded = resolveImportedRows(parsed.rows, context.offers, context.references);
      setErrors(expanded.errors);
      if (expanded.errors.length || expanded.rows.length !== parsed.rows.length) return;
      onImported({
        rows: expanded.rows,
        offers: context.offers,
        offerCount: offerKeys.size,
        saleCount,
        rentCount,
        sourceCount,
      });
    } catch {
      setLookupError("無法查對目前公開租售盤或同事映射；資料未提交，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="貼表格匯入連結" className="space-y-2 rounded-lg border p-3">
      <h3 className="font-medium">貼表格匯入多來源</h3>
      <p className="text-xs text-muted-foreground">
        固定欄位：<code>{template}</code>。同事來源代碼格式為「來源/帳戶|原始代碼」， 例如
        28hse/account540|001-A；不按姓名自動配對。網址只作本機格式解析，不會讀取外站。
      </p>
      <label className="block text-sm">
        資料格式
        <select
          className="ml-2 rounded border p-2"
          value={format}
          onChange={(event) => {
            setFormat(event.target.value as "csv" | "tsv");
            setErrors([]);
          }}
        >
          <option value="csv">CSV</option>
          <option value="tsv">貼表格（TSV）</option>
        </select>
      </label>
      <textarea
        aria-label="CSV 或貼表格資料"
        className="min-h-36 w-full rounded border p-2 text-sm"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setErrors([]);
        }}
        placeholder={template}
        maxLength={250000}
        spellCheck={false}
      />
      <p className="text-sm">
        解析：{offerKeys.size} 筆租售（售 {saleCount}、租 {rentCount}）·
        {sourceCount} 個來源 · {parsed.rows.length} 行
      </p>
      {text.trim() && (errors.length ? errors : parsed.errors).length ? (
        <ul role="alert" className="max-h-36 space-y-1 overflow-auto text-sm text-destructive">
          {(errors.length ? errors : parsed.errors).slice(0, 50).map((error, index) => (
            <li key={error.row + ":" + error.column + ":" + index}>
              第 {error.row || "全部"} 行 · {error.column}：
              {messages[error.errorCode] ?? error.errorCode}
              {error.value ? `（${error.value.slice(0, 80)}）` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {lookupError ? (
        <p role="alert" className="text-sm text-destructive">
          {lookupError}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy || !parsed.rows.length || parsed.errors.length > 0}
        onClick={() => void importRows()}
      >
        核對並匯入 {parsed.rows.length} 行
      </Button>
    </section>
  );
}
