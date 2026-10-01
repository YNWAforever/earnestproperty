/** A quoted CSV field can still execute as a spreadsheet formula after import. */
export function safePerformanceCsvCell(value: string | null) {
  const raw = value ?? "";
  const neutralized = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw;
  return '"' + neutralized.replaceAll('"', '""') + '"';
}
