export function cleanVideoText(value: string | null | undefined): string;

export function summarizeVideoDescription(
  value: string | null | undefined,
  maxLength?: number,
): string | null;

export function redactPhoneNumbers(value: string | null | undefined): string;

export function summarizeVideoDescriptionForSchema(value: string | null | undefined): string | null;

export function videoSchemaText(
  video: { title?: string | null; description?: string | null },
  fallbackName: string,
): { name: string; description: string | null };
