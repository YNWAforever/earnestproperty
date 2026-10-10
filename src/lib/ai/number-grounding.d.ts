export type ExtractedNumber = { raw: string; value: number; tolerance: number };

/** Each number in text with the tolerance its notation implies:
 *  "$6.80M" → { value: 6800000, tolerance: 5000 }; "680萬" / "680.5萬" → ×10000 (tolerance 500 for
 *  one decimal); "1.2億" → ×1e8; "$38,000" / "HK$38,000" → 38000; "512 呎" → 512; "2 房" / "2座" → 2;
 *  "10%" → 10. Digits inside an href are not text and are never passed in. */
export declare function extractNumbers(text: string): ExtractedNumber[];

/** Numbers in text with no fact number within tolerance. Facts are DB strings and raw DB numbers. */
export declare function ungroundedNumbers(text: string, facts: Array<string | number>): string[];
