const HK_NUMBER_LOCALE = "en-US";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatHkd(amount: number | null | undefined): string | null {
  if (!isFiniteNumber(amount)) return null;
  return `$${Math.round(amount).toLocaleString(HK_NUMBER_LOCALE)}`;
}

export function formatManDisplay(
  amount: number | null | undefined,
): string | null {
  if (!isFiniteNumber(amount) || amount <= 0) return null;
  const man = amount / 10000;
  const rounded = Math.round(man * 10) / 10;
  const display = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);
  return `${display}萬`;
}

export function formatArea(sqft: number | null | undefined): string | null {
  if (!isFiniteNumber(sqft) || sqft <= 0) return null;
  return `${Math.round(sqft).toLocaleString(HK_NUMBER_LOCALE)} 呎`;
}

export function formatPsf(
  price: number | null | undefined,
  area: number | null | undefined,
): string | null {
  if (!isFiniteNumber(price)) return null;
  if (!isFiniteNumber(area) || area <= 0) return null;
  const psf = price / area;
  return `$${Math.round(psf).toLocaleString(HK_NUMBER_LOCALE)} 呎`;
}
