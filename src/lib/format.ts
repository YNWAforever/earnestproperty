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
    ? rounded.toLocaleString(HK_NUMBER_LOCALE)
    : rounded.toLocaleString(HK_NUMBER_LOCALE, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
  return `${display}萬`;
}

export function formatSaleDisplay(
  price: number | null | undefined,
): string | null {
  if (!isFiniteNumber(price) || price <= 0) return null;
  return `$${(price / 1_000_000).toFixed(2)}M`;
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

const HK_TIME_ZONE = "Asia/Hong_Kong";
const HK_DATE_LOCALE = "zh-HK";

function toValidDate(
  input: string | number | Date | null | undefined,
): Date | null {
  if (input === null || input === undefined) return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatHkDate(
  input: string | number | Date | null | undefined,
): string | null {
  const date = toValidDate(input);
  if (!date) return null;
  return new Intl.DateTimeFormat(HK_DATE_LOCALE, {
    timeZone: HK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatHkDateTime(
  input: string | number | Date | null | undefined,
): string | null {
  const date = toValidDate(input);
  if (!date) return null;
  return new Intl.DateTimeFormat(HK_DATE_LOCALE, {
    timeZone: HK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatFreshness(
  input: string | number | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  const date = toValidDate(input);
  if (!date) return null;
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "剛剛更新";
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前更新`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小時前更新`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 日前更新`;
  return `${formatHkDate(date)} 更新`;
}

// C0 controls except tab/LF/CR (handled by the whitespace-collapse step
// below), plus DEL and the C1 control range. Matching control characters is
// this regex's entire purpose, so disable the no-control-regex lint rule.
const CONTROL_CHAR_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const WRAPPING_QUOTES_PATTERN = /^"+|"+$/g;
const REPEATED_DELIMITER_PATTERN = /,{2,}/g;
const EXACT_MALFORMED_TOKEN_PATTERN = /^(NaN|null|undefined|-\s*房|\$0)$/;

export function sanitizeListingText(
  input: string | null | undefined,
): string | null {
  if (input === null || input === undefined) return null;

  let text = input.replace(CONTROL_CHAR_PATTERN, "");
  text = text.replace(WRAPPING_QUOTES_PATTERN, "");
  text = text.replace(REPEATED_DELIMITER_PATTERN, ",");
  text = text.replace(/\s+/g, " ").trim();

  if (text === "" || EXACT_MALFORMED_TOKEN_PATTERN.test(text)) return null;

  return text;
}
