export type ExtractedNumber = { raw: string; value: number; tolerance: number };

/** chineseNumerals (default off): also read a Chinese numeral after 第 or before a counting unit in
 *  CHINESE_NUMERAL_UNITS (兩房 → 2, 第一期 → 1, 七百萬 → 7,000,000). Staff copilot only. */
export type NumberGroundingOptions = { chineseNumerals?: boolean };

export declare const CHINESE_NUMERAL_UNITS: readonly string[];

/** Idioms masked before Chinese numerals are read (千萬唔, 第一時間, 一年四季, …). */
export declare const CHINESE_NUMERAL_IDIOMS: readonly string[];

/** Each number in text with the tolerance its notation implies:
 *  "$6.80M" → { value: 6800000, tolerance: 5000 }; "680萬" / "680.5萬" → ×10000 (tolerance 500 for
 *  one decimal); "1.2億" → ×1e8; "$38,000" / "HK$38,000" → 38000; "512 呎" → 512; "2 房" / "2座" → 2;
 *  "10%" → 10. Digits inside an href are not text and are never passed in. */
export declare function extractNumbers(
  text: string,
  options?: NumberGroundingOptions,
): ExtractedNumber[];

/** Numbers in text with no fact number within tolerance. Facts are DB strings and raw DB numbers. */
export declare function ungroundedNumbers(
  text: string,
  facts: Array<string | number>,
  options?: NumberGroundingOptions,
): string[];
