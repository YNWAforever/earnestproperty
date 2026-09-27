/** Keep spreadsheet text literal, including formula-like and control-prefixed cells. */
export function safeCsvCell(value: unknown, numeric = false): string {
  const raw = value == null ? "" : String(value);
  const first = raw.charCodeAt(0);
  const startsWithControl = Number.isFinite(first) && (first <= 31 || first === 127);
  const escaped = !numeric && (/^[\s]*[=+\-@]/u.test(raw) || startsWithControl) ? `'${raw}` : raw;
  return `"${escaped.replaceAll('"', '""')}"`;
}
