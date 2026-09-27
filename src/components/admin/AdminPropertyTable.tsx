import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { ManagedOffering, ManagedPropertySummary } from "@/lib/neon/admin-properties.types";
import {
  neutralPropertyTitle,
  offeringPrice,
  propertyStatusLabels,
  existingOfferingDeals,
  canSelectProperty,
} from "@/lib/admin/property-management-ui";

function Offer({ offer }: { offer: ManagedOffering | null }) {
  if (!offer)
    return (
      <span className="text-muted-foreground" aria-label="沒有此類放盤">
        —
      </span>
    );
  return (
    <div className="space-y-1">
      <p className="whitespace-nowrap font-semibold tabular-nums">{offeringPrice(offer)}</p>
      <span
        className={`inline-block rounded px-2 py-0.5 text-xs ${offer.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground"}`}
      >
        {propertyStatusLabels[offer.status] ?? offer.status}
      </span>
      <p className="text-xs text-muted-foreground">{offer.agentName ?? "未指派代理"}</p>
    </div>
  );
}
function Identity({ row }: { row: ManagedPropertySummary }) {
  return (
    <div className="flex min-w-52 gap-3">
      {row.image ? (
        <img
          src={row.image}
          alt=""
          loading="lazy"
          className="h-16 w-20 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-xs">
          暫無相片
        </div>
      )}
      <div>
        <Link
          className="font-semibold hover:underline"
          to="/admin/listings/$id"
          params={{ id: row.propertyNo }}
        >
          #{row.propertyNo}
        </Link>
        <p className="text-sm">{row.estateName ?? "未填屋苑"}</p>
        <p className="line-clamp-2 max-w-72 text-xs text-muted-foreground">
          {neutralPropertyTitle(row.title)}
        </p>
        {!row.estateName ? <p className="text-xs text-amber-800">屋苑待核實</p> : null}
        {(row.reviewRequired || row.unlinked) && (
          <p className="text-xs text-amber-800">
            {row.unlinked ? "編號待核實" : "資料有差異，待核實"}
          </p>
        )}
      </div>
    </div>
  );
}
function Actions({ row }: { row: ManagedPropertySummary }) {
  const publicOffer = existingOfferingDeals(row.offerings).some(
    (deal) => row.offerings[deal]?.status === "active",
  );
  return (
    <div className="flex gap-1 lg:flex-col">
      <Button asChild variant="outline">
        <Link to="/admin/listings/$id" params={{ id: row.propertyNo }}>
          管理
        </Link>
      </Button>
      {publicOffer && (
        <Button asChild variant="ghost">
          <Link to="/property/$listingNo" params={{ listingNo: row.propertyNo }}>
            公開預覽
          </Link>
        </Button>
      )}
    </div>
  );
}
function updated(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-HK", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
}
export function AdminPropertyTable({
  rows,
  selected,
  disabled,
  onToggle,
  onToggleAll,
}: {
  rows: ManagedPropertySummary[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (no: string) => void;
  onToggleAll: () => void;
}) {
  const selectable = rows.filter(canSelectProperty);
  const checked = selectable.length > 0 && selectable.every((row) => selected.has(row.propertyNo));
  const any = selectable.some((row) => selected.has(row.propertyNo));
  const check = (row: ManagedPropertySummary) => (
    <input
      type="checkbox"
      aria-label={`選擇物業 ${row.propertyNo}`}
      className="h-5 w-5 accent-primary"
      checked={selected.has(row.propertyNo)}
      disabled={disabled || !canSelectProperty(row)}
      onChange={() => onToggle(row.propertyNo)}
    />
  );
  return (
    <div aria-busy={disabled}>
      <label className="mb-3 flex w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="選擇本頁全部可管理物業"
          className="h-5 w-5 accent-primary"
          ref={(node) => {
            if (node) node.indeterminate = any && !checked;
          }}
          checked={checked}
          disabled={disabled || !selectable.length}
          onChange={onToggleAll}
        />
        選擇本頁（{selectable.length} 個可管理物業）
      </label>
      <div className="hidden overflow-x-auto rounded-xl border lg:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">物業管理；每個樓編一行，售租價格與狀態分開顯示</caption>
          <thead className="bg-muted/50">
            <tr>
              {["選擇", "物業", "出售", "出租", "實用面積", "更新時間", "操作"].map((text) => (
                <th key={text} scope="col" className="whitespace-nowrap p-3 font-medium">
                  {text}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.propertyNo}
                className={`border-t align-top ${selected.has(row.propertyNo) ? "bg-primary/5" : "hover:bg-muted/20"}`}
              >
                <td className="p-3">{check(row)}</td>
                <td className="p-3">
                  <Identity row={row} />
                </td>
                <td className="p-3">
                  <Offer offer={row.offerings.sale} />
                </td>
                <td className="p-3">
                  <Offer offer={row.offerings.rent} />
                </td>
                <td className="whitespace-nowrap p-3 tabular-nums">
                  {row.saleableArea === null ? "—" : `${row.saleableArea} 呎`}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{updated(row.updatedAt)}</td>
                <td className="p-3">
                  <Actions row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {rows.map((row) => (
          <article key={row.propertyNo} className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start gap-3">
              {check(row)}
              <Identity row={row} />
            </div>
            <div className="flex flex-wrap gap-6">
              {existingOfferingDeals(row.offerings).map((deal) => (
                <div key={deal}>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {deal === "sale" ? "出售" : "出租"}
                  </p>
                  <Offer offer={row.offerings[deal]} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {row.saleableArea === null ? "面積未填" : `${row.saleableArea} 實呎`} · 更新{" "}
              {updated(row.updatedAt)}
            </p>
            <Actions row={row} />
          </article>
        ))}
      </div>
    </div>
  );
}
