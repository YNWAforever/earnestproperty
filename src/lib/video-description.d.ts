export function cleanVideoText(value: string | null | undefined): string;

export function summarizeVideoDescription(
  value: string | null | undefined,
  maxLength?: number,
): string | null;
export function redactPhoneNumbers(value: string | null | undefined): string;
export function summarizeVideoDescriptionForSchema(value: string | null | undefined): string | null;
