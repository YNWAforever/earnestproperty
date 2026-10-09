import type { CustomerConfirmLabel } from "@/lib/admin/customer-label";

/** 客戶：{name}（{••••1234}）: one line under a consent or 不是退訂 description. */
export function CustomerConfirmLine({ customer }: { customer: CustomerConfirmLabel }) {
  return <p className="text-sm font-medium">{`客戶：${customer.name}（${customer.phone}）`}</p>;
}

/** 客戶：{name} ／ 電話：{••••1234}: the block in a sending confirmation. */
export function CustomerConfirmDetails({ customer }: { customer: CustomerConfirmLabel }) {
  return (
    <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex gap-1">
        <dt className="text-muted-foreground">客戶：</dt>
        <dd className="min-w-0 break-words font-medium">{customer.name}</dd>
      </div>
      <div className="flex gap-1">
        <dt className="text-muted-foreground">電話：</dt>
        <dd>{customer.phone}</dd>
      </div>
    </dl>
  );
}
