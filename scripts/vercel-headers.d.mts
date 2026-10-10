export type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

export const CSP_REPORT_ONLY: string;
export const CSP_ENFORCED: string;
export const SECURITY_HEADERS: HeaderRule[];
