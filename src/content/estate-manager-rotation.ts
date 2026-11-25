/**
 * Estate → responsible manager, transcribed from the agency's own printed
 * "推介" sheet (photo 2026-11-11, provided by Willy on 2026-11-24).
 *
 * The sheet lists each estate inside its district block and circles ①, ② or ③
 * next to it. The three numbers are hand-written on the same sheet as:
 *
 *   ① Tommy  6644 2444
 *   ② Terence 9100 5322
 *   ③ Sam    6626 6608
 *
 * Those three are the existing `enquiry_notification_recipients` rows
 * `manager:1..3` (姚頌溏 / 鄧錦雄 / 李德鴻), so the rotation below maps a
 * circled number straight onto a staff id the notification plan can use.
 *
 * This decides Willy's rule for an estate-scoped enquiry (「只講屋苑」): notify
 * that estate's manager. A unit-scoped enquiry keeps using the 負責經紀 from
 * `property_agents`, and an unscoped one notifies nobody but the copy number.
 *
 * Deliberately data-only: no database, no network, no server imports, so the
 * mapping can be reviewed, diffed and unit-tested offline. Every slug below is
 * asserted against `estate-registry.ts` by
 * `estate-manager-rotation.test.mjs`; names with no live estate page are kept in
 * `UNMAPPED_ESTATE_NAMES` instead of being silently dropped.
 */
export const ESTATE_MANAGER_ROTATION_SOURCE = {
  document: "agency 推介 sheet (printed), districts 深井／汀九 and 青山公路",
  photoTakenAt: "2026-11-11",
  providedBy: "Willy",
  transcribedAt: "2026-11-24",
  marking: "circled ①/②/③ next to each estate, hand-written legend at the top",
} as const;

export type ManagerRotation = 1 | 2 | 3;

export type EstateManagerContact = {
  rotation: ManagerRotation;
  /** `enquiry_notification_recipients.recipient_key` that already points here. */
  recipientKey: "manager:1" | "manager:2" | "manager:3";
  staffId: string;
  nameZh: string;
  nameEn: string;
  /** As written on the sheet, digits only, company-prefixed. */
  phone: string;
  sheetLabel: string;
};

export const ESTATE_MANAGERS: readonly EstateManagerContact[] = [
  {
    rotation: 1,
    recipientKey: "manager:1",
    staffId: "81206a23-777c-45c0-a2c5-7b53757206ca",
    nameZh: "姚頌溏",
    nameEn: "Tommy Yiu",
    phone: "85266442444",
    sheetLabel: "Tommy 6644 2444",
  },
  {
    rotation: 2,
    recipientKey: "manager:2",
    staffId: "fb4dfa8f-a892-458b-a4f9-7caf48a4a0a2",
    nameZh: "鄧錦雄",
    nameEn: "Terence Tang",
    phone: "85291005322",
    sheetLabel: "Terence 9100 5322",
  },
  {
    rotation: 3,
    recipientKey: "manager:3",
    staffId: "48e258b4-6b1f-4f65-b5e8-2f10a34806ba",
    nameZh: "李德鴻",
    nameEn: "Sam Lee",
    phone: "85266266608",
    sheetLabel: "Sam 6626 6608",
  },
] as const;

/** Live estate pages, keyed by `estate-registry.ts` slug. */
export const ESTATE_MANAGER_BY_SLUG: Readonly<Record<string, ManagerRotation>> = {
  // 深井／汀九
  bellagio: 3,
  "sea-crest-villa": 2,
  "lido-garden": 2,
  "rhine-garden": 3,
  "chun-wong-kui": 3,
  "hoi-wan-hin": 2,
  "hong-kong-garden": 1,
  "tai-wah-hin": 1,
  "hoi-wan-toi": 3,
  "lung-tang-kok": 1,
  "l-aquatique": 1,
  "royal-dragon-villa": 2,
  // 青山公路
  "mun-ming-shan": 1,
  "sing-tai": 1,
  napa: 2,
  "seong-yuen": 1,
  "the-carmel": 1,
  "oma-oma": 2,
  "kwan-lun": 3,
  "nam-ngon": 1,
  "oi-kam-hoi-ngon": 1,
  "wong-gam-hoi-ngon": 3,
  "wong-gam-hoi-waan": 2,
  "tai-yu": 1,
  "oma-by-the-sea": 3,
  "fei-yeung": 3,
  "tai-tou-waan": 2,
  "oi-kam-waan": 1,
  "lin-shan": 2,
  "long-tou-waan": 3,
  "hoi-ching-hin": 1,
  "yu-chui-yuen": 2,
  "bayview-terrace": 1,
  "hoi-wai-garden": 3,
  "hoi-yu": 1,
  "ching-yung-toi": 1,
  "nga-tak-yuen": 2,
  "elegant-villa": 2,
  "tuen-mun-court": 3,
  "hoi-king-garden": 1,
  "chun-wo-sea-view-garden": 2,
  "chui-fung-siu-chuk": 1,
  "dragon-inn-court": 1,
  "palm-cove": 1,
  "chung-yuet-waan": 1,
  "castle-peak-villas": 1,
  "pun-lung-bun-do": 1,
  "ching-lai-waan-villas": 1,
};

/**
 * Every estate printed on the sheet, keyed by the Chinese name exactly as it is
 * written there. Slugs cover the estates this site has pages for; the name table
 * also carries the ones it does not (see `UNMAPPED_ESTATE_NAMES`).
 */
export const ESTATE_MANAGER_BY_NAME: Readonly<Record<string, ManagerRotation>> = {
  // 深井／汀九推介
  碧堤半島: 3,
  浪翠園: 2,
  麗都花園: 2,
  海韻花園: 3,
  縉皇居: 3,
  海雲軒: 2,
  豪景花園: 1,
  帝華軒: 1,
  海韻臺: 3,
  龍騰閣: 1,
  逸璟龍灣: 1,
  嘉御龍庭: 2,
  皇壁: 2,
  新麗苑: 2,
  金麗苑: 2,
  // 青山公路推介
  滿名山: 1,
  星堤: 1,
  NAPA: 2,
  上源: 1,
  "The Carmel": 1,
  "Oma Oma": 2,
  琨崙: 3,
  南岸: 1,
  愛琴海岸: 1,
  黃金海岸: 3,
  黃金海灣: 2,
  帝御: 1,
  凱和山: 1,
  "Oma by the sea": 3,
  飛揚: 3,
  帝濤灣: 2,
  愛琴灣: 1,
  漣山: 2,
  浪濤灣: 3,
  海澄軒: 1,
  瑜翠園: 2,
  龍珠島: 1,
  碧翠花園: 1,
  海慧花園: 3,
  海譽: 1,
  青榕台: 1,
  雅德苑: 2,
  雅翠苑: 2,
  屯門閣: 3,
  海景花園: 1,
  春和海景花園: 2,
  翠峰小築: 1,
  容龍居: 1,
  翠濤居: 1,
  棕月灣: 1,
  青山別墅: 1,
  蟠龍半島: 1,
  青麗灣別墅: 1,
};

/**
 * Names on the sheet with no live estate page on this site. They stay listed so
 * a future estate expansion can resolve them instead of the rotation silently
 * having a hole. 村屋 and 其他 are not estates: the 深井 block marks 村屋 ①,
 * the 青山 block leaves it and 其他 unmarked, so neither is routed.
 */
export const UNMAPPED_ESTATE_NAMES: readonly string[] = [
  "皇壁",
  "新麗苑",
  "金麗苑",
  "凱和山",
  "龍珠島",
];

/** Rotation for one estate, preferring the live slug and falling back to the name. */
export function managerRotationForEstate({
  slug,
  name,
}: {
  slug?: string | null;
  name?: string | null;
}): ManagerRotation | null {
  if (slug && Object.hasOwn(ESTATE_MANAGER_BY_SLUG, slug)) {
    return ESTATE_MANAGER_BY_SLUG[slug] ?? null;
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed && Object.hasOwn(ESTATE_MANAGER_BY_NAME, trimmed)) {
    return ESTATE_MANAGER_BY_NAME[trimmed] ?? null;
  }
  return null;
}

/** The contact for a rotation number, or null when it is not 1, 2 or 3. */
export function estateManagerContact(rotation: ManagerRotation | null | undefined) {
  if (rotation !== 1 && rotation !== 2 && rotation !== 3) return null;
  return ESTATE_MANAGERS.find((contact) => contact.rotation === rotation) ?? null;
}
