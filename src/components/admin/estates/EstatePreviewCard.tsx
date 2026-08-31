/**
 * Lightweight summary of the draft form's current values -- deliberately
 * NOT a mirror of the public estate.$slug.tsx page, which also pulls live
 * listings/transactions/comparables a draft (or not-yet-published) estate
 * wouldn't have. Reflects unsaved edits live since it takes the form state
 * directly as props rather than re-fetching.
 */
export function EstatePreviewCard({
  form,
}: {
  form: {
    name_zh: string;
    name_en: string;
    district_slug: string;
    aliases: string;
    address: string;
    lat: string;
    lng: string;
    transport_note: string;
    school_net_code: string;
    avg_saleable_psf: string;
    verified_at: string | null;
  };
}) {
  const hasCoords = form.lat.trim() && form.lng.trim();
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${encodeURIComponent(form.lat)},${encodeURIComponent(form.lng)}`
    : null;

  return (
    <div className="rounded-md border bg-card p-4">
      <p className="text-xs text-muted-foreground">預覽（草稿內容，未必已發布）</p>
      <p className="mt-2 text-lg font-bold">{form.name_zh || "（未填寫中文名）"}</p>
      {form.name_en ? <p className="text-sm text-muted-foreground">{form.name_en}</p> : null}
      <dl className="mt-3 space-y-1.5 text-sm">
        <Row label="地區" value={form.district_slug || "—"} />
        <Row label="別名" value={form.aliases.split(/\n/).filter(Boolean).join("、") || "—"} />
        <Row label="地址" value={form.address || "—"} />
        <Row
          label="座標"
          value={
            mapsUrl ? (
              <a href={mapsUrl} target="_blank" rel="noreferrer" className="underline">
                在地圖上查看
              </a>
            ) : (
              "—"
            )
          }
        />
        <Row label="交通" value={form.transport_note || "—"} />
        <Row label="校網" value={form.school_net_code || "—"} />
        <Row label="平均實呎" value={form.avg_saleable_psf ? `$${form.avg_saleable_psf}` : "—"} />
        <Row
          label="核實狀態"
          value={
            form.verified_at
              ? `已核實（${new Date(form.verified_at).toLocaleDateString("zh-HK")}）`
              : "尚未核實"
          }
        />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
