/** Hong Kong wall-clock time for the WhatsApp safety notices (stable on server and client). */
const formatter = new Intl.DateTimeFormat("zh-HK", {
  timeZone: "Asia/Hong_Kong",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatSafetyTime(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatter.format(date);
}
