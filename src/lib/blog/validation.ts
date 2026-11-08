/** Shared article identity limit for CMS writes and public lookup boundaries. */
export const ARTICLE_SLUG_MAX_LENGTH = 240;

// Router input is already decoded. Legacy inventory bypasses new-key validation explicitly.
export function validateCategoryKey(value: string): string {
  if (value === "全部") throw new Error("「全部」保留作網誌首頁，請使用其他分類代碼");
  if (!value.trim() || /[\p{Cc}:/?#[\]@!$&'()*+,;=%\\]/u.test(value))
    throw new Error("分類代碼不可留空或包含控制字元及網址分隔符號");
  return value;
}
