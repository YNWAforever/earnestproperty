export declare function displayWidth(value: string | null | undefined): number;

export declare const TITLE_MAX_UNITS: 60;
export declare const TITLE_MIN_UNITS: 24;
export declare const DESCRIPTION_MAX_UNITS: 160;
export declare const DESCRIPTION_MIN_UNITS: 90;
export declare const SHARED_TAIL_CHARS: 12;

export declare function truncateToWidth(value: string | null | undefined, maxUnits: number): string;

export declare function seoCopyIssues(input: {
  title?: string | null;
  description?: string | null;
}): string[];
